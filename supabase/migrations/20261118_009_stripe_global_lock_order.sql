-- Hakotohito: enforce global mutation-gate-before-row-lock ordering in Stripe flows.
-- Candidate only. Depends on Stripe migrations 004/005 and global mutation gate 009.
-- Replaces the existing claim, fulfillment, and admin incident functions without
-- changing their business semantics; only the shared gate is acquired first.
BEGIN;

DO $preflight$
DECLARE
  v_name text;
  v_oid oid;
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'Global mutation gate helper is missing';
  END IF;
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN
       pg_get_functiondef(to_regprocedure('public.acquire_global_mutation_gate_trigger()'))) = 0 THEN
    RAISE EXCEPTION 'Global mutation gate helper does not use the expected lock';
  END IF;
  IF to_regclass('public.payment_orders') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.stripe_webhook_events') IS NULL
     OR to_regclass('public.stripe_payment_incidents') IS NULL
     OR to_regclass('public.stripe_payment_incident_actions') IS NULL
     OR to_regclass('public.coin_transactions') IS NULL THEN
    RAISE EXCEPTION 'Required Stripe tables are missing';
  END IF;
  FOREACH v_name IN ARRAY ARRAY[
    'claim_stripe_webhook_event(text,text)',
    'complete_stripe_coin_purchase(uuid,text,text,integer,text)',
    'manage_stripe_payment_incident(uuid,text,text,text)'
  ] LOOP
    v_oid := to_regprocedure('public.' || v_name);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required Stripe function is missing: %', v_name;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_oid)
       OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=v_oid) <> 'postgres' THEN
      RAISE EXCEPTION 'Stripe function owner/security-definer contract differs: %', v_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.payment_orders'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.stripe_webhook_events'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.stripe_payment_incidents'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.stripe_payment_incident_actions'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.coin_transactions'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')) THEN
    RAISE EXCEPTION 'Global mutation gate triggers are missing from Stripe write tables';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.complete_stripe_coin_purchase(p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text, p_paid_amount integer, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_balance integer;
  v_new_balance bigint;
  v_account_status text;
  v_existing_order_id uuid;
  v_idempotency_key text;
  v_has_incident boolean := false;
BEGIN
  -- Acquire the shared mutation gate before any row lock.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_order_id IS NULL
     OR NULLIF(p_checkout_session_id, '') IS NULL
     OR NULLIF(p_payment_intent_id, '') IS NULL
     OR p_paid_amount IS NULL OR p_paid_amount <= 0
     OR lower(COALESCE(p_currency, '')) <> 'jpy' THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が不正です');
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.payment_type <> 'coin_purchase' THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '購入注文が見つかりません');
  END IF;

  IF v_order.status IN ('paid','paid_review') THEN
    IF v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
       OR v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
       OR v_order.amount_jpy IS DISTINCT FROM p_paid_amount
       OR v_order.currency IS DISTINCT FROM lower(p_currency) THEN
      RETURN jsonb_build_object('success', false, 'errorMessage', '処理済み注文の決済情報が一致しません');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'alreadyProcessed', true,
      'reviewRequired', (v_order.status = 'paid_review'),
      'status', v_order.status
    );
  END IF;

  IF v_order.status <> 'pending'
     OR (v_order.stripe_payment_intent_id IS NOT NULL AND v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id)
     OR v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
     OR v_order.amount_jpy IS DISTINCT FROM p_paid_amount
     OR v_order.currency IS DISTINCT FROM lower(p_currency)
     OR v_order.coin_amount::bigint * v_order.coin_rate_yen::bigint <> v_order.amount_jpy::bigint THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が注文内容と一致しません');
  END IF;

  SELECT id INTO v_existing_order_id
  FROM public.payment_orders
  WHERE stripe_payment_intent_id = p_payment_intent_id
    AND id <> v_order.id;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'Payment Intentは別注文で使用済みです');
  END IF;

  -- Serialize fulfillment against account-status changes that update this row.
  SELECT COALESCE(coin_balance, 0), account_status
  INTO v_balance, v_account_status
  FROM public.users
  WHERE id = v_order.payer_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '購入ユーザーが見つかりません');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stripe_payment_incidents
    WHERE payment_order_id = v_order.id
  ) INTO v_has_incident;

  IF v_account_status IS DISTINCT FROM 'active' OR v_has_incident THEN
    UPDATE public.payment_orders
    SET status = 'paid_review',
        stripe_payment_intent_id = p_payment_intent_id,
        paid_at = now(),
        updated_at = now()
    WHERE id = v_order.id;

    IF v_account_status IS DISTINCT FROM 'active' THEN
      INSERT INTO public.stripe_payment_incidents (
        payment_order_id, incident_type, stripe_payment_intent_id,
        amount_jpy, currency, details
      ) VALUES (
        v_order.id, 'paid_after_account_withdrawal', p_payment_intent_id,
        v_order.amount_jpy, 'jpy',
        jsonb_build_object('account_status_at_fulfillment', v_account_status)
      )
      ON CONFLICT (payment_order_id, incident_type) DO NOTHING;
    END IF;

    UPDATE public.stripe_payment_incidents
    SET stripe_payment_intent_id = p_payment_intent_id
    WHERE payment_order_id = v_order.id
      AND stripe_payment_intent_id IS NULL;

    RETURN jsonb_build_object(
      'success', true,
      'alreadyProcessed', false,
      'reviewRequired', true,
      'reviewReason', CASE WHEN v_has_incident THEN 'payment_incident' ELSE 'account_withdrawn' END,
      'status', 'paid_review',
      'coinAmount', 0
    );
  END IF;

  v_new_balance := v_balance::bigint + v_order.coin_amount::bigint;
  IF v_new_balance > 2147483647 THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'コイン残高の上限を超えるため管理者確認が必要です');
  END IF;

  v_idempotency_key := 'stripe_purchase:' || v_order.id::text;

  UPDATE public.users
  SET coin_balance = v_new_balance::integer
  WHERE id = v_order.payer_user_id;

  INSERT INTO public.coin_transactions (
    user_id, amount, transaction_type, description, balance_after,
    created_by_user_id, idempotency_key
  ) VALUES (
    v_order.payer_user_id,
    v_order.coin_amount,
    'purchase_credit',
    'Stripeコイン購入（' || v_order.amount_jpy::text || '円）',
    v_new_balance::integer,
    v_order.payer_user_id,
    v_idempotency_key
  );

  UPDATE public.payment_orders
  SET status = 'paid',
      stripe_payment_intent_id = p_payment_intent_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'success', true,
    'alreadyProcessed', false,
    'reviewRequired', false,
    'status', 'paid',
    'coinAmount', v_order.coin_amount,
    'balanceAfter', v_new_balance::integer
  );
END;
$function$


CREATE OR REPLACE FUNCTION public.manage_stripe_payment_incident(p_incident_id uuid, p_admin_line_user_id text, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_incident public.stripe_payment_incidents%ROWTYPE;
BEGIN
  -- Acquire the shared mutation gate before any row lock.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_incident_id IS NULL
     OR NULLIF(btrim(COALESCE(p_admin_line_user_id, '')), '') IS NULL
     OR p_action IS NULL
     OR p_action NOT IN ('under_review','resolved','dismissed')
     OR char_length(btrim(COALESCE(p_note, ''))) NOT BETWEEN 1 AND 2000 THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '入力内容が不正です');
  END IF;

  SELECT * INTO v_incident
  FROM public.stripe_payment_incidents
  WHERE id = p_incident_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済事故記録が見つかりません');
  END IF;

  UPDATE public.stripe_payment_incidents
  SET resolution_status = p_action,
      resolved_at = CASE WHEN p_action IN ('resolved','dismissed') THEN now() ELSE NULL END,
      resolved_by_line_user_id = CASE WHEN p_action IN ('resolved','dismissed') THEN p_admin_line_user_id ELSE NULL END
  WHERE id = p_incident_id;

  INSERT INTO public.stripe_payment_incident_actions (
    incident_id, admin_line_user_id, action_type, note
  ) VALUES (
    p_incident_id, p_admin_line_user_id, p_action, btrim(p_note)
  );

  RETURN jsonb_build_object('success', true, 'incidentId', p_incident_id, 'resolutionStatus', p_action);
END;
$function$


CREATE FUNCTION public.claim_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_event public.stripe_webhook_events%ROWTYPE;
  v_token uuid;
BEGIN
  -- Acquire the shared mutation gate before conflict handling or row locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF NULLIF(btrim(COALESCE(p_stripe_event_id, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_event_type, '')), '') IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'errorMessage', 'Webhook event identity is invalid');
  END IF;

  v_token := gen_random_uuid();

  INSERT INTO public.stripe_webhook_events (
    stripe_event_id, event_type, processing_status,
    processing_token, processing_started_at, attempt_count
  ) VALUES (
    p_stripe_event_id, p_event_type, 'processing',
    v_token, now(), 1
  )
  ON CONFLICT (stripe_event_id) DO NOTHING;

  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true, 'processingToken', v_token);
  END IF;

  SELECT * INTO v_event
  FROM public.stripe_webhook_events
  WHERE stripe_event_id = p_stripe_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'errorMessage', 'Webhook event row could not be locked');
  END IF;

  IF v_event.processing_status IN ('processed','ignored') THEN
    RETURN jsonb_build_object('claimed', false, 'duplicate', true, 'status', v_event.processing_status);
  END IF;

  -- An active lease prevents concurrent delivery from processing the same
  -- event. A stale lease can be reclaimed after five minutes.
  IF v_event.processing_status = 'processing'
     AND v_event.processing_started_at > now() - interval '5 minutes' THEN
    RETURN jsonb_build_object('claimed', false, 'inProgress', true);
  END IF;

  UPDATE public.stripe_webhook_events
  SET event_type = p_event_type,
      processing_status = 'processing',
      processing_token = v_token,
      processing_started_at = now(),
      attempt_count = attempt_count + 1,
      error_message = NULL,
      processed_at = NULL
  WHERE stripe_event_id = p_stripe_event_id;

  RETURN jsonb_build_object('claimed', true, 'processingToken', v_token);
END;
$function$;
ALTER FUNCTION public.claim_stripe_webhook_event(text,text) OWNER TO postgres;
ALTER FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) OWNER TO postgres;
ALTER FUNCTION public.manage_stripe_payment_incident(uuid,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manage_stripe_payment_incident(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.manage_stripe_payment_incident(uuid,text,text,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
