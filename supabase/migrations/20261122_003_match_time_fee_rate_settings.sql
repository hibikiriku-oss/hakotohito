-- V48.003: independent admin-managed rates for fees charged at match establishment.
-- Existing completion_fee_percent and paid_lesson_fee_percent are retained for
-- historical/legacy paths and are not silently repurposed as the new 10% rates.
BEGIN;

ALTER TABLE public.coin_rate_settings
  ADD COLUMN IF NOT EXISTS performance_reward_fee_percent numeric(5,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS lesson_match_fee_percent numeric(5,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS coin_purchase_yen_per_coin integer NOT NULL DEFAULT 10;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coin_rate_settings'::regclass
      AND conname = 'coin_rate_settings_performance_reward_fee_percent_check'
  ) THEN
    ALTER TABLE public.coin_rate_settings
      ADD CONSTRAINT coin_rate_settings_performance_reward_fee_percent_check
      CHECK (performance_reward_fee_percent >= 0 AND performance_reward_fee_percent <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coin_rate_settings'::regclass
      AND conname = 'coin_rate_settings_lesson_match_fee_percent_check'
  ) THEN
    ALTER TABLE public.coin_rate_settings
      ADD CONSTRAINT coin_rate_settings_lesson_match_fee_percent_check
      CHECK (lesson_match_fee_percent >= 0 AND lesson_match_fee_percent <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.coin_rate_settings'::regclass
      AND conname = 'coin_rate_settings_coin_purchase_yen_per_coin_check'
  ) THEN
    ALTER TABLE public.coin_rate_settings
      ADD CONSTRAINT coin_rate_settings_coin_purchase_yen_per_coin_check
      CHECK (coin_purchase_yen_per_coin >= 1 AND coin_purchase_yen_per_coin <= 100000);
  END IF;
END;
$constraints$;

COMMIT;
