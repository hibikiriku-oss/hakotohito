-- READ ONLY: v17 migration dependency and schema preflight.
-- Run against the intended Tokyo Supabase project before applying v17 SQL.
-- No data is modified.

SELECT current_database() AS database_name,
       current_user AS execution_role,
       now() AS captured_at;

SELECT to_regprocedure('public.acquire_global_mutation_gate_trigger()') AS mutation_gate_helper,
       to_regprocedure('public.claim_stripe_webhook_event(text,text)') AS webhook_claim_rpc,
       to_regprocedure('public.manage_stripe_payment_incident(uuid,text,text,text)') AS incident_admin_rpc;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('payment_orders','stripe_webhook_events','stripe_payment_incidents',
    'stripe_payment_incident_actions','bands','band_members','band_invitations',
    'band_messages','matches','applications','conversations','messages','users','performers',
    'performance_requests','facilities')
ORDER BY c.relname;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('payment_orders','stripe_webhook_events','stripe_payment_incidents',
    'stripe_payment_incident_actions','bands','band_members','band_invitations','band_messages',
    'matches','applications','conversations','messages','users','performers',
    'performance_requests','facilities')
ORDER BY table_name, ordinal_position;

SELECT t.relname AS table_name, tr.tgname AS trigger_name,
       pg_get_triggerdef(tr.oid) AS trigger_definition
FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND NOT tr.tgisinternal
  AND tr.tgname IN ('trg_global_mutation_gate',
    'trg_enqueue_band_invitation_created_line_notification',
    'trg_enqueue_band_invitation_response_line_notification',
    'trg_guard_stripe_payment_incident_event_ordering')
ORDER BY t.relname, tr.tgname;

SELECT i.indisunique, i.indisvalid, i.indpred IS NULL AS non_partial,
       pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index i
WHERE i.indrelid='public.conversations'::regclass
ORDER BY i.indisunique DESC, pg_get_indexdef(i.indexrelid);

SELECT id, payment_order_id, incident_type, resolution_status,
       details ->> 'stripe_event_id' AS stored_event_id,
       details ->> 'stripe_event_created' AS stored_event_created,
       stripe_payment_intent_id
FROM public.stripe_payment_incidents
WHERE incident_type LIKE 'refund:%'
   OR incident_type LIKE 'dispute:%'
   OR incident_type LIKE 'charge_refunded:%'
ORDER BY created_at DESC;

SELECT p.proname, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       p.proacl AS explicit_acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('record_stripe_payment_incident_ordered','guard_stripe_payment_incident_event_ordering',
    'create_band_invitation_atomic','send_band_chat_message_atomic',
    'send_match_chat_message_atomic')
ORDER BY p.proname;

-- Foreign keys and delete behavior for the unresolved performance-request DELETE audit.
SELECT conrelid::regclass AS referencing_table,
       conname,
       confdeltype,
       CASE confdeltype
         WHEN 'a' THEN 'NO ACTION'
         WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS on_delete,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype='f'
  AND confrelid='public.performance_requests'::regclass
ORDER BY conrelid::regclass::text, conname;

SELECT c.relname AS table_name, t.tgname AS trigger_name,
       pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND c.relname IN ('performance_requests','applications','matches')
ORDER BY c.relname, t.tgname;
