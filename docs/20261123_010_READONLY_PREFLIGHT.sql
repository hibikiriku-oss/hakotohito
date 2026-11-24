-- Hakotohito V48 / 2026-11-23
-- READ-ONLY preflight for migration 20261123_010.
-- Run in Supabase SQL Editor against the intended database BEFORE applying any migration.
-- This file contains SELECT statements only and does not modify application data or schema.

-- 1) Required tables and relevant columns.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'payment_orders', 'payment_feature_settings', 'coin_rate_settings',
    'stripe_payment_incidents', 'users', 'coin_transactions'
  )
ORDER BY table_name, ordinal_position;

-- 2) Required functions, identity arguments, owner, SECURITY DEFINER and full definitions.
SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'complete_stripe_coin_purchase',
    'claim_stripe_webhook_event',
    'manage_stripe_payment_incident',
    'record_stripe_payment_incident_ordered',
    'transfer_band_coins',
    'acquire_global_mutation_gate_trigger'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

-- 3) Function execution privileges. Expected for coin fulfillment:
-- postgres owns the SECURITY DEFINER function; service_role can execute;
-- PUBLIC, anon and authenticated cannot execute.
SELECT
  p.oid::regprocedure AS function_signature,
  grantee.rolname AS grantee,
  privilege.privilege_type,
  privilege.is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege
LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
WHERE n.nspname = 'public'
  AND p.proname IN ('complete_stripe_coin_purchase', 'transfer_band_coins')
ORDER BY function_signature::text, grantee.rolname, privilege.privilege_type;

-- 4) Required incident idempotency index and other relevant unique indexes.
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('stripe_payment_incidents', 'payment_orders', 'coin_transactions')
ORDER BY tablename, indexname;

-- 5) Global mutation-gate triggers on tables touched by Stripe fulfillment.
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled,
  p.oid::regprocedure AS trigger_function
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN ('payment_orders', 'users', 'stripe_webhook_events', 'stripe_payment_incidents')
ORDER BY c.relname, t.tgname;

-- 6) Current feature flag and coin purchase rate (configuration only; no secrets).
SELECT id, coin_purchase_enabled, updated_at
FROM public.payment_feature_settings
WHERE id = 1;

SELECT id, coin_purchase_yen_per_coin
FROM public.coin_rate_settings
WHERE id = 1;

-- 7) Applied migration history, if the standard Supabase history table exists.
-- Run this query only if to_regclass('supabase_migrations.schema_migrations') is non-NULL:
-- SELECT version, name FROM supabase_migrations.schema_migrations
-- WHERE version >= '20261113004' ORDER BY version;

-- 8) Check the existence of the history table without erroring if absent.
SELECT to_regclass('supabase_migrations.schema_migrations') AS supabase_migration_history_table;
