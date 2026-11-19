-- Hakotohito Phase 2 v29: READ-ONLY Tokyo Supabase preflight
-- Execute only against the intended Tokyo project after confirming its project reference.
-- No INSERT/UPDATE/DELETE/DDL/sequence calls. Results contain aggregate counts and catalog metadata only.

-- 1) Migration history. The dynamic query avoids a parse-time error if the
-- standard Supabase migration-history table is absent in this project.
DO $migration_history$
DECLARE v_rows jsonb;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE 'supabase_migrations.schema_migrations not found; inspect migration history manually';
  ELSE
    EXECUTE $q$
      SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.version), '[]'::jsonb)
      FROM supabase_migrations.schema_migrations m
      WHERE m.version LIKE '20261114%' OR m.version LIKE '20261116%' OR m.version LIKE '20261118%'
    $q$ INTO v_rows;
    RAISE NOTICE 'Relevant applied migrations: %', v_rows;
  END IF;
END;
$migration_history$;

-- 2) Relevant columns and exact data types.
SELECT table_name, column_name, data_type, udt_schema, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND (table_name, column_name) IN (
    ('users','user_type'),('users','account_status'),('performers','user_id'),
    ('facilities','user_id'),('applications','status'),('application_attempts','status'),
    ('lesson_applications','status'),('line_notification_outbox','recipient_user_id'),
    ('line_notification_outbox','lease_token'),('line_notification_outbox','status')
  )
ORDER BY table_name, ordinal_position;

-- 3) Constraints affecting role uniqueness and lesson status transitions.
SELECT c.conrelid::regclass AS relation_name, c.conname, c.contype,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid IN (
  to_regclass('public.performers'), to_regclass('public.facilities'),
  to_regclass('public.lesson_applications'), to_regclass('public.applications')
)
ORDER BY relation_name::text, c.conname;

-- 4) Trigger state and timing for lifecycle/Outbox tables.
SELECT c.relname AS table_name, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid, true) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND c.relname IN ('users','applications','application_attempts','lesson_applications',
                    'band_invitations','bands','band_members','line_notification_outbox')
ORDER BY c.relname, t.tgname;

-- 5) Current function signatures, security-definer flag, owner, and definition hash.
SELECT p.oid::regprocedure AS signature, p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS owner,
       md5(pg_get_functiondef(p.oid)) AS definition_md5,
       p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'withdraw_user_account','withdraw_user_account_with_notification_outbox',
    'claim_line_notification_outbox','complete_line_notification_outbox',
    'retry_line_notification_outbox','apply_to_performance_request',
    'apply_to_performance_request_as_band'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

-- 6) Dual-role profile aggregate only; no user IDs or personal data.
SELECT
  count(DISTINCT p.id) AS performer_profile_count,
  count(DISTINCT f.id) AS facility_profile_count,
  count(DISTINCT u.id) FILTER (WHERE p.user_id IS NOT NULL AND f.user_id IS NOT NULL) AS dual_profile_user_count
FROM public.users u
LEFT JOIN public.performers p ON p.user_id=u.id
LEFT JOIN public.facilities f ON f.user_id=u.id
WHERE u.account_status='active';

-- 7) Current Outbox aggregate only; do not export recipient identifiers or message bodies.
SELECT status, count(*) AS row_count,
       min(created_at) AS oldest_created_at,
       min(available_at) FILTER (WHERE status='pending') AS oldest_pending_available_at,
       count(*) FILTER (WHERE recipient_user_id IS NULL) AS unbound_recipient_count,
       count(*) FILTER (WHERE status='processing' AND lease_token IS NULL) AS processing_without_lease_count
FROM public.line_notification_outbox
GROUP BY status
ORDER BY status;

-- 8) Active and pending lifecycle aggregates after the latest test-data reset.
SELECT 'applications' AS source, status, count(*) AS row_count
FROM public.applications GROUP BY status
UNION ALL
SELECT 'application_attempts', status, count(*) FROM public.application_attempts GROUP BY status
UNION ALL
SELECT 'lesson_applications', status, count(*) FROM public.lesson_applications GROUP BY status
UNION ALL
SELECT 'band_invitations', status, count(*) FROM public.band_invitations GROUP BY status
ORDER BY source, status;

-- 9) Verify the current function's role branch and wrapper call without returning the full body.
SELECT p.oid::regprocedure AS signature,
       position('v_user.user_type' IN pg_get_functiondef(p.oid)) > 0 AS branches_on_primary_user_type,
       position('v_is_performer' IN pg_get_functiondef(p.oid)) > 0 AS has_dual_performer_flag,
       position('v_is_facility' IN pg_get_functiondef(p.oid)) > 0 AS has_dual_facility_flag,
       position('pg_advisory_xact_lock(2147483000, 20261116)' IN pg_get_functiondef(p.oid)) > 0 AS acquires_global_gate
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.oid=to_regprocedure('public.withdraw_user_account(text)');
