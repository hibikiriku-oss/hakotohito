-- Enqueue final completion notices in the same transaction as fee settlement.
-- Pending one-sided completion reports remain separate API notifications.
-- Candidate only; requires migration 014 and the existing matching schema.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.matches') IS NULL
     OR to_regclass('public.performance_requests') IS NULL THEN
    RAISE EXCEPTION 'Required completion/outbox objects are missing';
  END IF;
  IF to_regprocedure('public.enqueue_match_completion_line_notifications()') IS NOT NULL THEN
    RAISE EXCEPTION 'Match completion notification function already exists';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enqueue_match_completion_line_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text;
BEGIN
  IF OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pr.title INTO v_title
  FROM public.performance_requests pr
  WHERE pr.id = NEW.request_id;

  -- Both sides receive a durable final-state notice. This avoids relying on
  -- which API request happened to perform the final completion RPC.
  INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
  SELECT DISTINCT
    'match_completed:' || NEW.id::text || ':' || u.line_user_id,
    u.line_user_id,
    jsonb_build_array(jsonb_build_object(
      'type', 'text',
      'text', '演奏完了が確定しました。案件：' || COALESCE(v_title, '案件') ||
        E'\nLINEミニアプリからマッチング詳細をご確認ください。'
    ))
  FROM (
    SELECT f.user_id
    FROM public.performance_requests pr
    JOIN public.facilities f ON f.id = pr.facility_id
    WHERE pr.id = NEW.request_id
    UNION
    SELECT p.user_id
    FROM public.performers p
    WHERE p.id = ANY(
      CASE
        WHEN COALESCE(cardinality(NEW.participant_performer_ids), 0) > 0
          THEN NEW.participant_performer_ids
        ELSE ARRAY[NEW.performer_id]::uuid[]
      END
    )
  ) recipients
  JOIN public.users u ON u.id = recipients.user_id
  WHERE u.account_status = 'active'
    AND NULLIF(u.line_user_id, '') IS NOT NULL
  ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enqueue_match_completion_line_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_match_completion_line_notifications() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enqueue_match_completion_line_notifications
AFTER UPDATE OF completed_at ON public.matches
FOR EACH ROW
WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
EXECUTE FUNCTION public.enqueue_match_completion_line_notifications();

COMMIT;
