-- Forward-safe LINE Outbox hardening: bind recipients to account UUIDs,
-- fence worker leases, and reject event-key payload mismatches.
-- Fail closed if any notification is pending/processing; never discard the queue.
-- Candidate only. Review live schema/data before applying.
BEGIN;
-- Match the application-wide mutation gate BEFORE taking DDL/table locks.
-- Otherwise a live writer can hold the global gate while waiting on this
-- migration's table locks, creating a lock-order inversion.
SELECT pg_advisory_xact_lock(2147483000, 20261118);
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Outbox/users tables are required';
  END IF;
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'public.line_notification_outbox'::regclass
         AND t.tgname = 'trg_global_mutation_gate'
         AND NOT t.tgisinternal
         AND t.tgenabled IN ('O', 'A')
         AND t.tgfoid = to_regprocedure('public.acquire_global_mutation_gate_trigger()')
     ) THEN
    RAISE EXCEPTION 'Enabled Outbox global mutation gate trigger is required before hardening';
  END IF;
  IF to_regprocedure('public.claim_line_notification_outbox(integer)') IS NULL
     OR to_regprocedure('public.complete_line_notification_outbox(uuid)') IS NULL
     OR to_regprocedure('public.retry_line_notification_outbox(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Expected v1 Outbox worker RPC signatures are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='line_notification_outbox'
      AND column_name IN ('recipient_user_id','lease_token')
  ) THEN
    RAISE EXCEPTION 'Outbox hardening columns already exist; inspect before retrying';
  END IF;
  -- Do not silently discard notifications that are still waiting or being sent.
  -- Drain/review the legacy queue first, then rerun this migration with zero rows.
  IF EXISTS (
    SELECT 1 FROM public.line_notification_outbox
    WHERE status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'Outbox has pending/processing rows; drain or explicitly reconcile them before migration 004';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE account_status = 'active'
      AND NULLIF(line_user_id, '') IS NOT NULL
      AND line_user_id NOT LIKE 'withdrawn:%'
    GROUP BY line_user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active LINE user IDs exist; reconcile them before migration 004';
  END IF;
END;
$preflight$;

ALTER TABLE public.line_notification_outbox
  ADD COLUMN recipient_user_id uuid,
  ADD COLUMN lease_token uuid;

CREATE INDEX line_notification_outbox_recipient_ready_idx
  ON public.line_notification_outbox (recipient_user_id, available_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION public.bind_line_notification_outbox_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_ids uuid[];
  v_existing public.line_notification_outbox%ROWTYPE;
BEGIN
  IF NEW.event_key IS NULL OR btrim(NEW.event_key) = ''
     OR NEW.recipient_line_user_id IS NULL OR btrim(NEW.recipient_line_user_id) = ''
     OR jsonb_typeof(NEW.messages) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.messages) = 0 THEN
    RAISE EXCEPTION 'Invalid LINE notification Outbox payload';
  END IF;

  SELECT array_agg(u.id ORDER BY u.id)
  INTO v_user_ids
  FROM public.users u
  WHERE u.line_user_id = NEW.recipient_line_user_id
    AND u.account_status = 'active'
    AND NULLIF(u.line_user_id, '') IS NOT NULL
    AND u.line_user_id NOT LIKE 'withdrawn:%';

  IF COALESCE(cardinality(v_user_ids), 0) <> 1 THEN
    RAISE EXCEPTION 'LINE notification recipient does not resolve to exactly one active account';
  END IF;

  NEW.recipient_user_id := v_user_ids[1];
  -- Namespace every event by stable account identity. Re-registration with the
  -- same LINE ID cannot collide with the former account's event key.
  NEW.event_key := NEW.event_key || ':recipient:' || NEW.recipient_user_id::text;

  SELECT * INTO v_existing
  FROM public.line_notification_outbox o
  WHERE o.event_key = NEW.event_key;

  IF FOUND AND (
    v_existing.recipient_user_id IS DISTINCT FROM NEW.recipient_user_id
    OR v_existing.messages IS DISTINCT FROM NEW.messages
  ) THEN
    RAISE EXCEPTION 'LINE notification event key reused with a different recipient or payload';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.bind_line_notification_outbox_recipient() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bind_line_notification_outbox_recipient() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_bind_line_notification_outbox_recipient
  ON public.line_notification_outbox;
CREATE TRIGGER trg_bind_line_notification_outbox_recipient
BEFORE INSERT ON public.line_notification_outbox
FOR EACH ROW
EXECUTE FUNCTION public.bind_line_notification_outbox_recipient();

-- The account-bound recipient and payload form the immutable identity of an
-- Outbox event. Worker RPCs may only mutate delivery/lease metadata.
CREATE FUNCTION public.guard_line_notification_outbox_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.event_key IS DISTINCT FROM OLD.event_key
     OR NEW.recipient_line_user_id IS DISTINCT FROM OLD.recipient_line_user_id
     OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
     OR NEW.messages IS DISTINCT FROM OLD.messages
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'LINE notification Outbox event identity is immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_line_notification_outbox_identity_immutable() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_line_notification_outbox_identity_immutable() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_guard_line_notification_outbox_identity_immutable
BEFORE UPDATE ON public.line_notification_outbox
FOR EACH ROW
EXECUTE FUNCTION public.guard_line_notification_outbox_identity_immutable();

-- All application access is through SECURITY DEFINER RPCs and triggers.
-- The service role does not need direct table access to this queue.
REVOKE ALL PRIVILEGES ON TABLE public.line_notification_outbox FROM service_role;

-- Replace the claim result shape and add fenced acknowledgement overloads.
-- Keep the legacy complete/retry signatures temporarily so the currently
-- deployed worker remains functional during the application rollout. They are
-- retired by migration 017 only after the new application is Ready and drained.
DROP FUNCTION public.claim_line_notification_outbox(integer);

CREATE FUNCTION public.claim_line_notification_outbox(p_limit integer DEFAULT 5)
RETURNS TABLE (
  id uuid,
  recipient_line_user_id text,
  messages jsonb,
  attempt_count integer,
  lease_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 5';
  END IF;

  -- Do not deliver to withdrawn, deleted, or LINE-unlinked accounts.
  UPDATE public.line_notification_outbox o
  SET status = 'failed', locked_at = NULL, lease_token = NULL,
      last_error = CASE WHEN o.attempt_count >= 8
        THEN 'MAX_ATTEMPTS_EXHAUSTED'
        ELSE 'RECIPIENT_INACTIVE_OR_UNLINKED' END
  WHERE o.status IN ('pending', 'processing')
    AND (
      (o.attempt_count >= 8 AND (o.status = 'pending' OR o.locked_at < now() - interval '2 minutes'))
      OR o.recipient_user_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = o.recipient_user_id
          AND u.account_status = 'active'
          AND NULLIF(u.line_user_id, '') IS NOT NULL
          AND u.line_user_id NOT LIKE 'withdrawn:%'
      )
    );

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.line_notification_outbox o
    JOIN public.users u ON u.id = o.recipient_user_id
    WHERE u.account_status = 'active'
      AND NULLIF(u.line_user_id, '') IS NOT NULL
      AND u.line_user_id NOT LIKE 'withdrawn:%'
      AND o.attempt_count < 8
      AND (
        (o.status = 'pending' AND o.available_at <= now())
        OR (o.status = 'processing' AND o.locked_at < now() - interval '2 minutes')
      )
    ORDER BY o.available_at, o.created_at
    FOR UPDATE OF o SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.line_notification_outbox o
    SET status = 'processing',
        locked_at = now(),
        lease_token = gen_random_uuid(),
        attempt_count = o.attempt_count + 1
    FROM picked
    WHERE o.id = picked.id
    RETURNING o.id, o.recipient_user_id, o.messages, o.attempt_count, o.lease_token
  )
  SELECT c.id, u.line_user_id, c.messages, c.attempt_count, c.lease_token
  FROM claimed c
  JOIN public.users u ON u.id = c.recipient_user_id
  WHERE u.account_status = 'active'
    AND NULLIF(u.line_user_id, '') IS NOT NULL
    AND u.line_user_id NOT LIKE 'withdrawn:%';
END;
$function$;

CREATE FUNCTION public.complete_line_notification_outbox(p_id uuid, p_lease_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE v_count integer;
BEGIN
  UPDATE public.line_notification_outbox
  SET status = 'sent', sent_at = now(), locked_at = NULL,
      lease_token = NULL, last_error = NULL
  WHERE id = p_id AND status = 'processing' AND lease_token = p_lease_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$function$;

CREATE FUNCTION public.retry_line_notification_outbox(
  p_id uuid,
  p_lease_token uuid,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE v_count integer;
BEGIN
  UPDATE public.line_notification_outbox
  SET status = CASE WHEN attempt_count >= 8 THEN 'failed' ELSE 'pending' END,
      available_at = now() + make_interval(secs => LEAST(3600, (30 * power(2, LEAST(attempt_count, 7)))::integer)),
      locked_at = NULL,
      lease_token = NULL,
      last_error = left(COALESCE(p_error, 'LINE push failed'), 500)
  WHERE id = p_id AND status = 'processing' AND lease_token = p_lease_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$function$;

-- Temporary compatibility overloads for old Vercel instances. They preserve
-- the old unfenced behavior only during rollout, but now clear the new lease
-- column so rows remain internally consistent. Migration 017 drops these after
-- the new application is Ready and old instances have drained.
CREATE OR REPLACE FUNCTION public.complete_line_notification_outbox(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE v_count integer;
BEGIN
  UPDATE public.line_notification_outbox
  SET status = 'sent', sent_at = now(), locked_at = NULL,
      lease_token = NULL, last_error = NULL
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
DECLARE v_count integer;
BEGIN
  UPDATE public.line_notification_outbox
  SET status = CASE WHEN attempt_count >= 8 THEN 'failed' ELSE 'pending' END,
      available_at = now() + make_interval(secs => LEAST(3600, (30 * power(2, LEAST(attempt_count, 7)))::integer)),
      locked_at = NULL, lease_token = NULL,
      last_error = left(COALESCE(p_error, 'LINE push failed'), 500)
  WHERE id = p_id AND status = 'processing';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$function$;

ALTER FUNCTION public.claim_line_notification_outbox(integer) OWNER TO postgres;
ALTER FUNCTION public.complete_line_notification_outbox(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.retry_line_notification_outbox(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.complete_line_notification_outbox(uuid) OWNER TO postgres;
ALTER FUNCTION public.retry_line_notification_outbox(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_line_notification_outbox(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_line_notification_outbox(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_line_notification_outbox(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_line_notification_outbox(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_line_notification_outbox(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_line_notification_outbox(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_line_notification_outbox(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_line_notification_outbox(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_line_notification_outbox(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_line_notification_outbox(uuid, text) TO service_role;

DO $postflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.line_notification_outbox
    WHERE (status IN ('pending', 'processing') AND recipient_user_id IS NULL)
       OR (status = 'processing' AND (lease_token IS NULL OR locked_at IS NULL))
       OR (status <> 'processing' AND (lease_token IS NOT NULL OR locked_at IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Outbox postflight failed: recipient binding or worker lease state is inconsistent';
  END IF;
  IF has_table_privilege('service_role', 'public.line_notification_outbox', 'SELECT')
     OR has_table_privilege('service_role', 'public.line_notification_outbox', 'INSERT')
     OR has_table_privilege('service_role', 'public.line_notification_outbox', 'UPDATE')
     OR has_table_privilege('service_role', 'public.line_notification_outbox', 'DELETE')
     OR has_table_privilege('service_role', 'public.line_notification_outbox', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Outbox postflight failed: service_role retains direct table privileges';
  END IF;
  IF to_regprocedure('public.complete_line_notification_outbox(uuid,uuid)') IS NULL
     OR to_regprocedure('public.retry_line_notification_outbox(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Outbox postflight failed: fenced worker RPCs are missing';
  END IF;
END;
$postflight$;

-- The claim RPC keeps the same argument signature but changes its returned
-- columns; explicitly refresh PostgREST's schema cache after commit.
NOTIFY pgrst, 'reload schema';

COMMIT;
