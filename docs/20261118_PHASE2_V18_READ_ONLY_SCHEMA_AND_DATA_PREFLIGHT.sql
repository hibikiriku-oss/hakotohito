-- Hakotohito v18: read-only schema, dependency, and aggregate data preflight.
-- Run only against the intended Tokyo Supabase project.
-- SELECT/catalog inspection only. No DDL, DML, RPC invocation, explicit locks,
-- settings changes, or personal identifiers/free-text are returned.

-- [01] Database identity and snapshot time.
SELECT current_database() AS database_name,
       current_user AS inspection_role,
       session_user AS session_role,
       current_setting('server_version') AS postgres_version,
       now() AS captured_at;

-- [02] Candidate dependency objects.
SELECT x.object_name,
       to_regclass('public.' || x.object_name) AS relation,
       to_regprocedure(x.routine_signature) AS routine
FROM (VALUES
  ('payment_orders',''),
  ('stripe_webhook_events','public.claim_stripe_webhook_event(text,text)'),
  ('stripe_payment_incidents','public.record_stripe_payment_incident_ordered(uuid,text,text,uuid,bigint,text,text,bigint,text,text,text,text)'),
  ('stripe_payment_incidents','public.manage_stripe_payment_incident(uuid,text,text,text)'),
  ('bands','public.create_band_invitation_atomic(uuid,uuid,uuid,text,text)'),
  ('band_members',''),
  ('band_invitations',''),
  ('band_messages','public.send_band_chat_message_atomic(uuid,uuid,text,text)'),
  ('band_messages','public.get_band_chat_messages_atomic(uuid,uuid,text)'),
  ('matches','public.send_match_chat_message_atomic(uuid,uuid,text,text)'),
  ('matches',''),
  ('conversations','public.acquire_global_mutation_gate_trigger()'),
  ('messages','public.get_match_chat_page_atomic(uuid,uuid,boolean,timestamptz,uuid,integer,text)'),
  ('performance_requests','public.delete_open_performance_request_atomic(uuid,uuid,text)'),
  ('applications',''),('facilities',''),('performers',''),('users',''),
  ('application_attempts',''),('line_notification_outbox','public.enqueue_band_invitation_line_notification()')
) AS x(object_name, routine_signature)
ORDER BY object_name;

-- [03] Actual columns for all relevant tables. Empty result means missing object.
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN (
    'payment_orders','stripe_webhook_events','stripe_payment_incidents',
    'stripe_payment_incident_actions','bands','band_members','band_invitations',
    'band_messages','matches','applications','conversations','messages','users',
    'performers','performance_requests','facilities','application_attempts',
    'line_notification_outbox'
  )
ORDER BY table_name, ordinal_position;

-- [04] Unique indexes/constraints relevant to idempotency and conversation creation.
SELECT c.relname AS table_name, i.indisunique, i.indisvalid,
       i.indpred IS NULL AS non_partial,
       pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index i
JOIN pg_class c ON c.oid=i.indrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('conversations','stripe_webhook_events',
                    'stripe_payment_incidents','band_invitations')
ORDER BY c.relname, i.indisunique DESC, pg_get_indexdef(i.indexrelid);

-- [05] All foreign keys referencing performance_requests, including ON DELETE behavior.
SELECT conrelid::regclass AS referencing_table,
       conname,
       CASE confdeltype
         WHEN 'a' THEN 'NO ACTION'
         WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
         ELSE 'UNKNOWN'
       END AS on_delete,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype='f'
  AND confrelid=to_regclass('public.performance_requests')
ORDER BY conrelid::regclass::text, conname;

-- [06] Relevant triggers, including disabled-state visibility.
SELECT c.relname AS table_name, t.tgname AS trigger_name,
       t.tgenabled AS enabled_state,
       pg_get_triggerdef(t.oid, true) AS trigger_definition,
       p.oid::regprocedure AS trigger_function,
       p.prosecdef AS trigger_function_security_definer,
       p.proconfig AS trigger_function_settings
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND c.relname IN (
    'users','performers','facilities','performance_requests','applications',
    'application_attempts','matches','bands','band_members','band_invitations',
    'band_messages','conversations','messages','payment_orders',
    'stripe_webhook_events','stripe_payment_incidents','line_notification_outbox'
  )
ORDER BY c.relname, t.tgname;

-- [07] Aggregate Stripe incident metadata quality. No payment IDs or notes.
SELECT incident_type,
       resolution_status,
       COUNT(*) AS row_count,
       COUNT(*) FILTER (WHERE NULLIF(btrim(details->>'stripe_event_id'),'') IS NULL) AS missing_event_id,
       COUNT(*) FILTER (WHERE COALESCE(details->>'stripe_event_created','') !~ '^[0-9]+$') AS missing_or_invalid_event_created
FROM public.stripe_payment_incidents
GROUP BY incident_type, resolution_status
ORDER BY incident_type, resolution_status;

-- [08] Aggregate operational row counts only. No IDs or free-text.
SELECT 'applications' AS table_name, COUNT(*) AS row_count FROM public.applications
UNION ALL SELECT 'matches', COUNT(*) FROM public.matches
UNION ALL SELECT 'application_attempts', COUNT(*) FROM public.application_attempts
UNION ALL SELECT 'band_invitations', COUNT(*) FROM public.band_invitations
UNION ALL SELECT 'band_messages', COUNT(*) FROM public.band_messages
UNION ALL SELECT 'messages', COUNT(*) FROM public.messages
UNION ALL SELECT 'stripe_webhook_events', COUNT(*) FROM public.stripe_webhook_events
UNION ALL SELECT 'stripe_payment_incidents', COUNT(*) FROM public.stripe_payment_incidents
UNION ALL SELECT 'line_notification_outbox', COUNT(*) FROM public.line_notification_outbox
ORDER BY table_name;

-- [09] Lifecycle aggregates needed to assess the limited-release baseline.
SELECT status, source, COUNT(*) AS row_count
FROM public.applications
GROUP BY status, source ORDER BY status, source;

SELECT status, performance_status, COUNT(*) AS row_count,
       COUNT(*) FILTER (WHERE completion_disputed_at IS NOT NULL) AS disputed_rows,
       COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed_rows
FROM public.matches
GROUP BY status, performance_status ORDER BY status, performance_status;

-- [10] Installed migration versions, if the Supabase history table exists.
SELECT to_regclass('supabase_migrations.schema_migrations') AS migration_history_table;
-- If the table exists, run separately:
-- SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
