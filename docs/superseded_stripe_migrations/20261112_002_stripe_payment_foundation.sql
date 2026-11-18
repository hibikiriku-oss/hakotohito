-- Hakotohito Stripe payment foundation
-- This migration is an artifact only. Apply to Supabase only after review.
BEGIN;

ALTER TABLE public.coin_rate_settings
  ADD COLUMN IF NOT EXISTS coin_purchase_yen_per_coin integer NOT NULL DEFAULT 10
  CHECK (coin_purchase_yen_per_coin BETWEEN 1 AND 100000);

CREATE TABLE IF NOT EXISTS public.payment_feature_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  coin_purchase_enabled boolean NOT NULL DEFAULT false,
  connect_onboarding_enabled boolean NOT NULL DEFAULT false,
  session_payment_enabled boolean NOT NULL DEFAULT false,
  lesson_payment_enabled boolean NOT NULL DEFAULT false,
  reward_payment_enabled boolean NOT NULL DEFAULT false,
  event_payment_enabled boolean NOT NULL DEFAULT false,
  rental_payment_enabled boolean NOT NULL DEFAULT false,
  other_payment_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_line_user_id text
);
INSERT INTO public.payment_feature_settings (id)
VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.stripe_connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  stripe_account_id text NOT NULL UNIQUE,
  account_type text NOT NULL DEFAULT 'express' CHECK (account_type IN ('express')),
  country text NOT NULL DEFAULT 'JP',
  business_type text CHECK (business_type IN ('individual','company','non_profit','government_entity')),
  details_submitted boolean NOT NULL DEFAULT false,
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  requirements_currently_due jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirements_past_due jsonb NOT NULL DEFAULT '[]'::jsonb,
  disabled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_connected_accounts_stripe_account_id_idx
  ON public.stripe_connected_accounts (stripe_account_id);

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_type text NOT NULL CHECK (payment_type IN (
    'coin_purchase','session','lesson','performer_reward','event_participation','rental','other'
  )),
  payer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  payee_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  amount_jpy integer NOT NULL CHECK (amount_jpy > 0),
  currency text NOT NULL DEFAULT 'jpy' CHECK (currency = 'jpy'),
  coin_amount integer CHECK (coin_amount IS NULL OR coin_amount > 0),
  coin_rate_yen integer CHECK (coin_rate_yen IS NULL OR coin_rate_yen > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','paid','transfer_pending','transferred','failed','cancelled','refunded','partially_refunded'
  )),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_transfer_group text,
  stripe_transfer_id text,
  transfer_amount_jpy integer CHECK (transfer_amount_jpy IS NULL OR transfer_amount_jpy > 0),
  platform_fee_jpy integer CHECK (platform_fee_jpy IS NULL OR platform_fee_jpy >= 0),
  reference_type text,
  reference_id uuid,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  transferred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (payment_type = 'coin_purchase' AND coin_amount IS NOT NULL AND coin_rate_yen IS NOT NULL AND payee_user_id IS NULL AND amount_jpy <= 315000)
    OR payment_type <> 'coin_purchase'
  )
);
CREATE INDEX IF NOT EXISTS payment_orders_payer_created_idx
  ON public.payment_orders (payer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_payee_created_idx
  ON public.payment_orders (payee_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_status_created_idx
  ON public.payment_orders (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_stripe_payment_intent_uidx
  ON public.payment_orders (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored','failed')),
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.payment_feature_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_feature_settings FROM anon, authenticated;
REVOKE ALL ON public.stripe_connected_accounts FROM anon, authenticated;
REVOKE ALL ON public.payment_orders FROM anon, authenticated;
REVOKE ALL ON public.stripe_webhook_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_feature_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_connected_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.complete_stripe_coin_purchase(
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_paid_amount integer,
  p_currency text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_balance integer;
  v_new_balance integer;
  v_idempotency_key text;
BEGIN
  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.payment_type <> 'coin_purchase' THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '購入注文が見つかりません');
  END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'alreadyProcessed', true);
  END IF;

  IF v_order.status <> 'pending'
     OR v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
     OR v_order.amount_jpy IS DISTINCT FROM p_paid_amount
     OR lower(v_order.currency) IS DISTINCT FROM lower(p_currency) THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が注文内容と一致しません');
  END IF;

  SELECT coin_balance INTO v_balance
  FROM public.users
  WHERE id = v_order.payer_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '購入ユーザーが見つかりません');
  END IF;

  v_new_balance := v_balance + v_order.coin_amount;
  v_idempotency_key := 'stripe_purchase:' || v_order.id::text;

  UPDATE public.users
  SET coin_balance = v_new_balance
  WHERE id = v_order.payer_user_id;

  INSERT INTO public.coin_transactions (
    user_id, amount, transaction_type, description, balance_after,
    created_by_user_id, idempotency_key
  ) VALUES (
    v_order.payer_user_id,
    v_order.coin_amount,
    'purchase_credit',
    'Stripeコイン購入（' || v_order.amount_jpy::text || '円）',
    v_new_balance,
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
    'coinAmount', v_order.coin_amount,
    'balanceAfter', v_new_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_stripe_service_payment(
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_paid_amount integer,
  p_currency text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.payment_type = 'coin_purchase' THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'サービス決済注文が見つかりません');
  END IF;

  IF v_order.status IN ('paid','transfer_pending','transferred') THEN
    RETURN jsonb_build_object('success', true, 'alreadyProcessed', true);
  END IF;

  IF v_order.status <> 'pending'
     OR v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
     OR v_order.amount_jpy IS DISTINCT FROM p_paid_amount
     OR lower(v_order.currency) IS DISTINCT FROM lower(p_currency) THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が注文内容と一致しません');
  END IF;

  UPDATE public.payment_orders
  SET status = 'paid',
      stripe_payment_intent_id = p_payment_intent_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  RETURN jsonb_build_object('success', true, 'alreadyProcessed', false, 'orderId', v_order.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_stripe_service_payment(uuid,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_service_payment(uuid,text,text,integer,text) TO service_role;

COMMIT;
