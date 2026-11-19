-- Read-only postflight verification for 20261113_004_stripe_coin_purchase_only.sql
-- Run only AFTER the migration has been applied. This script makes no changes.

-- 1) Required tables and RLS state.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'payment_feature_settings', 'payment_orders', 'stripe_webhook_events',
    'stripe_payment_incidents', 'stripe_payment_incident_actions'
  )
ORDER BY c.relname;

-- 2) Purchase-rate column.
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'coin_rate_settings'
  AND column_name = 'coin_purchase_yen_per_coin';

-- 3) New table columns.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'payment_feature_settings', 'payment_orders', 'stripe_webhook_events',
    'stripe_payment_incidents', 'stripe_payment_incident_actions'
  )
ORDER BY table_name, ordinal_position;

-- 4) Constraints and indexes.
SELECT
  t.relname AS table_name,
  i.relname AS index_name,
  ix.indisunique AS is_unique,
  pg_get_indexdef(ix.indexrelid) AS index_definition
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN (
    'payment_orders', 'stripe_webhook_events',
    'stripe_payment_incidents', 'stripe_payment_incident_actions'
  )
ORDER BY t.relname, i.relname;

-- 5) Table privileges: service_role should have required access; anon/authenticated none.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'payment_feature_settings', 'payment_orders', 'stripe_webhook_events',
    'stripe_payment_incidents', 'stripe_payment_incident_actions'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- 6) Function security, search_path and execution privileges.
SELECT
  p.oid::regprocedure AS function_signature,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('complete_stripe_coin_purchase', 'manage_stripe_payment_incident')
ORDER BY p.proname;

-- 7) Confirm the feature switch starts disabled and show the configured rate.
SELECT id, coin_purchase_enabled, updated_at
FROM public.payment_feature_settings
WHERE id = 1;

SELECT id, coin_purchase_yen_per_coin, updated_at
FROM public.coin_rate_settings
ORDER BY id;
