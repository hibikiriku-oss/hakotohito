-- V48 preflight: SELECT-only. No database changes.
SELECT 'application_attempts' AS object_name, to_regclass('public.application_attempts') IS NOT NULL AS exists
UNION ALL SELECT 'line_notification_outbox', to_regclass('public.line_notification_outbox') IS NOT NULL
UNION ALL SELECT 'bands', to_regclass('public.bands') IS NOT NULL
UNION ALL SELECT 'band_members', to_regclass('public.band_members') IS NOT NULL
UNION ALL SELECT 'matches', to_regclass('public.matches') IS NOT NULL;

SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('application_attempts','matches')
  AND NOT t.tgisinternal
ORDER BY c.relname,t.tgname;

SELECT
  count(*) FILTER (WHERE aa.status='pending' AND aa.band_id IS NOT NULL) AS pending_band_attempts,
  count(*) FILTER (WHERE aa.status='pending' AND aa.band_id IS NOT NULL AND aa.match_id IS NULL) AS pending_unmatched_band_attempts,
  count(*) FILTER (WHERE aa.band_id IS NULL) AS personal_or_direct_attempts,
  count(*) FILTER (WHERE aa.band_id IS NOT NULL) AS band_attempts
FROM public.application_attempts aa;

SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid='public.application_attempts'::regclass
ORDER BY conname;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN ('application_attempts','matches')
ORDER BY tablename,indexname;

SELECT
  count(*) FILTER (WHERE status='pending') AS pending_outbox,
  count(*) FILTER (WHERE status='processing') AS processing_outbox,
  count(*) FILTER (WHERE status='failed') AS failed_outbox
FROM public.line_notification_outbox;
