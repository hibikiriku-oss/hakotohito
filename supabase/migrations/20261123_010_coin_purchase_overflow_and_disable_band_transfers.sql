-- Restore Stripe balance-overflow paid_review handling without regressing the
-- shared global mutation-gate-before-row-lock order from 20261118_009.
-- Candidate only: review the target DB migration history and function contract before applying.
BEGIN;

DO $preflight$
DECLARE
  v_oid oid := to_regprocedure('public.complete_stripe_coin_purchase(uuid,text,text,integer,text)');
  v_definition text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'complete_stripe_coin_purchase(uuid,text,text,integer,text) is missing.';
  END IF;
  IF to_regclass('public.payment_orders') IS NULL
     OR to_regclass('public.stripe_payment_incidents') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.coin_transactions') IS NULL THEN
    RAISE EXCEPTION 'Required Stripe purchase tables are missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='stripe_payment_incidents_order_type_uidx'
  ) THEN
    RAISE EXCEPTION 'The incident idempotency index is missing.';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_oid)
     OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=v_oid)) <> 'postgres' THEN
    RAISE EXCEPTION 'The Stripe fulfillment function owner/security-definer contract differs.';
  END IF;
  v_definition := pg_get_functiondef(v_oid);
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'The global mutation gate is missing from the fulfillment function.';
  END IF;
  IF position('stripe_payment_incidents' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'The current fulfillment function does not match the expected incident contract.';
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
    -- Stripe payment is confirmed, but the integer balance cannot represent
    -- the credit. Mark it paid_review and record an idempotent incident.
    UPDATE public.payment_orders
    SET status = 'paid_review',
        stripe_payment_intent_id = p_payment_intent_id,
        paid_at = COALESCE(paid_at, now()),
        updated_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.stripe_payment_incidents AS existing_incident (
      payment_order_id, incident_type, stripe_payment_intent_id,
      amount_jpy, currency, details
    ) VALUES (
      v_order.id,
      'balance_overflow',
      p_payment_intent_id,
      v_order.amount_jpy,
      v_order.currency,
      jsonb_build_object(
        'reason', 'coin_balance_integer_overflow',
        'currentBalance', v_balance,
        'requestedCoinAmount', v_order.coin_amount,
        'maximumBalance', 2147483647
      )
    )
    ON CONFLICT (payment_order_id, incident_type) DO UPDATE
    SET stripe_payment_intent_id = COALESCE(
          existing_incident.stripe_payment_intent_id,
          EXCLUDED.stripe_payment_intent_id
        ),
        amount_jpy = EXCLUDED.amount_jpy,
        currency = EXCLUDED.currency,
        details = EXCLUDED.details;

    RETURN jsonb_build_object(
      'success', true,
      'alreadyProcessed', false,
      'reviewRequired', true,
      'reviewReason', 'balance_overflow',
      'status', 'paid_review',
      'coinAmount', 0
    );
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
$function$;

ALTER FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) TO service_role;

-- Band transfers are intentionally disabled at the database permission layer
-- as well as in the app API. Keep the function and historical ledger intact.
DO $transfer_acl$
BEGIN
  IF to_regprocedure('public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.transfer_band_coins(uuid,uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END;
$transfer_acl$;

NOTIFY pgrst, 'reload schema';
COMMIT;
