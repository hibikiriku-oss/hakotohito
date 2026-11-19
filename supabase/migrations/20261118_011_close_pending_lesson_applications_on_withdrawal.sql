-- Hakotohito: close pending lesson applications before performer withdrawal.
-- Candidate only. Requires 20261118_010_active_account_mutation_guards.sql
-- and the 20261116_009 global mutation gate.
-- The BEFORE trigger runs while the users row still reads as active, so the
-- existing lesson_applications account guard permits this controlled cleanup.

BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
DECLARE
  v_status_type oid;
  v_status_kind "char";
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'Global mutation gate helper is missing';
  END IF;
  IF to_regprocedure('public.guard_active_account_mutation()') IS NULL THEN
    RAISE EXCEPTION 'Active-account mutation guard from migration 010 is missing';
  END IF;
  IF to_regclass('public.users') IS NULL
     OR to_regclass('public.performers') IS NULL
     OR to_regclass('public.lesson_offers') IS NULL
     OR to_regclass('public.lesson_applications') IS NULL THEN
    RAISE EXCEPTION 'Required account/lesson tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('users','id'),('users','user_type'),('users','account_status'),
      ('performers','id'),('performers','user_id'),
      ('lesson_offers','id'),('lesson_offers','performer_id'),
      ('lesson_applications','lesson_offer_id'),
      ('lesson_applications','applicant_performer_id'),
      ('lesson_applications','status')
    ) AS required(table_name,column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=required.table_name
     AND c.column_name=required.column_name
    WHERE c.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'Required lesson withdrawal cleanup columns are missing';
  END IF;

  SELECT a.atttypid, t.typtype INTO v_status_type, v_status_kind
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_type t ON t.oid=a.atttypid
  WHERE n.nspname='public' AND c.relname='lesson_applications'
    AND a.attname='status' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_status_kind='e' AND NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumtypid=v_status_type AND enumlabel='rejected'
  ) THEN
    RAISE EXCEPTION 'lesson_applications.status enum does not support rejected';
  END IF;

  -- A domain may wrap either text or an enum and carry its own CHECK
  -- constraints. Inspect the complete domain/base-type chain rather than
  -- treating a domain as unconstrained text.
  IF EXISTS (
    WITH RECURSIVE type_chain(type_oid) AS (
      SELECT v_status_type
      UNION ALL
      SELECT t.typbasetype
      FROM pg_type t
      JOIN type_chain chain ON chain.type_oid=t.oid
      WHERE t.typtype='d' AND t.typbasetype <> 0
    )
    SELECT 1
    FROM type_chain chain
    JOIN pg_type t ON t.oid=chain.type_oid
    WHERE t.typtype='e'
      AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        WHERE e.enumtypid=t.oid AND e.enumlabel='rejected'
      )
  ) THEN
    RAISE EXCEPTION 'lesson_applications.status domain base enum does not support rejected';
  END IF;

  IF EXISTS (
    WITH RECURSIVE type_chain(type_oid) AS (
      SELECT v_status_type
      UNION ALL
      SELECT t.typbasetype
      FROM pg_type t
      JOIN type_chain chain ON chain.type_oid=t.oid
      WHERE t.typtype='d' AND t.typbasetype <> 0
    )
    SELECT 1
    FROM type_chain chain
    JOIN pg_constraint con ON con.contypid=chain.type_oid
    WHERE con.contype='c'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%rejected%'
  ) THEN
    RAISE EXCEPTION 'A lesson_applications.status domain CHECK may reject status=rejected; inspect it explicitly before applying';
  END IF;

  -- A text/varchar status column may be constrained by CHECK rather than enum.
  -- Refuse to install the cleanup trigger if any CHECK involving status does
  -- not explicitly permit the rejected terminal state.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid='public.lesson_applications'::regclass
      AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%rejected%'
  ) THEN
    RAISE EXCEPTION 'A lesson_applications CHECK constraint may reject status=rejected; inspect and replace it explicitly before applying';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.users'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal
      AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.lesson_applications'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal
      AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.lesson_applications'::regclass
      AND tgname='trg_guard_active_account_mutation' AND NOT tgisinternal
      AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.guard_active_account_mutation()')
  ) THEN
    RAISE EXCEPTION 'Required global gate or active-account lesson trigger is missing';
  END IF;

  IF to_regprocedure('public.close_pending_lesson_applications_on_withdrawal()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
       AND tgname='trg_close_pending_lesson_applications_on_withdrawal') THEN
    RAISE EXCEPTION 'Withdrawal lesson cleanup already exists; inspect before applying';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.close_pending_lesson_applications_on_withdrawal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_performer_id uuid;
BEGIN
  IF OLD.account_status IS DISTINCT FROM 'active'
     OR NEW.account_status IS DISTINCT FROM 'withdrawn'
     OR NEW.user_type IS DISTINCT FROM 'performer' THEN
    RETURN NEW;
  END IF;

  SELECT p.id INTO v_performer_id
  FROM public.performers p
  WHERE p.user_id=OLD.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Performer profile is missing; cannot safely close pending lesson applications'
      USING ERRCODE='23503';
  END IF;

  -- Close both applications submitted by this performer and applications
  -- received by this performer's own lesson offers. Matched lessons are not
  -- changed; withdraw_user_account already rejects those before this point.
  UPDATE public.lesson_applications la
  SET status='rejected'
  WHERE la.status='pending'
    AND (
      la.applicant_performer_id=v_performer_id
      OR la.lesson_offer_id IN (
        SELECT lo.id FROM public.lesson_offers lo
        WHERE lo.performer_id=v_performer_id
      )
    );

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.close_pending_lesson_applications_on_withdrawal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_pending_lesson_applications_on_withdrawal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_pending_lesson_applications_on_withdrawal() TO service_role;

CREATE TRIGGER trg_close_pending_lesson_applications_on_withdrawal
BEFORE UPDATE OF account_status ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.close_pending_lesson_applications_on_withdrawal();

NOTIFY pgrst, 'reload schema';
COMMIT;
