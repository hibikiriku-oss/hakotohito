-- Transactional Outbox for lesson application and lesson-offer update notifications.
-- Candidate only; do not apply until the matching-core package is approved.
BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.lesson_applications') IS NULL
     OR to_regclass('public.lesson_offers') IS NULL THEN
    RAISE EXCEPTION 'Required outbox/lesson tables are missing';
  END IF;
  IF to_regprocedure('public.enqueue_lesson_application_line_notification()') IS NOT NULL
     OR to_regprocedure('public.enqueue_lesson_offer_update_line_notifications()') IS NOT NULL THEN
    RAISE EXCEPTION 'Lesson notification trigger function already exists';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enqueue_lesson_application_line_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_offer public.lesson_offers%ROWTYPE;
  v_owner_line_user_id text;
  v_applicant_name text;
  v_text text;
BEGIN
  SELECT * INTO v_offer
  FROM public.lesson_offers
  WHERE id = NEW.lesson_offer_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT u.line_user_id INTO v_owner_line_user_id
  FROM public.performers p
  JOIN public.users u ON u.id = p.user_id
  WHERE p.id = v_offer.performer_id AND u.account_status = 'active';

  SELECT COALESCE(NULLIF(p.name, ''), NULLIF(u.display_name, ''), '演奏者')
  INTO v_applicant_name
  FROM public.performers p
  JOIN public.users u ON u.id = p.user_id
  WHERE p.id = NEW.applicant_performer_id;

  IF NULLIF(v_owner_line_user_id, '') IS NOT NULL THEN
    v_text := 'レッスンに新しい応募がありました。募集：' || COALESCE(v_offer.title, '未設定') ||
      '／応募者：' || COALESCE(v_applicant_name, '演奏者') ||
      E'\nLINEミニアプリのレッスン募集詳細からご確認ください。';
    INSERT INTO public.line_notification_outbox (
      event_key, recipient_line_user_id, messages
    ) VALUES (
      'lesson_application:' || NEW.id::text || ':owner',
      v_owner_line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_lesson_offer_update_line_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_text text;
  v_event_suffix text;
BEGIN
  IF NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.instruments IS NOT DISTINCT FROM OLD.instruments
     AND NEW.genres IS NOT DISTINCT FROM OLD.genres
     AND NEW.area IS NOT DISTINCT FROM OLD.area
     AND NEW.lesson_date IS NOT DISTINCT FROM OLD.lesson_date
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
     AND NEW.lesson_fee IS NOT DISTINCT FROM OLD.lesson_fee
     AND NEW.capacity IS NOT DISTINCT FROM OLD.capacity
     AND NEW.target_levels IS NOT DISTINCT FROM OLD.target_levels THEN
    RETURN NEW;
  END IF;

  v_text := '参加中のレッスン募集が更新されました。募集：' || COALESCE(NEW.title, '未設定') ||
    E'\n開催日：' || COALESCE(NEW.lesson_date::text, '未設定') ||
    E'\n時間：' || COALESCE(NEW.start_time::text, '未設定') || ' ～ ' || COALESCE(NEW.end_time::text, '未設定') ||
    E'\nLINEミニアプリのレッスン詳細から最新内容をご確認ください。';
  v_event_suffix := txid_current()::text;

  INSERT INTO public.line_notification_outbox (
    event_key, recipient_line_user_id, messages
  )
  SELECT DISTINCT
    'lesson_offer_updated:' || NEW.id::text || ':' || v_event_suffix || ':' || u.line_user_id,
    u.line_user_id,
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
  FROM public.lesson_applications la
  JOIN public.performers p ON p.id = la.applicant_performer_id
  JOIN public.users u ON u.id = p.user_id
  WHERE la.lesson_offer_id = NEW.id
    AND la.status = 'matched'
    AND u.account_status = 'active'
    AND NULLIF(u.line_user_id, '') IS NOT NULL
  ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enqueue_lesson_application_line_notification() OWNER TO postgres;
ALTER FUNCTION public.enqueue_lesson_offer_update_line_notifications() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_lesson_application_line_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_lesson_offer_update_line_notifications() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enqueue_lesson_application_line_notification
AFTER INSERT ON public.lesson_applications
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_lesson_application_line_notification();

CREATE TRIGGER trg_enqueue_lesson_offer_update_line_notifications
AFTER UPDATE ON public.lesson_offers
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_lesson_offer_update_line_notifications();

COMMIT;
