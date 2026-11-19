-- Hakotohito: atomic, fail-closed deletion of an open performance request.
-- Candidate only. Requires migrations 009 (global gate) and 010 (application_attempts).

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'Expected global mutation gate helper is missing';
  END IF;
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN
       pg_get_functiondef(to_regprocedure('public.acquire_global_mutation_gate_trigger()'))) = 0 THEN
    RAISE EXCEPTION 'Global mutation gate helper uses a different lock';
  END IF;
  IF to_regclass('public.performance_requests') IS NULL
     OR to_regclass('public.facilities') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regclass('public.matches') IS NULL
     OR to_regclass('public.application_attempts') IS NULL THEN
    RAISE EXCEPTION 'Required request deletion tables are missing; migrations 009/010 and the core schema are required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('performance_requests','id'),('performance_requests','facility_id'),('performance_requests','status'),
      ('facilities','id'),('facilities','user_id'),
      ('users','id'),('users','account_status'),('users','line_user_id'),
      ('applications','request_id'),('matches','request_id'),('application_attempts','request_id')
    ) AS required(table_name,column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=required.table_name
     AND c.column_name=required.column_name
    WHERE c.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more required columns for atomic request deletion are missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.performance_requests'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.applications'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.matches'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.application_attempts'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.facilities'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')) THEN
    RAISE EXCEPTION 'Global mutation gate is not installed on every request deletion table';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype='f' AND confrelid='public.performance_requests'::regclass
      AND conrelid NOT IN (
        'public.applications'::regclass,
        'public.matches'::regclass,
        'public.application_attempts'::regclass
      )
  ) THEN
    RAISE EXCEPTION 'Unreviewed foreign key references performance_requests; inspect all dependent tables before creating atomic delete RPC';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.performance_requests'::regclass
      AND NOT tgisinternal AND (tgtype & 8) = 8
      AND tgname <> 'trg_global_mutation_gate'
  ) THEN
    RAISE EXCEPTION 'Unreviewed DELETE trigger exists on performance_requests';
  END IF;

  IF to_regprocedure('public.delete_open_performance_request_atomic(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Atomic request delete RPC already exists; inspect before applying';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.delete_open_performance_request_atomic(
  p_request_id uuid,
  p_facility_id uuid,
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.performance_requests%ROWTYPE;
  v_application_count bigint;
  v_match_count bigint;
  v_attempt_count bigint;
  v_deleted_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_request_id IS NULL OR p_facility_id IS NULL
     OR NULLIF(btrim(COALESCE(p_line_user_id, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'invalid_input');
  END IF;

  -- Fail closed if the dependency graph or DELETE-trigger set changed after migration preflight.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.performance_requests'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.applications'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.matches'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.application_attempts'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.facilities'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE contype='f' AND confrelid='public.performance_requests'::regclass
         AND conrelid NOT IN (
           'public.applications'::regclass,
           'public.matches'::regclass,
           'public.application_attempts'::regclass
         )
     ) OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid='public.performance_requests'::regclass
         AND NOT tgisinternal AND (tgtype & 8) = 8
         AND tgname <> 'trg_global_mutation_gate'
     ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'unreviewed_dependency');
  END IF;

  SELECT * INTO v_request
  FROM public.performance_requests
  WHERE id=p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_found');
  END IF;
  IF v_request.facility_id IS DISTINCT FROM p_facility_id THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_owner');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.facilities f
    JOIN public.users u ON u.id=f.user_id
    WHERE f.id=p_facility_id AND u.account_status='active'
      AND u.line_user_id=p_line_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'facility_inactive');
  END IF;
  IF v_request.status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_open');
  END IF;

  SELECT COUNT(*) INTO v_application_count
  FROM public.applications WHERE request_id=p_request_id;
  IF v_application_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_applications', 'count', v_application_count);
  END IF;

  SELECT COUNT(*) INTO v_match_count
  FROM public.matches WHERE request_id=p_request_id;
  IF v_match_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_matches', 'count', v_match_count);
  END IF;

  -- Attempts are audit/anti-abuse history and must not be silently cascaded away.
  SELECT COUNT(*) INTO v_attempt_count
  FROM public.application_attempts WHERE request_id=p_request_id;
  IF v_attempt_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_application_attempts', 'count', v_attempt_count);
  END IF;

  DELETE FROM public.performance_requests
  WHERE id=p_request_id AND facility_id=p_facility_id AND status='open'
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'delete_compare_and_set_failed');
  END IF;

  RETURN jsonb_build_object('success', true, 'deletedRequestId', v_deleted_id);
END;
$function$;

ALTER FUNCTION public.delete_open_performance_request_atomic(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_open_performance_request_atomic(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_open_performance_request_atomic(uuid,uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
