-- Reconcile atomic request deletion with the complete, current FK graph.
-- The original 20261118_008 allowlist predates the 20261122 history tables.
-- Preserve every related row: only delete a request when all seven dependent
-- tables are empty for that request.
BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
DECLARE
  v_fk_count integer;
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL
     OR position(
       'pg_advisory_xact_lock(2147483000, 20261116)'
       IN pg_get_functiondef(to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     ) = 0 THEN
    RAISE EXCEPTION 'Expected global mutation gate helper is missing or has a different lock';
  END IF;

  IF to_regclass('public.performance_requests') IS NULL
     OR to_regclass('public.facilities') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regclass('public.matches') IS NULL
     OR to_regclass('public.application_attempts') IS NULL
     OR to_regclass('public.application_band_trade_history') IS NULL
     OR to_regclass('public.application_participant_claims') IS NULL
     OR to_regclass('public.coin_transactions') IS NULL
     OR to_regclass('public.match_fee_snapshots') IS NULL THEN
    RAISE EXCEPTION 'Required request deletion or history tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('performance_requests','id'),
      ('performance_requests','facility_id'),
      ('performance_requests','status'),
      ('facilities','id'),
      ('facilities','user_id'),
      ('users','id'),
      ('users','account_status'),
      ('users','line_user_id'),
      ('applications','request_id'),
      ('matches','request_id'),
      ('application_attempts','request_id'),
      ('application_band_trade_history','request_id'),
      ('application_participant_claims','request_id'),
      ('coin_transactions','request_id'),
      ('match_fee_snapshots','request_id')
    ) AS required(table_name,column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema='public'
     AND c.table_name=required.table_name
     AND c.column_name=required.column_name
    WHERE c.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more required request deletion/history columns are missing';
  END IF;

  SELECT count(*) INTO v_fk_count
  FROM pg_constraint
  WHERE contype='f'
    AND confrelid='public.performance_requests'::regclass;

  IF v_fk_count <> 7 OR EXISTS (
    WITH expected(child_table,constraint_name,delete_action) AS (
      VALUES
        ('application_attempts','application_attempts_request_id_fkey','c'::"char"),
        ('application_band_trade_history','application_band_trade_history_request_id_fkey','r'::"char"),
        ('application_participant_claims','application_participant_claims_request_id_fkey','r'::"char"),
        ('applications','applications_request_id_fkey','c'::"char"),
        ('coin_transactions','coin_transactions_request_id_fkey','n'::"char"),
        ('match_fee_snapshots','match_fee_snapshots_request_id_fkey','r'::"char"),
        ('matches','matches_request_id_fkey','c'::"char")
    )
    SELECT 1
    FROM expected e
    LEFT JOIN pg_class child
      ON child.relname=e.child_table
    LEFT JOIN pg_namespace child_ns
      ON child_ns.oid=child.relnamespace
     AND child_ns.nspname='public'
    LEFT JOIN pg_constraint c
      ON c.conrelid=child.oid
     AND c.confrelid='public.performance_requests'::regclass
     AND c.conname=e.constraint_name
     AND c.contype='f'
    WHERE child_ns.oid IS NULL
       OR c.oid IS NULL
       OR c.convalidated IS DISTINCT FROM true
       OR c.confdeltype IS DISTINCT FROM e.delete_action
       OR c.conkey IS DISTINCT FROM ARRAY[(
         SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid=child.oid AND a.attname='request_id' AND NOT a.attisdropped
       )]::smallint[]
       OR c.confkey IS DISTINCT FROM ARRAY[(
         SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid='public.performance_requests'::regclass
           AND a.attname='id' AND NOT a.attisdropped
       )]::smallint[]
  ) THEN
    RAISE EXCEPTION 'The performance_requests FK graph differs from the reviewed seven-table dependency set';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.performance_requests'::regclass
      AND tgname='trg_global_mutation_gate'
      AND NOT tgisinternal AND tgenabled IN ('O', 'A')
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
  ) THEN
    RAISE EXCEPTION 'Global mutation gate is missing from performance_requests';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid='public.performance_requests'::regclass
      AND NOT tgisinternal
      AND (tgtype & 8) = 8
      AND NOT (
        tgname='trg_global_mutation_gate'
        AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
      )
  ) THEN
    RAISE EXCEPTION 'Unreviewed DELETE trigger exists on performance_requests';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.match_fee_snapshots'::regclass
      AND tgname='trg_global_mutation_gate'
      AND NOT tgisinternal
      AND (
        tgfoid <> to_regprocedure('public.acquire_global_mutation_gate_trigger()')
        OR tgenabled NOT IN ('O', 'A')
      )
  ) THEN
    RAISE EXCEPTION 'match_fee_snapshots has a conflicting or disabled global mutation gate trigger';
  END IF;
END;
$preflight$;

-- match_fee_snapshots was introduced after the original global-gate migration.
-- Install the same statement-level gate if it is not already present.
DO $install_snapshot_gate$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.match_fee_snapshots'::regclass
      AND tgname='trg_global_mutation_gate'
      AND NOT tgisinternal
  ) THEN
    EXECUTE
      'CREATE TRIGGER trg_global_mutation_gate ' ||
      'BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ' ||
      'ON public.match_fee_snapshots ' ||
      'FOR EACH STATEMENT ' ||
      'EXECUTE FUNCTION public.acquire_global_mutation_gate_trigger()';
  END IF;
END;
$install_snapshot_gate$;

DO $gate_postflight$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'performance_requests',
    'applications',
    'matches',
    'application_attempts',
    'application_band_trade_history',
    'application_participant_claims',
    'coin_transactions',
    'match_fee_snapshots',
    'facilities',
    'users'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('public.' || v_table)
        AND t.tgname='trg_global_mutation_gate'
        AND NOT t.tgisinternal
        AND t.tgenabled IN ('O', 'A')
        AND t.tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
    ) THEN
      RAISE EXCEPTION 'Enabled global mutation gate is missing on public.%', v_table;
    END IF;
  END LOOP;
END;
$gate_postflight$;

CREATE OR REPLACE FUNCTION public.delete_open_performance_request_atomic(
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
  v_count bigint;
  v_deleted_id uuid;
  v_table text;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_request_id IS NULL OR p_facility_id IS NULL
     OR NULLIF(btrim(COALESCE(p_line_user_id, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'invalid_input');
  END IF;

  -- Fail closed if any reviewed dependency, FK, or gate changed after migration.
  IF (
    SELECT count(*) FROM pg_constraint
    WHERE contype='f'
      AND confrelid='public.performance_requests'::regclass
  ) <> 7 OR EXISTS (
    WITH expected(child_table,constraint_name,delete_action) AS (
      VALUES
        ('application_attempts','application_attempts_request_id_fkey','c'::"char"),
        ('application_band_trade_history','application_band_trade_history_request_id_fkey','r'::"char"),
        ('application_participant_claims','application_participant_claims_request_id_fkey','r'::"char"),
        ('applications','applications_request_id_fkey','c'::"char"),
        ('coin_transactions','coin_transactions_request_id_fkey','n'::"char"),
        ('match_fee_snapshots','match_fee_snapshots_request_id_fkey','r'::"char"),
        ('matches','matches_request_id_fkey','c'::"char")
    )
    SELECT 1
    FROM expected e
    LEFT JOIN pg_class child ON child.relname=e.child_table
    LEFT JOIN pg_namespace child_ns
      ON child_ns.oid=child.relnamespace AND child_ns.nspname='public'
    LEFT JOIN pg_constraint c
      ON c.conrelid=child.oid
     AND c.confrelid='public.performance_requests'::regclass
     AND c.conname=e.constraint_name
     AND c.contype='f'
    WHERE child_ns.oid IS NULL
       OR c.oid IS NULL
       OR c.convalidated IS DISTINCT FROM true
       OR c.confdeltype IS DISTINCT FROM e.delete_action
       OR c.conkey IS DISTINCT FROM ARRAY[(
         SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid=child.oid AND a.attname='request_id' AND NOT a.attisdropped
       )]::smallint[]
       OR c.confkey IS DISTINCT FROM ARRAY[(
         SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid='public.performance_requests'::regclass
           AND a.attname='id' AND NOT a.attisdropped
       )]::smallint[]
  ) OR EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid='public.performance_requests'::regclass
      AND NOT tgisinternal
      AND (tgtype & 8) = 8
      AND NOT (
        tgname='trg_global_mutation_gate'
        AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
      )
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'unreviewed_dependency');
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'performance_requests',
    'applications',
    'matches',
    'application_attempts',
    'application_band_trade_history',
    'application_participant_claims',
    'coin_transactions',
    'match_fee_snapshots',
    'facilities',
    'users'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('public.' || v_table)
        AND t.tgname='trg_global_mutation_gate'
        AND NOT t.tgisinternal
        AND t.tgenabled IN ('O', 'A')
        AND t.tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
    ) THEN
      RETURN jsonb_build_object('success', false, 'errorCode', 'unreviewed_dependency');
    END IF;
  END LOOP;

  SELECT *
  INTO v_request
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
    SELECT 1
    FROM public.facilities f
    JOIN public.users u ON u.id=f.user_id
    WHERE f.id=p_facility_id
      AND u.account_status='active'
      AND u.line_user_id=p_line_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'facility_inactive');
  END IF;

  IF v_request.status IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_open');
  END IF;

  SELECT count(*) INTO v_count
  FROM public.applications WHERE request_id=p_request_id;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_applications', 'count', v_count);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.matches WHERE request_id=p_request_id;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_matches', 'count', v_count);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.application_attempts WHERE request_id=p_request_id;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_application_attempts', 'count', v_count);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.application_band_trade_history WHERE request_id=p_request_id;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_band_trade_history', 'count', v_count);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.application_participant_claims WHERE request_id=p_request_id;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_participant_claims', 'count', v_count);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.coin_transactions WHERE request_id=p_request_id;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_coin_transactions', 'count', v_count);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.match_fee_snapshots WHERE request_id=p_request_id;
  IF v_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'has_fee_snapshots', 'count', v_count);
  END IF;

  DELETE FROM public.performance_requests
  WHERE id=p_request_id
    AND facility_id=p_facility_id
    AND status='open'
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'delete_compare_and_set_failed');
  END IF;

  RETURN jsonb_build_object('success', true, 'deletedRequestId', v_deleted_id);
END;
$function$;

ALTER FUNCTION public.delete_open_performance_request_atomic(uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_open_performance_request_atomic(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_open_performance_request_atomic(uuid, uuid, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
