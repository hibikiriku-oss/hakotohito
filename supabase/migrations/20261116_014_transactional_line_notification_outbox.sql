-- Transactional LINE notification outbox for successful match establishment.
-- Candidate only: do not apply until the full matching-core migration review is complete.
BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regclass('public.matches') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.performance_requests') IS NULL THEN
    RAISE EXCEPTION 'Required matching tables are missing';
  END IF;
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261116_009_global_mutation_gate.sql before creating the Outbox';
  END IF;
  IF to_regclass('public.line_notification_outbox') IS NOT NULL THEN
    RAISE EXCEPTION 'line_notification_outbox already exists; refusing duplicate migration';
  END IF;
END;
$preflight$;

CREATE TABLE public.line_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  recipient_line_user_id text NOT NULL,
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX line_notification_outbox_ready_idx
  ON public.line_notification_outbox (available_at, created_at)
  WHERE status IN ('pending', 'processing');

-- Migration 009 gates all existing public tables. This table is created later,
-- so install the same statement-level gate explicitly; worker claims/retries
-- and trigger-driven enqueue writes must follow the shared serialization rule.
CREATE TRIGGER trg_global_mutation_gate
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.line_notification_outbox
FOR EACH STATEMENT
EXECUTE FUNCTION public.acquire_global_mutation_gate_trigger();

ALTER TABLE public.line_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.line_notification_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.line_notification_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_match_established_line_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_title text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  SELECT pr.title
  INTO v_title
  FROM public.performance_requests pr
  WHERE pr.id = NEW.request_id;


  -- Notify the facility and every performer captured on the match row.
  -- One event per LINE recipient prevents duplicate rows for dual-role users.
  INSERT INTO public.line_notification_outbox (
    event_key, recipient_line_user_id, messages
  )
  SELECT DISTINCT
    'match_established:' || NEW.id::text || ':' || u.line_user_id,
    u.line_user_id,
    jsonb_build_array(
      jsonb_build_object(
        'type', 'text',
        'text', 'マッチングが成立しました。案件：' || COALESCE(v_title, '案件') || E'\n' ||
          'アプリからマッチング詳細をご確認ください。'
      )
    )
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

DROP TRIGGER IF EXISTS trg_enqueue_match_established_line_notifications
  ON public.matches;
CREATE TRIGGER trg_enqueue_match_established_line_notifications
AFTER INSERT ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_match_established_line_notifications();

CREATE OR REPLACE FUNCTION public.enqueue_line_notification(
  p_event_key text,
  p_recipient_line_user_id text,
  p_text text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_event_key IS NULL OR btrim(p_event_key) = ''
     OR p_recipient_line_user_id IS NULL OR btrim(p_recipient_line_user_id) = ''
     OR p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN false;
  END IF;

  INSERT INTO public.line_notification_outbox (
    event_key, recipient_line_user_id, messages
  )
  VALUES (
    p_event_key,
    p_recipient_line_user_id,
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text))
  )
  ON CONFLICT (event_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_line_notification_outbox(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  recipient_line_user_id text,
  messages jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 200';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.line_notification_outbox o
    WHERE (
      (o.status = 'pending' AND o.available_at <= now())
      OR (o.status = 'processing' AND o.locked_at < now() - interval '5 minutes')
    )
    ORDER BY o.available_at, o.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.line_notification_outbox o
    SET status = 'processing', locked_at = now(), attempt_count = o.attempt_count + 1
    FROM picked
    WHERE o.id = picked.id
    RETURNING o.id, o.recipient_line_user_id, o.messages, o.attempt_count
  )
  SELECT claimed.id, claimed.recipient_line_user_id,
         claimed.messages, claimed.attempt_count
  FROM claimed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_line_notification_outbox(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.line_notification_outbox
  SET status = 'sent', sent_at = now(), locked_at = NULL, last_error = NULL
  WHERE id = p_id AND status = 'processing';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_line_notification_outbox(
  p_id uuid,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.line_notification_outbox
  SET status = CASE WHEN attempt_count >= 8 THEN 'failed' ELSE 'pending' END,
      available_at = now() + make_interval(secs => LEAST(3600, (30 * power(2, LEAST(attempt_count, 7)))::integer)),
      locked_at = NULL,
      last_error = left(COALESCE(p_error, 'LINE push failed'), 500)
  WHERE id = p_id AND status = 'processing';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$function$;

ALTER FUNCTION public.enqueue_match_established_line_notifications() OWNER TO postgres;
ALTER FUNCTION public.enqueue_line_notification(text, text, text) OWNER TO postgres;
ALTER FUNCTION public.claim_line_notification_outbox(integer) OWNER TO postgres;
ALTER FUNCTION public.complete_line_notification_outbox(uuid) OWNER TO postgres;
ALTER FUNCTION public.retry_line_notification_outbox(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_match_established_line_notifications() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_line_notification(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_line_notification_outbox(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_line_notification_outbox(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_line_notification_outbox(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_line_notification(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_line_notification_outbox(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_line_notification_outbox(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_line_notification_outbox(uuid, text) TO service_role;

COMMIT;
