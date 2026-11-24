-- Hakotohito V48 Stage 1 baseline discovery (READ ONLY)
-- Tailored after the production Stage 0 result shared on 2026-11-22.
-- Catalog queries only. No application table rows, DDL, DML, RPC execution, or balance changes.
-- Run each SELECT separately in the confirmed production Supabase project.

-- [01] Confirm actual lesson-related table/column names and types.
SELECT c.table_name, c.ordinal_position, c.column_name, c.data_type,
       c.udt_name, c.is_nullable, c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'lesson_applications', 'lesson_offers', 'performers',
    'coin_rate_settings', 'coin_transactions', 'users'
  )
ORDER BY c.table_name, c.ordinal_position;

-- [02] Discover migration-history table location without assuming it exists.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name = 'schema_migrations'
ORDER BY table_schema;

-- [03] Check presence of prerequisite and V48 objects without querying absent tables.
SELECT name.object_name,
       to_regclass(format('public.%I', name.object_name)) IS NOT NULL AS exists_in_public
FROM (VALUES
  ('application_attempts'),
  ('application_participant_claims'),
  ('application_band_trade_history'),
  ('match_fee_snapshots'),
  ('lesson_fee_snapshots'),
  ('coin_rate_settings'),
  ('lesson_applications'),
  ('lesson_offers')
) AS name(object_name)
ORDER BY name.object_name;

-- [04] Current relevant RPC signatures and security metadata (definitions omitted here).
-- This safely lists overloads without assuming a particular signature exists.
SELECT p.proname,
       p.oid::regprocedure::text AS signature,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proacl AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = ANY (ARRAY[
    'apply_to_lesson_offer',
    'create_lesson_offer',
    'update_lesson_offer_with_levels',
    'cancel_match_with_direct_invite_refund',
    'cancel_event_request_with_refund_internal',
    'withdraw_user_account',
    'complete_match_with_fee',
    'spend_coins',
    'spend_coins_legacy'
  ])
ORDER BY p.proname, p.oid::regprocedure::text;

-- [05] Current migration history, ONLY after [02] identifies the schema/table.
-- Do not run this query until the exact migration-history table is confirmed.
-- If Supabase standard table exists, adapt to:
-- SELECT version, name FROM supabase_migrations.schema_migrations
-- WHERE version IN ('20261119_001','20261121_001','20261121_002',
--                   '20261122_001','20261122_002','20261122_003','20261122_004','20261122_005')
-- ORDER BY version;
