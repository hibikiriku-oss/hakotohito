-- Hakotohito production preflight (READ ONLY)
-- Run in Supabase SQL Editor against the exact production project.
-- This script performs SELECTs only. It does not create/alter/drop objects or mutate data.

-- 1) Discover the application's migration ledger; do not assume auth/realtime schema_migrations is relevant.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p')
  AND (c.relname ILIKE '%migration%' OR c.relname ILIKE '%schema_version%' OR c.relname ILIKE '%version%')
ORDER BY n.nspname, c.relname;

-- 2) Return complete live definitions for all lifecycle/fee/refund RPCs and helpers.
-- Output can be large. Preserve every returned definition verbatim.
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       pg_catalog.array_to_string(p.proacl, E'\n') AS acl,
       pg_catalog.pg_get_functiondef(p.oid) AS full_definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = ANY (ARRAY[
    'apply_to_lesson_offer',
    'cancel_event_request_with_refund_internal',
    'cancel_match_with_direct_invite_refund',
    'complete_match_with_fee',
    'spend_coins',
    'spend_coins_legacy',
    'withdraw_user_account',
    'reject_direct_invitation_with_refund_for_withdrawal',
    'reject_direct_invitation_with_refund',
    'charge_event_match_transaction_fee_at_match',
    'charge_performance_reward_fee_at_match',
    'charge_lesson_match_fee_at_match',
    'auto_reject_excess_applications_with_refund',
    'accept_application_with_coins'
  ])
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- 3) Exact migration ledger contents, if a likely app ledger exists.
-- First result identifies candidates. Run a SELECT against the confirmed app ledger table separately.
-- Do not treat auth.schema_migrations or realtime.schema_migrations as the app migration ledger.

-- 4) coin_transactions constraints, indexes, triggers, and RLS state.
SELECT con.conname, con.contype, pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
WHERE con.conrelid = 'public.coin_transactions'::regclass
ORDER BY con.contype, con.conname;

SELECT indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public' AND tablename = 'coin_transactions'
ORDER BY indexname;

SELECT t.tgname, pg_catalog.pg_get_triggerdef(t.oid, true) AS definition,
       t.tgenabled
FROM pg_catalog.pg_trigger t
WHERE t.tgrelid = 'public.coin_transactions'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class c
WHERE c.oid = 'public.coin_transactions'::regclass;

-- 5) Confirm all V48 dependencies and relevant lifecycle columns.
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = ANY (ARRAY[
    'coin_transactions','users','matches','applications','application_attempts',
    'performance_requests','performers','facilities','lesson_offers','lesson_applications',
    'match_fee_snapshots','lesson_fee_snapshots','application_band_trade_history',
    'application_participant_claims','bands','band_members','band_invitations'
  ])
ORDER BY table_name, ordinal_position;

-- 6) Band membership fields and constraints needed to transfer leadership safely.
SELECT con.conrelid::regclass AS table_name, con.conname, con.contype,
       pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
WHERE con.conrelid IN (
  SELECT c.oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('bands', 'band_members')
)
ORDER BY con.conrelid::regclass::text, con.conname;

-- 7) Current live migration table data is intentionally not queried automatically:
-- once section 1 identifies the application ledger, query that exact table and capture all rows.
-- This avoids accidentally reporting Supabase auth/realtime internal migration records as app migrations.
