-- Retire legacy unfenced Outbox acknowledgements after the lease-token worker is deployed.
-- Apply only after the v43+ application is Ready and all old Vercel instances have drained.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261118);
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'public.line_notification_outbox'::regclass
         AND t.tgname = 'trg_global_mutation_gate'
         AND NOT t.tgisinternal
         AND t.tgenabled IN ('O', 'A')
         AND t.tgfoid = to_regprocedure('public.acquire_global_mutation_gate_trigger()')
     ) THEN
    RAISE EXCEPTION 'Enabled Outbox global mutation gate trigger is required before retiring legacy acknowledgements';
  END IF;
  IF to_regprocedure('public.claim_line_notification_outbox(integer)') IS NULL
     OR to_regprocedure('public.complete_line_notification_outbox(uuid,uuid)') IS NULL
     OR to_regprocedure('public.retry_line_notification_outbox(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Lease-token Outbox worker RPCs are required before retiring legacy acknowledgements';
  END IF;
  IF to_regprocedure('public.complete_line_notification_outbox(uuid)') IS NULL
     OR to_regprocedure('public.retry_line_notification_outbox(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Expected legacy acknowledgement signatures are missing; inspect migration state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.line_notification_outbox WHERE status = 'processing'
  ) THEN
    RAISE EXCEPTION 'Outbox has processing rows; wait for all in-flight workers to finish before retiring legacy acknowledgements';
  END IF;
  IF pg_get_function_result(to_regprocedure('public.claim_line_notification_outbox(integer)'))
       NOT LIKE '%lease_token uuid%' THEN
    RAISE EXCEPTION 'Claim RPC does not expose lease_token; refusing to retire legacy acknowledgements';
  END IF;
END;
$preflight$;

DROP FUNCTION public.complete_line_notification_outbox(uuid);
DROP FUNCTION public.retry_line_notification_outbox(uuid, text);

DO $postflight$
BEGIN
  IF to_regprocedure('public.complete_line_notification_outbox(uuid)') IS NOT NULL
     OR to_regprocedure('public.retry_line_notification_outbox(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy Outbox acknowledgement signatures remain after retirement';
  END IF;
  IF to_regprocedure('public.complete_line_notification_outbox(uuid,uuid)') IS NULL
     OR to_regprocedure('public.retry_line_notification_outbox(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Lease-token acknowledgement signatures are missing after retirement';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
