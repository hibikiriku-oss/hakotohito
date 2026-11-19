-- Hakotohito: force Stripe coin purchases off for the limited release.
-- This is a release-policy guard, not a substitute for disabling outstanding
-- Stripe Checkout Sessions that may already have been created.
BEGIN;

UPDATE public.payment_feature_settings
SET coin_purchase_enabled = false,
    updated_at = now(),
    updated_by_line_user_id = NULL
WHERE id = 1;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_feature_settings
    WHERE id = 1 AND coin_purchase_enabled = false
  ) THEN
    RAISE EXCEPTION 'payment_feature_settings row id=1 is missing or could not be disabled';
  END IF;
END;
$check$;

COMMIT;
