-- Hakotohito V47.002: immutable message snapshot per application attempt.
-- Forward-only. Apply after 20261121_001_application_attempt_match_history.sql.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.application_attempts') IS NULL
     OR to_regclass('public.applications') IS NULL THEN
    RAISE EXCEPTION 'V47.002 stopped: applications/application_attempts table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.application_attempts'::regclass
      AND tgname = 'trg_global_mutation_gate'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'V47.002 stopped: global mutation gate trigger missing on application_attempts';
  END IF;
END;
$preflight$;

ALTER TABLE public.application_attempts
  ADD COLUMN IF NOT EXISTS message_snapshot text,
  ADD COLUMN IF NOT EXISTS message_snapshot_available boolean NOT NULL DEFAULT false;

-- Backfill only applications with exactly one attempt. For reused application
-- rows, older message text has already been overwritten and cannot be inferred.
WITH attempt_counts AS (
  SELECT application_id, count(*) AS attempt_count
  FROM public.application_attempts
  GROUP BY application_id
)
UPDATE public.application_attempts aa
SET message_snapshot = a.message,
    message_snapshot_available = true
FROM public.applications a
JOIN attempt_counts ac ON ac.application_id = a.id AND ac.attempt_count = 1
WHERE aa.application_id = a.id
  AND aa.message_snapshot_available = false;

CREATE OR REPLACE FUNCTION public.capture_application_attempt_message_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  SELECT a.message
  INTO NEW.message_snapshot
  FROM public.applications a
  WHERE a.id = NEW.application_id
    AND a.request_id = NEW.request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot snapshot application message: application/request mismatch';
  END IF;

  NEW.message_snapshot_available := true;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_application_attempts_capture_message_snapshot
  ON public.application_attempts;
CREATE TRIGGER trg_application_attempts_capture_message_snapshot
BEFORE INSERT ON public.application_attempts
FOR EACH ROW
EXECUTE FUNCTION public.capture_application_attempt_message_snapshot();

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='application_attempts'
      AND column_name='message_snapshot'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.application_attempts'::regclass
      AND tgname='trg_application_attempts_capture_message_snapshot'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'V47.002 postflight failed: message snapshot schema/trigger missing';
  END IF;
END;
$postflight$;

COMMIT;
