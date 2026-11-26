-- 2026-11-27 read-only production preflight for the event cancellation
-- and performance-request deletion remediation. This script performs SELECTs only.

-- 1. Required RPC/table presence before applying the candidate migrations.
SELECT
  to_regprocedure('public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)')
    AS cancellation_core_rpc,
  to_regprocedure('public.cancel_event_request_with_notification_outbox(uuid,uuid,uuid)')
    AS event_cancel_outbox_rpc_before_fix,
  to_regprocedure('public.delete_open_performance_request_atomic(uuid,uuid,text)')
    AS request_delete_rpc,
  to_regclass('public.line_notification_outbox') AS line_notification_outbox,
  to_regprocedure('public.acquire_global_mutation_gate_trigger()') AS global_gate_function;

-- 2. Outbox columns used by the event-cancellation wrapper.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='line_notification_outbox'
ORDER BY ordinal_position;

-- 3. All foreign keys referencing performance_requests, including exact
-- delete action and validation state. Expected count: 7.
SELECT
  child_ns.nspname AS child_schema,
  child.relname AS child_table,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid, true) AS definition,
  con.confdeltype AS delete_action_code,
  con.convalidated AS validated
FROM pg_constraint con
JOIN pg_class child ON child.oid=con.conrelid
JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
WHERE con.contype='f'
  AND con.confrelid='public.performance_requests'::regclass
ORDER BY child_ns.nspname, child.relname, con.conname;

-- 4. Trigger inventory for every known dependency and the parent request.
SELECT
  n.nspname AS table_schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  pg_get_triggerdef(t.oid, true) AS trigger_definition,
  p.oid::regprocedure AS trigger_function
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal
  AND n.nspname='public'
  AND c.relname = ANY(ARRAY[
    'performance_requests','applications','matches','application_attempts',
    'application_band_trade_history','application_participant_claims',
    'coin_transactions','match_fee_snapshots','facilities','users',
    'line_notification_outbox'
  ])
ORDER BY c.relname,t.tgname;

-- 5. Candidate request history counts. A request is physically deletable
-- only when every count below is zero and status is open.
SELECT
  pr.id,
  pr.title,
  pr.request_type,
  pr.status,
  pr.application_deadline,
  (SELECT count(*) FROM public.applications x WHERE x.request_id=pr.id) AS applications,
  (SELECT count(*) FROM public.matches x WHERE x.request_id=pr.id) AS matches,
  (SELECT count(*) FROM public.application_attempts x WHERE x.request_id=pr.id) AS application_attempts,
  (SELECT count(*) FROM public.application_band_trade_history x WHERE x.request_id=pr.id) AS band_trade_history,
  (SELECT count(*) FROM public.application_participant_claims x WHERE x.request_id=pr.id) AS participant_claims,
  (SELECT count(*) FROM public.coin_transactions x WHERE x.request_id=pr.id) AS coin_transactions,
  (SELECT count(*) FROM public.match_fee_snapshots x WHERE x.request_id=pr.id) AS match_fee_snapshots
FROM public.performance_requests pr
WHERE pr.status='open'
ORDER BY pr.created_at DESC;

-- 6. Current function owner, SECURITY DEFINER flag, and ACL.
SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.proacl AS function_acl,
  p.proconfig AS function_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'cancel_event_request_with_refund_internal',
    'cancel_event_request_with_notification_outbox',
    'delete_open_performance_request_atomic',
    'acquire_global_mutation_gate_trigger'
  )
ORDER BY p.proname,p.oid::regprocedure::text;
