-- Enqueue one-sided completion report notices in the report-update transaction.
-- Final completion notices are handled by migration 018.
-- Candidate only; requires migration 014 and the matching schema.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.matches') IS NULL THEN
    RAISE EXCEPTION 'Required completion report/outbox objects are missing';
  END IF;
  IF to_regprocedure('public.enqueue_completion_report_line_notifications()') IS NOT NULL THEN
    RAISE EXCEPTION 'Completion report notification function already exists';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enqueue_completion_report_line_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text;
  v_recipient_user_id uuid;
  v_event_key text;
  v_text text;
BEGIN
  SELECT pr.title INTO v_title
  FROM public.performance_requests pr
  WHERE pr.id = NEW.request_id;

  IF OLD.performer_completion_reported_at IS NULL
     AND NEW.performer_completion_reported_at IS NOT NULL
     AND OLD.facility_completion_reported_at IS NULL
     AND NEW.facility_completion_reported_at IS NULL THEN
    SELECT f.user_id INTO v_recipient_user_id
    FROM public.performance_requests pr
    JOIN public.facilities f ON f.id = pr.facility_id
    WHERE pr.id = NEW.request_id;
    v_event_key := 'completion_report:' || NEW.id::text || ':performer_to_facility';
    v_text := '演奏者から演奏完了報告が届きました。案件：' || COALESCE(v_title, '案件') ||
      E'\n内容をご確認のうえ、施設側の完了報告を行ってください。';
  ELSIF OLD.facility_completion_reported_at IS NULL
     AND NEW.facility_completion_reported_at IS NOT NULL
     AND OLD.performer_completion_reported_at IS NULL
     AND NEW.performer_completion_reported_at IS NULL THEN
    SELECT p.user_id INTO v_recipient_user_id
    FROM public.performers p
    WHERE p.id = NEW.performer_id;
    v_event_key := 'completion_report:' || NEW.id::text || ':facility_to_performer';
    v_text := '施設から演奏完了報告が届きました。案件：' || COALESCE(v_title, '案件') ||
      E'\n内容をご確認のうえ、演奏者側の完了報告を行ってください。';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
  SELECT v_event_key || ':' || u.line_user_id,
         u.line_user_id,
         jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
  FROM public.users u
  WHERE u.id = v_recipient_user_id
    AND u.account_status = 'active'
    AND NULLIF(u.line_user_id, '') IS NOT NULL
  ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enqueue_completion_report_line_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_completion_report_line_notifications() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enqueue_completion_report_line_notifications
AFTER UPDATE OF performer_completion_reported_at, facility_completion_reported_at
ON public.matches
FOR EACH ROW
WHEN (
  (OLD.performer_completion_reported_at IS NULL AND NEW.performer_completion_reported_at IS NOT NULL)
  OR
  (OLD.facility_completion_reported_at IS NULL AND NEW.facility_completion_reported_at IS NOT NULL)
)
EXECUTE FUNCTION public.enqueue_completion_report_line_notifications();

COMMIT;
