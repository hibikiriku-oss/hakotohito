-- Notify applicants when the latest ordinary/direct-invitation attempt expires.
-- Candidate only. Requires migrations 009, 010, 014, 015 and 004 (Outbox hardening).
BEGIN;

-- Acquire the shared write gate before taking application table DDL locks.
SELECT pg_advisory_xact_lock(2147483000, 20261118);
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL
     OR to_regclass('public.application_attempts') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.band_members') IS NULL
     OR to_regclass('public.performers') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Required application, band, user, or Outbox objects are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.line_notification_outbox'::regclass
      AND tgname = 'trg_bind_line_notification_outbox_recipient'
      AND NOT tgisinternal
  ) OR (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='line_notification_outbox'
        AND column_name IN ('event_key','recipient_line_user_id','recipient_user_id','messages')) <> 4 THEN
    RAISE EXCEPTION 'Hardened Outbox recipient binding from migration 004 is required';
  END IF;

  IF to_regprocedure('public.enqueue_expired_application_line_notifications()') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.applications'::regclass
         AND tgname = 'trg_enqueue_expired_application_line_notifications'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'Expired-application notification trigger already exists; inspect before retrying';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='application_attempts'
        AND column_name IN ('id','application_id','performer_id','band_id','source','status','started_at','expires_at')) <> 8
     OR (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='applications'
        AND column_name IN ('id','status')) <> 2
     OR (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='band_members'
        AND column_name IN ('band_id','performer_id','status')) <> 3
     OR (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users'
        AND column_name IN ('id','line_user_id','account_status')) <> 3
     OR (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='performers'
        AND column_name IN ('id','user_id')) <> 2 THEN
    RAISE EXCEPTION 'Required expiry notification columns do not match the expected schema';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.enqueue_expired_application_line_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.application_attempts%ROWTYPE;
  v_text text;
BEGIN
  -- Only handle the pending -> rejected transition made by the expiry worker.
  IF OLD.status IS DISTINCT FROM 'pending'
     OR NEW.status IS DISTINCT FROM 'rejected' THEN
    RETURN NEW;
  END IF;

  -- Do not mistake a manual rejection for expiry when an older expired attempt
  -- exists. The newest attempt for this application must itself be expired.
  SELECT aa.* INTO v_attempt
  FROM public.application_attempts aa
  WHERE aa.application_id = NEW.id
  ORDER BY aa.started_at DESC, aa.id DESC
  LIMIT 1;

  IF NOT FOUND
     OR v_attempt.status IS DISTINCT FROM 'expired'
     OR v_attempt.expires_at > now() THEN
    RETURN NEW;
  END IF;

  IF v_attempt.source = 'band_apply' THEN
    v_text := 'バンド応募の有効期限が切れました。案件の状況をLINEミニアプリでご確認ください。';

    INSERT INTO public.line_notification_outbox (
      event_key, recipient_line_user_id, messages
    )
    SELECT
      'application_expired:' || v_attempt.id::text || ':band_member:' || u.id::text,
      u.line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    FROM public.band_members bm
    JOIN public.performers p ON p.id = bm.performer_id
    JOIN public.users u ON u.id = p.user_id
    WHERE bm.band_id = v_attempt.band_id
      AND bm.status = 'active'
      AND u.account_status = 'active'
      AND NULLIF(u.line_user_id, '') IS NOT NULL
      AND u.line_user_id NOT LIKE 'withdrawn:%'
    ON CONFLICT (event_key) DO NOTHING;
  ELSE
    IF v_attempt.source = 'facility_invite' THEN
      v_text := '施設からの直接オファーの有効期限が切れました。LINEミニアプリで最新状況をご確認ください。';
    ELSE
      v_text := '演奏案件への応募の有効期限が切れました。LINEミニアプリで最新状況をご確認ください。';
    END IF;

    INSERT INTO public.line_notification_outbox (
      event_key, recipient_line_user_id, messages
    )
    SELECT
      'application_expired:' || v_attempt.id::text || ':performer:' || u.id::text,
      u.line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    FROM public.performers p
    JOIN public.users u ON u.id = p.user_id
    WHERE p.id = v_attempt.performer_id
      AND u.account_status = 'active'
      AND NULLIF(u.line_user_id, '') IS NOT NULL
      AND u.line_user_id NOT LIKE 'withdrawn:%'
    ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enqueue_expired_application_line_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_expired_application_line_notifications()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_enqueue_expired_application_line_notifications
AFTER UPDATE OF status ON public.applications
FOR EACH ROW
WHEN (OLD.status = 'pending' AND NEW.status = 'rejected')
EXECUTE FUNCTION public.enqueue_expired_application_line_notifications();

COMMIT;
