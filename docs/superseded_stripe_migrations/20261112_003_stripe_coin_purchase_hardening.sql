-- Stripe coin-purchase-only hardening. Artifact only; do not apply before live DB preflight.
BEGIN;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS request_key text;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS stripe_checkout_url text;
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_coin_request_key_uidx
  ON public.payment_orders (payer_user_id, request_key)
  WHERE payment_type = 'coin_purchase' AND request_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_stripe_payment_intent_uidx
  ON public.payment_orders (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

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
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_balance integer;
  v_new_balance integer;
  v_idempotency_key text;
  v_existing_order_id uuid;
BEGIN
  IF p_order_id IS NULL OR NULLIF(p_checkout_session_id, '') IS NULL
     OR NULLIF(p_payment_intent_id, '') IS NULL OR p_paid_amount IS NULL
     OR lower(COALESCE(p_currency, '')) <> 'jpy' THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が不正です');
  END IF;

  SELECT * INTO v_order FROM public.payment_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.payment_type <> 'coin_purchase' THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '購入注文が見つかりません');
  END IF;

  IF v_order.status = 'paid' THEN
    IF v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
       OR v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
       OR v_order.amount_jpy IS DISTINCT FROM p_paid_amount THEN
      RETURN jsonb_build_object('success', false, 'errorMessage', '処理済み注文の決済情報が一致しません');
    END IF;
    RETURN jsonb_build_object('success', true, 'alreadyProcessed', true);
  END IF;

  IF v_order.status <> 'pending'
     OR v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
     OR v_order.amount_jpy IS DISTINCT FROM p_paid_amount
     OR lower(v_order.currency) <> 'jpy'
     OR v_order.coin_amount IS NULL OR v_order.coin_rate_yen IS NULL
     OR v_order.coin_amount::bigint * v_order.coin_rate_yen::bigint <> v_order.amount_jpy::bigint THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が注文内容と一致しません');
  END IF;

  SELECT id INTO v_existing_order_id FROM public.payment_orders
  WHERE stripe_payment_intent_id = p_payment_intent_id AND id <> v_order.id;
  IF FOUND THEN RETURN jsonb_build_object('success', false, 'errorMessage', 'Payment Intentは別注文で使用済みです'); END IF;

  SELECT coin_balance INTO v_balance FROM public.users WHERE id = v_order.payer_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'errorMessage', '購入ユーザーが見つかりません'); END IF;
  v_new_balance := v_balance + v_order.coin_amount;
  v_idempotency_key := 'stripe_purchase:' || v_order.id::text;

  UPDATE public.users SET coin_balance = v_new_balance WHERE id = v_order.payer_user_id;
  INSERT INTO public.coin_transactions (user_id, amount, transaction_type, description, balance_after, created_by_user_id, idempotency_key)
  VALUES (v_order.payer_user_id, v_order.coin_amount, 'purchase_credit', 'Stripeコイン購入（' || v_order.amount_jpy::text || '円）', v_new_balance, v_order.payer_user_id, v_idempotency_key);
  UPDATE public.payment_orders SET status = 'paid', stripe_payment_intent_id = p_payment_intent_id, paid_at = now(), updated_at = now() WHERE id = v_order.id;
  RETURN jsonb_build_object('success', true, 'alreadyProcessed', false, 'coinAmount', v_order.coin_amount, 'balanceAfter', v_new_balance);
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_stripe_coin_purchase(uuid,text,text,integer,text) TO service_role;
COMMIT;
