-- Prevent parallel tabs/retries from creating multiple payable coin-purchase orders per user.
-- Existing production payment_orders were confirmed empty before preparing this candidate.
-- Serialize the preflight and index creation with all gated payment-order writes.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $migration$
DECLARE
  v_duplicate_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT payer_user_id
    FROM public.payment_orders
    WHERE payment_type = 'coin_purchase' AND status = 'pending'
    GROUP BY payer_user_id
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot create one-pending-coin-order index: % users have duplicate pending orders', v_duplicate_count;
  END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_one_pending_coin_purchase_per_user_idx
  ON public.payment_orders (payer_user_id)
  WHERE payment_type = 'coin_purchase' AND status = 'pending';

COMMIT;
