-- Hakotohito: atomic Stripe webhook event claim / lease
-- Differential follow-up to the existing Stripe coin-purchase schema.
-- This is a candidate migration only. Do not apply until the live schema,
-- ownership, grants, and existing webhook rows have been inspected.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.stripe_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'stripe_webhook_events is missing; this is a differential migration and requires the existing Stripe foundation.';
  END IF;

  IF to_regprocedure('public.claim_stripe_webhook_event(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'claim_stripe_webhook_event already exists; inspect the live implementation before proceeding.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_webhook_events'
      AND column_name IN ('processing_token','processing_started_at','attempt_count')
  ) THEN
    RAISE EXCEPTION 'One or more webhook lease columns already exist; inspect the live schema before proceeding.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.stripe_webhook_events'::regclass
      AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 1
      AND pg_get_indexdef(i.indexrelid) ILIKE '%(stripe_event_id)'
  ) THEN
    RAISE EXCEPTION 'A unique index on stripe_event_id is required for atomic event claiming.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_webhook_events'
      AND column_name = 'stripe_event_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_webhook_events'
      AND column_name = 'processing_status'
  ) THEN
    RAISE EXCEPTION 'stripe_webhook_events does not match the expected event-id/status contract.';
  END IF;

  -- Fail closed: never drop an existing CHECK merely because its text mentions
  -- processing_status. Its definition may contain unrelated business rules.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.stripe_webhook_events'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%processing_status%'
  ) THEN
    RAISE EXCEPTION 'An existing CHECK references processing_status. Review its full definition and prepare an explicit, lossless replacement before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stripe_webhook_events
    WHERE processing_status IS NULL
       OR processing_status NOT IN ('received','processing','processed','ignored','failed')
  ) THEN
    RAISE EXCEPTION 'Existing processing_status values are outside the candidate contract; reconcile them before applying this migration.';
  END IF;
END;
$preflight$;

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN processing_token uuid,
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0);

-- Existing CHECK constraints are never auto-dropped. Preflight above blocks
-- when one references processing_status; only a separately reviewed migration
-- may replace such a constraint without losing unrelated predicates.

ALTER TABLE public.stripe_webhook_events
  ADD CONSTRAINT stripe_webhook_events_processing_status_check
  CHECK (processing_status IN ('received','processing','processed','ignored','failed'));

CREATE INDEX stripe_webhook_events_processing_started_idx
  ON public.stripe_webhook_events (processing_started_at)
  WHERE processing_status = 'processing';

CREATE FUNCTION public.claim_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_event public.stripe_webhook_events%ROWTYPE;
  v_token uuid;
BEGIN
  IF NULLIF(btrim(COALESCE(p_stripe_event_id, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_event_type, '')), '') IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'errorMessage', 'Webhook event identity is invalid');
  END IF;

  v_token := gen_random_uuid();

  INSERT INTO public.stripe_webhook_events (
    stripe_event_id, event_type, processing_status,
    processing_token, processing_started_at, attempt_count
  ) VALUES (
    p_stripe_event_id, p_event_type, 'processing',
    v_token, now(), 1
  )
  ON CONFLICT (stripe_event_id) DO NOTHING;

  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true, 'processingToken', v_token);
  END IF;

  SELECT * INTO v_event
  FROM public.stripe_webhook_events
  WHERE stripe_event_id = p_stripe_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'errorMessage', 'Webhook event row could not be locked');
  END IF;

  IF v_event.processing_status IN ('processed','ignored') THEN
    RETURN jsonb_build_object('claimed', false, 'duplicate', true, 'status', v_event.processing_status);
  END IF;

  -- An active lease prevents concurrent delivery from processing the same
  -- event. A stale lease can be reclaimed after five minutes.
  IF v_event.processing_status = 'processing'
     AND v_event.processing_started_at > now() - interval '5 minutes' THEN
    RETURN jsonb_build_object('claimed', false, 'inProgress', true);
  END IF;

  UPDATE public.stripe_webhook_events
  SET event_type = p_event_type,
      processing_status = 'processing',
      processing_token = v_token,
      processing_started_at = now(),
      attempt_count = attempt_count + 1,
      error_message = NULL,
      processed_at = NULL
  WHERE stripe_event_id = p_stripe_event_id;

  RETURN jsonb_build_object('claimed', true, 'processingToken', v_token);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text,text)
  TO service_role;

COMMIT;
