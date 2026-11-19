-- Read-only preflight for 20261118_004_harden_line_notification_outbox.sql.
-- Run in Supabase SQL Editor before considering the migration. No writes.

-- 1. Required tables, columns, and indexes.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('line_notification_outbox', 'users')
  AND (table_name = 'users' AND column_name IN ('id', 'line_user_id', 'account_status')
       OR table_name = 'line_notification_outbox')
ORDER BY table_name, ordinal_position;

-- 2. Outbox status counts and legacy rows that cannot safely be identity-bound.
SELECT status, COUNT(*) AS rows,
       COUNT(*) FILTER (WHERE recipient_line_user_id IS NULL OR recipient_line_user_id = '') AS blank_line_ids,
       MIN(created_at) AS oldest_created_at,
       MAX(created_at) AS newest_created_at
FROM public.line_notification_outbox
GROUP BY status
ORDER BY status;

-- 3. Duplicate active LINE identities. Return aggregate counts only; do not
-- expose raw LINE user IDs in the preflight output. Any non-zero result must be
-- investigated privately before migration 004.
SELECT COUNT(*) AS duplicate_line_id_groups,
       COALESCE(SUM(active_accounts), 0) AS affected_active_accounts
FROM (
  SELECT COUNT(*) AS active_accounts
  FROM public.users
  WHERE account_status = 'active'
    AND NULLIF(line_user_id, '') IS NOT NULL
    AND line_user_id NOT LIKE 'withdrawn:%'
  GROUP BY line_user_id
  HAVING COUNT(*) > 1
) AS duplicate_groups;

-- 4. Current worker RPC signatures and SECURITY DEFINER settings.
SELECT p.oid::regprocedure AS signature, p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
       pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'claim_line_notification_outbox',
    'complete_line_notification_outbox',
    'retry_line_notification_outbox',
    'bind_line_notification_outbox_recipient'
  )
ORDER BY signature::text;

-- 5. Outbox triggers and table privileges.
SELECT t.tgname, t.tgenabled,
       (t.tgenabled IN ('O', 'A')) AS enabled_for_normal_sessions,
       t.tgfoid::regprocedure AS trigger_function,
       pg_get_triggerdef(t.oid, true) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'line_notification_outbox'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'line_notification_outbox'
ORDER BY grantee, privilege_type;

-- 6. Hakotohito migration-stage markers. Supabase's internal
-- auth.schema_migrations / realtime.schema_migrations / storage.migrations
-- are platform histories, not this application's SQL migration ledger.
-- Record each SQL filename and successful COMMIT manually in PUBLIC_RELEASE_CHECKLIST.md.
SELECT marker, present
FROM (VALUES
  ('global_mutation_gate_function', to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NOT NULL),
  ('application_attempts_table', to_regclass('public.application_attempts') IS NOT NULL),
  ('line_notification_outbox_table', to_regclass('public.line_notification_outbox') IS NOT NULL),
  ('legacy_claim_rpc', to_regprocedure('public.claim_line_notification_outbox(integer)') IS NOT NULL),
  ('legacy_complete_rpc', to_regprocedure('public.complete_line_notification_outbox(uuid)') IS NOT NULL),
  ('legacy_retry_rpc', to_regprocedure('public.retry_line_notification_outbox(uuid,text)') IS NOT NULL),
  ('withdrawal_outbox_wrapper', to_regprocedure('public.withdraw_user_account_with_notification_outbox(text)') IS NOT NULL),
  ('payment_feature_settings', to_regclass('public.payment_feature_settings') IS NOT NULL)
) AS markers(marker, present)
ORDER BY marker;
