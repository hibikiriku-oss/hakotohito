-- Hakotohito: prevent service-role/API TOCTOU writes after account withdrawal.
-- Candidate only. Requires migration 009 global mutation gate.
-- The gate linearizes each write transaction; these row guards re-check the
-- owner/participants after that gate is acquired, closing stale-auth windows.

BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'Global mutation gate helper is missing';
  END IF;
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN
       pg_get_functiondef(to_regprocedure('public.acquire_global_mutation_gate_trigger()'))) = 0 THEN
    RAISE EXCEPTION 'Global mutation gate helper uses an unexpected lock';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('users','id'),('users','account_status'),('users','avatar_type'),('users','avatar_emoji'),
      ('performers','user_id'),
      ('facilities','user_id'),
      ('performance_requests','facility_id'),
      ('lesson_offers','performer_id'),
      ('lesson_applications','lesson_offer_id'),('lesson_applications','applicant_performer_id'),
      ('inquiries','user_id'),
      ('favorites','user_id'),('favorites','target_user_id')
    ) AS required(table_name,column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=required.table_name
     AND c.column_name=required.column_name
    WHERE c.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'Required account-guard table columns are missing';
  END IF;

  IF to_regprocedure('public.guard_active_account_mutation()') IS NOT NULL
     OR to_regprocedure('public.guard_active_user_avatar_update()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE NOT tgisinternal AND tgname IN (
         'trg_guard_active_account_mutation',
         'trg_guard_active_user_avatar_update'
       )
     ) THEN
    RAISE EXCEPTION 'Account mutation guard already exists; inspect before applying';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('users'),('performers'),('facilities'),('performance_requests'),
      ('lesson_offers'),('lesson_applications'),('inquiries'),('favorites')
    ) AS target(table_name)
    JOIN pg_class c ON c.relname=target.table_name
    JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=c.oid AND t.tgname='trg_global_mutation_gate'
        AND NOT t.tgisinternal AND t.tgenabled <> 'D'
        AND t.tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
    )
  ) THEN
    RAISE EXCEPTION 'Global mutation gate trigger missing on an account-guard target table';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.guard_active_account_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_account_status text;
  v_teacher_status text;
  v_applicant_status text;
BEGIN
  IF TG_TABLE_NAME IN ('performers','facilities') THEN
    IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Profile ownership cannot be changed' USING ERRCODE='42501';
    END IF;
    v_user_id := NEW.user_id;
    SELECT u.account_status INTO v_account_status
    FROM public.users u WHERE u.id=v_user_id;
    IF NOT FOUND OR v_account_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Active account required for this operation'
        USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'inquiries' THEN
    v_user_id := NEW.user_id;
    SELECT u.account_status INTO v_account_status
    FROM public.users u WHERE u.id=v_user_id;
    IF NOT FOUND OR v_account_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Active account required for this operation'
        USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'performance_requests' THEN
    IF TG_OP = 'UPDATE' AND OLD.facility_id IS DISTINCT FROM NEW.facility_id THEN
      RAISE EXCEPTION 'Request facility ownership cannot be changed' USING ERRCODE='42501';
    END IF;
    SELECT u.account_status INTO v_account_status
    FROM public.facilities f
    JOIN public.users u ON u.id=f.user_id
    WHERE f.id=NEW.facility_id;
    IF NOT FOUND OR v_account_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Active facility account required for request mutation'
        USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'lesson_offers' THEN
    IF TG_OP = 'UPDATE' AND OLD.performer_id IS DISTINCT FROM NEW.performer_id THEN
      RAISE EXCEPTION 'Lesson offer ownership cannot be changed' USING ERRCODE='42501';
    END IF;
    SELECT u.account_status INTO v_account_status
    FROM public.performers p
    JOIN public.users u ON u.id=p.user_id
    WHERE p.id=NEW.performer_id;
    IF NOT FOUND OR v_account_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Active performer account required for lesson offer mutation'
        USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'lesson_applications' THEN
    IF TG_OP = 'UPDATE' AND (OLD.lesson_offer_id IS DISTINCT FROM NEW.lesson_offer_id
       OR OLD.applicant_performer_id IS DISTINCT FROM NEW.applicant_performer_id) THEN
      RAISE EXCEPTION 'Lesson application participants cannot be changed' USING ERRCODE='42501';
    END IF;
    SELECT teacher_user.account_status, applicant_user.account_status
    INTO v_teacher_status, v_applicant_status
    FROM public.lesson_offers lo
    JOIN public.performers teacher ON teacher.id=lo.performer_id
    JOIN public.users teacher_user ON teacher_user.id=teacher.user_id
    JOIN public.performers applicant ON applicant.id=NEW.applicant_performer_id
    JOIN public.users applicant_user ON applicant_user.id=applicant.user_id
    WHERE lo.id=NEW.lesson_offer_id;
    IF NOT FOUND OR v_teacher_status IS DISTINCT FROM 'active'
       OR v_applicant_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Both lesson participants must have active accounts'
        USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'favorites' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id=NEW.user_id AND u.account_status='active'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id=NEW.target_user_id AND u.account_status='active'
    ) THEN
      RAISE EXCEPTION 'Both favorite participants must have active accounts'
        USING ERRCODE='42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.guard_active_user_avatar_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  -- Withdrawal itself may clear avatar fields while OLD is still active.
  -- A later stale API request cannot change an already-withdrawn user's avatar.
  IF OLD.account_status IS DISTINCT FROM 'active'
     AND (NEW.avatar_type IS DISTINCT FROM OLD.avatar_type
       OR NEW.avatar_emoji IS DISTINCT FROM OLD.avatar_emoji) THEN
    RAISE EXCEPTION 'Withdrawn account profile is immutable'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_active_account_mutation() OWNER TO postgres;
ALTER FUNCTION public.guard_active_user_avatar_update() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_active_account_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_active_user_avatar_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_active_account_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_active_user_avatar_update() TO service_role;

CREATE TRIGGER trg_guard_active_account_mutation
BEFORE INSERT OR UPDATE ON public.performers
FOR EACH ROW EXECUTE FUNCTION public.guard_active_account_mutation();
CREATE TRIGGER trg_guard_active_account_mutation
BEFORE INSERT OR UPDATE ON public.facilities
FOR EACH ROW EXECUTE FUNCTION public.guard_active_account_mutation();
CREATE TRIGGER trg_guard_active_account_mutation
BEFORE INSERT OR UPDATE ON public.performance_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_active_account_mutation();
CREATE TRIGGER trg_guard_active_account_mutation
BEFORE INSERT OR UPDATE ON public.lesson_offers
FOR EACH ROW EXECUTE FUNCTION public.guard_active_account_mutation();
CREATE TRIGGER trg_guard_active_account_mutation
BEFORE INSERT OR UPDATE ON public.lesson_applications
FOR EACH ROW EXECUTE FUNCTION public.guard_active_account_mutation();
CREATE TRIGGER trg_guard_active_account_mutation
BEFORE INSERT ON public.inquiries
FOR EACH ROW EXECUTE FUNCTION public.guard_active_account_mutation();
CREATE TRIGGER trg_guard_active_account_mutation
BEFORE INSERT ON public.favorites
FOR EACH ROW EXECUTE FUNCTION public.guard_active_account_mutation();
CREATE TRIGGER trg_guard_active_user_avatar_update
BEFORE UPDATE OF avatar_type, avatar_emoji ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_active_user_avatar_update();

NOTIFY pgrst, 'reload schema';
COMMIT;
