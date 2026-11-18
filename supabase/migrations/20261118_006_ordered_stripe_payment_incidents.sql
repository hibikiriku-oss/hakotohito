-- Hakotohito: ordered, lease-fenced Stripe payment incident recording
-- Candidate migration only. Requires the Stripe schema from 004, webhook lease
-- columns/function from 005, and the global mutation gate from 009.
-- Existing incidents without Stripe event creation timestamps are deliberately
-- NOT auto-ordered: the RPC fails closed until those legacy rows are reconciled.

BEGIN;

-- Acquire the shared gate before catalog/data preflight and before ALTER TABLE
-- to preserve the repository-wide DDL/DML lock order.
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'Expected global mutation gate helper is missing';
  END IF;
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN
       pg_get_functiondef(to_regprocedure('public.acquire_global_mutation_gate_trigger()'))) = 0 THEN
    RAISE EXCEPTION 'Global mutation gate helper uses a different lock';
  END IF;
  IF to_regclass('public.payment_orders') IS NULL
     OR to_regclass('public.stripe_webhook_events') IS NULL
     OR to_regclass('public.stripe_payment_incidents') IS NULL THEN
    RAISE EXCEPTION 'Required Stripe tables are missing';
  END IF;
  IF to_regprocedure('public.claim_stripe_webhook_event(text,text)') IS NULL THEN
    RAISE EXCEPTION 'claim_stripe_webhook_event(text,text) is required';
  END IF;
  IF to_regprocedure('public.record_stripe_payment_incident_ordered(uuid,text,text,uuid,bigint,text,text,bigint,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Ordered Stripe incident RPC already exists; inspect before applying';
  END IF;
  IF to_regprocedure('public.guard_stripe_payment_incident_event_ordering()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.stripe_payment_incidents'::regclass
       AND tgname='trg_guard_stripe_payment_incident_event_ordering' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Stripe incident ordering guard already exists; inspect before applying';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='stripe_webhook_events'
      AND column_name='processing_token' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='stripe_webhook_events'
      AND column_name='processing_started_at' AND data_type='timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='stripe_webhook_events'
      AND column_name='processing_status' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='stripe_webhook_events'
      AND column_name='stripe_event_id' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='stripe_webhook_events'
      AND column_name='event_type' AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'Stripe webhook lease/event identity columns are missing or incompatible';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.payment_orders'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.stripe_payment_incidents'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.stripe_webhook_events'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
  ) THEN
    RAISE EXCEPTION 'Global mutation gate triggers are not installed on Stripe write tables';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='stripe_payment_incidents'
      AND column_name IN ('stripe_event_created','stripe_event_id')
  ) THEN
    RAISE EXCEPTION 'Stripe incident ordering columns already exist; inspect before applying';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stripe_payment_incidents
    WHERE (incident_type LIKE 'refund:%'
       OR incident_type LIKE 'dispute:%'
       OR incident_type LIKE 'charge_refunded:%')
      AND (NULLIF(btrim(details ->> 'stripe_event_id'), '') IS NULL
       OR COALESCE(details ->> 'stripe_event_created', '') !~ '^[0-9]+$')
  ) THEN
    RAISE EXCEPTION 'Legacy refund/dispute incidents lack trusted Stripe event ordering metadata; reconcile them before applying';
  END IF;
END;
$preflight$;

ALTER TABLE public.stripe_payment_incidents
  ADD COLUMN stripe_event_created bigint,
  ADD COLUMN stripe_event_id text;

ALTER TABLE public.stripe_payment_incidents
  ADD CONSTRAINT stripe_payment_incidents_event_created_nonnegative
  CHECK (stripe_event_created IS NULL OR stripe_event_created >= 0);

UPDATE public.stripe_payment_incidents
SET stripe_event_created = (details ->> 'stripe_event_created')::bigint,
    stripe_event_id = details ->> 'stripe_event_id'
WHERE NULLIF(btrim(details ->> 'stripe_event_id'), '') IS NOT NULL
  AND COALESCE(details ->> 'stripe_event_created', '') ~ '^[0-9]+$';

-- Reject writes from an old webhook deployment that still upserts incidents
-- without trusted Stripe ordering metadata. Stripe will retry after source cutover.
CREATE FUNCTION public.guard_stripe_payment_incident_event_ordering()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.incident_type LIKE 'refund:%'
     OR NEW.incident_type LIKE 'dispute:%'
     OR NEW.incident_type LIKE 'charge_refunded:%' THEN
    IF NEW.stripe_event_created IS NULL OR NEW.stripe_event_id IS NULL
       OR btrim(NEW.stripe_event_id) = ''
       OR NEW.stripe_event_id IS DISTINCT FROM (NEW.details ->> 'stripe_event_id') THEN
      RAISE EXCEPTION 'Refund/dispute incident requires trusted Stripe event ordering metadata';
    END IF;
    IF COALESCE(NEW.details ->> 'stripe_event_created', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Refund/dispute incident details require Stripe event creation timestamp';
    END IF;
    IF (NEW.details ->> 'stripe_event_created')::bigint IS DISTINCT FROM NEW.stripe_event_created THEN
      RAISE EXCEPTION 'Stripe event ordering metadata does not match incident details';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_stripe_payment_incident_event_ordering() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_stripe_payment_incident_event_ordering() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_stripe_payment_incident_event_ordering() TO service_role;
CREATE TRIGGER trg_guard_stripe_payment_incident_event_ordering
BEFORE INSERT OR UPDATE OF incident_type, details, stripe_event_created, stripe_event_id
ON public.stripe_payment_incidents
FOR EACH ROW EXECUTE FUNCTION public.guard_stripe_payment_incident_event_ordering();

CREATE FUNCTION public.record_stripe_payment_incident_ordered(
  p_order_id uuid,
  p_payment_intent_id text,
  p_processing_event_id text,
  p_processing_token uuid,
  p_event_created bigint,
  p_event_type text,
  p_incident_type text,
  p_actual_amount bigint,
  p_actual_currency text,
  p_object_id text,
  p_object_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_lease public.stripe_webhook_events%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_incident public.stripe_payment_incidents%ROWTYPE;
  v_details jsonb;
  v_materially_changed boolean;
BEGIN
  -- Must match migration 009 exactly; acquire before any row locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_processing_event_id IS NULL OR btrim(p_processing_event_id) = ''
     OR p_processing_token IS NULL
     OR p_event_created IS NULL OR p_event_created < 0
     OR p_event_type IS NULL OR btrim(p_event_type) = ''
     OR p_incident_type IS NULL OR btrim(p_incident_type) = ''
     OR char_length(p_incident_type) > 255
     OR (p_actual_amount IS NOT NULL AND p_actual_amount < 0)
     OR (p_actual_currency IS NOT NULL AND char_length(p_actual_currency) > 16) THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'Invalid incident event data');
  END IF;

  -- Fence the side effect with the current webhook lease. A reclaimed lease
  -- makes an old worker unable to write an incident.
  SELECT * INTO v_lease
  FROM public.stripe_webhook_events
  WHERE stripe_event_id = p_processing_event_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_lease.processing_status <> 'processing'
     OR v_lease.processing_token IS DISTINCT FROM p_processing_token
     OR v_lease.event_type IS DISTINCT FROM p_event_type THEN
    RETURN jsonb_build_object('success', false, 'staleLease', true,
      'errorMessage', 'Webhook processing lease was lost');
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.payment_orders
    WHERE id = p_order_id AND payment_type = 'coin_purchase'
    FOR UPDATE;
  ELSIF NULLIF(btrim(COALESCE(p_payment_intent_id, '')), '') IS NOT NULL THEN
    SELECT * INTO v_order
    FROM public.payment_orders
    WHERE stripe_payment_intent_id = p_payment_intent_id
      AND payment_type = 'coin_purchase'
    FOR UPDATE;
  ELSE
    RETURN jsonb_build_object('success', false, 'errorMessage', 'Payment order identity is missing');
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'notFound', true,
      'errorMessage', 'Coin purchase order was not found');
  END IF;

  IF NULLIF(btrim(COALESCE(p_payment_intent_id, '')), '') IS NOT NULL THEN
    IF v_order.stripe_payment_intent_id IS NOT NULL
       AND v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id THEN
      RETURN jsonb_build_object('success', false,
        'errorMessage', 'Payment Intent does not match the payment order');
    END IF;
    IF v_order.stripe_payment_intent_id IS NULL THEN
      UPDATE public.payment_orders
      SET stripe_payment_intent_id = p_payment_intent_id,
          updated_at = now()
      WHERE id = v_order.id;
    END IF;
  END IF;

  SELECT * INTO v_incident
  FROM public.stripe_payment_incidents
  WHERE payment_order_id = v_order.id
    AND incident_type = p_incident_type
  FOR UPDATE;

  IF FOUND THEN
    -- Old rows have no Stripe event timestamp. Guessing their order from
    -- recorded_at would be unsafe, so require explicit reconciliation.
    IF v_incident.stripe_event_created IS NULL
       OR v_incident.stripe_event_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'legacyOrderingUnknown', true,
        'errorMessage', 'Existing incident has no trusted Stripe event ordering metadata');
    END IF;

    IF p_event_created < v_incident.stripe_event_created THEN
      RETURN jsonb_build_object('success', true, 'recorded', false, 'staleEvent', true);
    END IF;
    IF p_event_created = v_incident.stripe_event_created THEN
      IF p_processing_event_id = v_incident.stripe_event_id THEN
        RETURN jsonb_build_object('success', true, 'recorded', false, 'staleEvent', true);
      END IF;
      -- Stripe's created timestamp has one-second precision. Do not pretend
      -- that lexical event-ID order is chronological; fail closed for a
      -- distinct event in the same second and leave the current incident intact.
      RETURN jsonb_build_object('success', false, 'ambiguousOrdering', true,
        'errorMessage', 'Distinct Stripe events share the same creation second; manual reconciliation is required');
    END IF;
  END IF;

  v_details := jsonb_build_object(
    'stripe_event_id', p_processing_event_id,
    'stripe_event_created', p_event_created,
    'stripe_event_type', p_event_type,
    'stripe_object_id', p_object_id,
    'stripe_object_status', p_object_status,
    'actual_amount', p_actual_amount,
    'actual_currency', CASE WHEN p_actual_currency IS NULL THEN NULL ELSE lower(p_actual_currency) END,
    'reason', p_reason,
    'recorded_at', now()
  );

  IF NOT FOUND THEN
    INSERT INTO public.stripe_payment_incidents (
      payment_order_id, incident_type, stripe_payment_intent_id,
      amount_jpy, currency, details, resolution_status,
      stripe_event_created, stripe_event_id
    ) VALUES (
      v_order.id, p_incident_type,
      COALESCE(NULLIF(btrim(COALESCE(p_payment_intent_id, '')), ''), v_order.stripe_payment_intent_id),
      v_order.amount_jpy, 'jpy', v_details, 'open',
      p_event_created, p_processing_event_id
    );
    RETURN jsonb_build_object('success', true, 'recorded', true, 'created', true);
  END IF;

  v_materially_changed :=
    (v_incident.details -> 'stripe_event_type') IS DISTINCT FROM (v_details -> 'stripe_event_type')
    OR (v_incident.details -> 'stripe_object_status') IS DISTINCT FROM (v_details -> 'stripe_object_status')
    OR (v_incident.details -> 'actual_amount') IS DISTINCT FROM (v_details -> 'actual_amount')
    OR (v_incident.details -> 'actual_currency') IS DISTINCT FROM (v_details -> 'actual_currency')
    OR (v_incident.details -> 'reason') IS DISTINCT FROM (v_details -> 'reason');

  UPDATE public.stripe_payment_incidents
  SET stripe_payment_intent_id = COALESCE(
        NULLIF(btrim(COALESCE(p_payment_intent_id, '')), ''), stripe_payment_intent_id
      ),
      details = v_details,
      stripe_event_created = p_event_created,
      stripe_event_id = p_processing_event_id,
      resolution_status = CASE WHEN v_materially_changed THEN 'open' ELSE resolution_status END,
      resolved_at = CASE WHEN v_materially_changed THEN NULL ELSE resolved_at END,
      resolved_by_line_user_id = CASE WHEN v_materially_changed THEN NULL ELSE resolved_by_line_user_id END
  WHERE id = v_incident.id;

  RETURN jsonb_build_object(
    'success', true, 'recorded', true, 'created', false,
    'materiallyChanged', v_materially_changed
  );
END;
$function$;

ALTER FUNCTION public.record_stripe_payment_incident_ordered(
  uuid,text,text,uuid,bigint,text,text,bigint,text,text,text,text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_stripe_payment_incident_ordered(
  uuid,text,text,uuid,bigint,text,text,bigint,text,text,text,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_stripe_payment_incident_ordered(
  uuid,text,text,uuid,bigint,text,text,bigint,text,text,text,text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
