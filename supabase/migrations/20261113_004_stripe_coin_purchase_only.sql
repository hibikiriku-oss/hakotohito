-- Hakotohito: Stripe coin-purchase-only DB foundation
-- Replaces (does NOT run after) 20261112_002_stripe_payment_foundation.sql
-- and 20261112_003_stripe_coin_purchase_hardening.sql.
--
-- Based on the 2026-11-12 Supabase read-only snapshot and source contract
-- aligned with the 2026-11-13 Stripe coin-purchase-only source patch (third batch).
-- ARTIFACT ONLY: do not apply until the remaining source/legal review is complete.
-- Run this as one transaction in Supabase SQL Editor. Do not run 002 or 003.

BEGIN;

-- The preflight snapshot showed these Stripe tables were absent. Fail closed if
-- another attempt has since created any of them; do not silently adopt an
-- unknown/incompatible schema.
DO $preflight$
BEGIN
  IF to_regclass('public.payment_feature_settings') IS NOT NULL
     OR to_regclass('public.payment_orders') IS NOT NULL
     OR to_regclass('public.stripe_webhook_events') IS NOT NULL
     OR to_regclass('public.stripe_payment_incidents') IS NOT NULL
     OR to_regclass('public.stripe_payment_incident_actions') IS NOT NULL THEN
    RAISE EXCEPTION 'Stripe coin-purchase tables already exist. Stop and inspect the live schema; do not apply this migration over an unknown foundation.';
  END IF;

  IF to_regclass('public.coin_rate_settings') IS NULL
     OR to_regclass('public.coin_transactions') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Required Hakotohito coin tables are missing; this migration is not compatible with the current database.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coin_rate_settings'
      AND column_name = 'coin_purchase_yen_per_coin'
  ) THEN
    RAISE EXCEPTION 'coin_purchase_yen_per_coin already exists. Stop and inspect the live schema; do not reapply this migration.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.coin_rate_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'coin_rate_settings row id=1 is missing; repair the existing settings row before applying this migration.';
  END IF;

  IF to_regprocedure('public.complete_stripe_coin_purchase(uuid,text,text,integer,text)') IS NOT NULL
     OR to_regprocedure('public.manage_stripe_payment_incident(uuid,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'A Stripe coin-purchase RPC already exists. Stop and inspect the live functions; do not apply this migration.';
  END IF;
END;
$preflight$;

-- Preserve the existing coin settings and ledger. Add only the purchase rate.
ALTER TABLE public.coin_rate_settings
  ADD COLUMN coin_purchase_yen_per_coin integer NOT NULL DEFAULT 10
  CONSTRAINT coin_rate_settings_purchase_rate_check
  CHECK (coin_purchase_yen_per_coin BETWEEN 1 AND 100000);

-- The limited release exposes only this feature switch. All other Stripe
-- product surfaces (Connect, service payments, transfers and payouts) are absent.
CREATE TABLE public.payment_feature_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  coin_purchase_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_line_user_id text
);

INSERT INTO public.payment_feature_settings (id, coin_purchase_enabled)
VALUES (1, false);

-- Minimal schema matching the current coin-purchase API/webhook contract.
CREATE TABLE public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_type text NOT NULL DEFAULT 'coin_purchase'
    CHECK (payment_type = 'coin_purchase'),
  payer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount_jpy integer NOT NULL CHECK (amount_jpy BETWEEN 1 AND 315000),
  currency text NOT NULL DEFAULT 'jpy' CHECK (currency = 'jpy'),
  coin_amount integer NOT NULL CHECK (coin_amount > 0),
  coin_rate_yen integer NOT NULL CHECK (coin_rate_yen BETWEEN 1 AND 100000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','paid_review','failed','cancelled','refunded','partially_refunded')),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_checkout_url text,
  request_key text,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_orders_coin_amount_consistency
    CHECK (coin_amount::bigint * coin_rate_yen::bigint = amount_jpy::bigint)
);

CREATE INDEX payment_orders_payer_created_idx
  ON public.payment_orders (payer_user_id, created_at DESC);
CREATE INDEX payment_orders_status_created_idx
  ON public.payment_orders (status, created_at);
CREATE UNIQUE INDEX payment_orders_coin_request_key_uidx
  ON public.payment_orders (payer_user_id, request_key)
  WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX payment_orders_stripe_payment_intent_uidx
  ON public.payment_orders (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE public.stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored','failed')),
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Paid Checkout sessions belonging to accounts withdrawn before webhook
-- fulfillment are held for manual handling rather than silently crediting an
-- inactive account or losing the payment. The current UI/webhook source must
-- and admin incident UI handle paid_review before enabling.
CREATE TABLE public.stripe_payment_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id uuid NOT NULL REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  incident_type text NOT NULL,
  stripe_payment_intent_id text,
  amount_jpy integer NOT NULL CHECK (amount_jpy > 0),
  currency text NOT NULL DEFAULT 'jpy' CHECK (currency = 'jpy'),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_status text NOT NULL DEFAULT 'open'
    CHECK (resolution_status IN ('open','under_review','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_line_user_id text
);
CREATE UNIQUE INDEX stripe_payment_incidents_order_type_uidx
  ON public.stripe_payment_incidents (payment_order_id, incident_type);
CREATE INDEX stripe_payment_incidents_status_created_idx
  ON public.stripe_payment_incidents (resolution_status, created_at DESC);

-- Immutable admin action history for refund/dispute/manual-review handling.
CREATE TABLE public.stripe_payment_incident_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.stripe_payment_incidents(id) ON DELETE RESTRICT,
  admin_line_user_id text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('under_review','resolved','dismissed')),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stripe_payment_incident_actions_incident_created_idx
  ON public.stripe_payment_incident_actions (incident_id, created_at);

-- No client-side table access. Server routes use the service-role client.
ALTER TABLE public.payment_feature_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_payment_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_payment_incident_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_feature_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payment_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stripe_payment_incidents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stripe_payment_incident_actions FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_feature_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_webhook_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_payment_incidents TO service_role;
GRANT SELECT ON public.stripe_payment_incident_actions TO service_role;

-- Atomic fulfillment: lock the order and user, verify the complete Stripe
-- payment tuple, then either credit once or hold a withdrawn-account payment.
CREATE FUNCTION public.complete_stripe_coin_purchase(
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_paid_amount integer,
  p_currency text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
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
    -- Stripe has confirmed payment, but the application balance cannot safely
    -- represent the credit. Preserve the paid order for manual review instead
    -- of leaving it pending and causing an endless webhook retry loop.
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

CREATE FUNCTION public.manage_stripe_payment_incident(
  p_incident_id uuid,
  p_admin_line_user_id text,
  p_action text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_incident public.stripe_payment_incidents%ROWTYPE;
BEGIN
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
$function$;

REVOKE ALL ON FUNCTION public.manage_stripe_payment_incident(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_stripe_payment_incident(uuid,text,text,text)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text)
  TO service_role;

COMMIT;
