-- 2026-11-27 read-only postflight after applying 20261127_001 and _002.

-- 1. RPC signatures, owner, SECURITY DEFINER, and ACL.
SELECT
  p.oid::regprocedure AS function_signature,
  pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.proacl AS function_acl,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.oid IN (
    to_regprocedure('public.cancel_event_request_with_notification_outbox(uuid,uuid,uuid)'),
    to_regprocedure('public.delete_open_performance_request_atomic(uuid,uuid,text)')
  )
ORDER BY p.proname;

-- 2. Required global mutation gate triggers.
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  p.oid::regprocedure AS trigger_function
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_proc p ON p.oid=t.tgfoid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND t.tgname='trg_global_mutation_gate'
  AND c.relname = ANY(ARRAY[
    'performance_requests','applications','matches','application_attempts',
    'application_band_trade_history','application_participant_claims',
    'coin_transactions','match_fee_snapshots','facilities','users',
    'line_notification_outbox'
  ])
ORDER BY c.relname;

-- 3. Confirm the reviewed seven-FK graph remains unchanged.
SELECT
  child.relname AS child_table,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid, true) AS definition,
  con.convalidated AS validated
FROM pg_constraint con
JOIN pg_class child ON child.oid=con.conrelid
JOIN pg_namespace n ON n.oid=child.relnamespace
WHERE con.contype='f'
  AND con.confrelid='public.performance_requests'::regclass
  AND n.nspname='public'
ORDER BY child.relname,con.conname;
