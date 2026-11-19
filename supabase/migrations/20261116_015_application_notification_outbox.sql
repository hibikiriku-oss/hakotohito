-- Enqueue application and direct-invitation notifications in the same transaction
-- that creates application_attempts. Candidate only; do not apply yet.
BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.application_attempts') IS NULL
     OR to_regclass('public.applications') IS NULL THEN
    RAISE EXCEPTION 'Required outbox/application tables are missing';
  END IF;
  IF to_regprocedure('public.enqueue_application_attempt_line_notifications()') IS NOT NULL THEN
    RAISE EXCEPTION 'Application notification trigger function already exists';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enqueue_application_attempt_line_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_application public.applications%ROWTYPE;
  v_request public.performance_requests%ROWTYPE;
  v_facility_name text;
  v_performer_name text;
  v_recipient_line_user_id text;
  v_text text;
  v_event_key text;
BEGIN
  IF NEW.status <> 'pending'
     OR NEW.source NOT IN ('performer_apply', 'band_apply', 'facility_invite') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_application
  FROM public.applications
  WHERE id = NEW.application_id;
  IF NOT FOUND OR v_application.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_request
  FROM public.performance_requests
  WHERE id = NEW.request_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(f.name, ''), NULLIF(fu.display_name, ''), '施設')
  INTO v_facility_name
  FROM public.facilities f
  JOIN public.users fu ON fu.id = f.user_id
  WHERE f.id = v_request.facility_id;

  IF NEW.source = 'band_apply' THEN
    SELECT COALESCE(NULLIF(b.name, ''), 'バンド') INTO v_performer_name
    FROM public.bands b WHERE b.id = NEW.band_id;
  ELSE
    SELECT COALESCE(NULLIF(p.name, ''), NULLIF(pu.display_name, ''), '演奏者')
    INTO v_performer_name
    FROM public.performers p
    JOIN public.users pu ON pu.id = p.user_id
    WHERE p.id = NEW.performer_id;
  END IF;

  IF NEW.source = 'facility_invite' THEN
    SELECT u.line_user_id INTO v_recipient_line_user_id
    FROM public.performers p
    JOIN public.users u ON u.id = p.user_id
    WHERE p.id = NEW.performer_id AND u.account_status = 'active';
    v_event_key := 'application_attempt:' || NEW.id::text || ':performer';
    v_text := '施設からオファーが届きました。施設：' || COALESCE(v_facility_name, '施設') ||
      '／案件：' || COALESCE(v_request.title, '案件') ||
      E'\nLINEミニアプリの「受信したオファー」からご確認ください。';
  ELSE
    SELECT u.line_user_id INTO v_recipient_line_user_id
    FROM public.facilities f
    JOIN public.users u ON u.id = f.user_id
    WHERE f.id = v_request.facility_id AND u.account_status = 'active';
    v_event_key := 'application_attempt:' || NEW.id::text || ':facility';
    v_text := '新しい応募があります。演奏者：' || COALESCE(v_performer_name, '演奏者') ||
      '／案件：' || COALESCE(v_request.title, '案件') ||
      E'\nLINEミニアプリの応募一覧からご確認ください。';
  END IF;

  IF NULLIF(v_recipient_line_user_id, '') IS NOT NULL THEN
    INSERT INTO public.line_notification_outbox (
      event_key, recipient_line_user_id, messages
    ) VALUES (
      v_event_key,
      v_recipient_line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    )
    ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enqueue_application_attempt_line_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_application_attempt_line_notifications() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enqueue_application_attempt_line_notifications
AFTER INSERT ON public.application_attempts
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_application_attempt_line_notifications();

COMMIT;
