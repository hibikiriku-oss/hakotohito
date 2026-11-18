# v17 candidate rollback notes (2026-11-18)

These migrations are candidates and have not been applied or executed here.
Do not use rollback as a substitute for investigating a failed preflight.

## 006 — ordered Stripe incidents

1. Disable Stripe webhook delivery temporarily or otherwise ensure no incident
   event is being processed.
2. Export `stripe_payment_incidents` including the new ordering columns and
   preserve the export with the payment/order audit evidence.
3. Confirm the current function is exactly
   `public.record_stripe_payment_incident_ordered(uuid,text,text,uuid,bigint,text,text,bigint,text,text,text,text)`.
4. If rollback is approved, run in one transaction:

```sql
BEGIN;
DROP FUNCTION public.record_stripe_payment_incident_ordered(
  uuid,text,text,uuid,bigint,text,text,bigint,text,text,text,text
);
DROP TRIGGER trg_guard_stripe_payment_incident_event_ordering
  ON public.stripe_payment_incidents;
DROP FUNCTION public.guard_stripe_payment_incident_event_ordering();
ALTER TABLE public.stripe_payment_incidents
  DROP CONSTRAINT stripe_payment_incidents_event_created_nonnegative,
  DROP COLUMN stripe_event_created,
  DROP COLUMN stripe_event_id;
NOTIFY pgrst, 'reload schema';
COMMIT;
```

5. Restore the matching pre-v17 webhook source at the same deployment boundary.
   This removes event-order metadata, so retain the export and do not roll back
   after the system has accepted ordered incidents unless the audit trail is
   preserved elsewhere.

## 007 — atomic invitation/chat writes

No table data is changed by the migration itself. If rollback is approved,
restore the matching prior application source and then drop the RPCs:

```sql
BEGIN;
DROP FUNCTION public.create_band_invitation_atomic(uuid,uuid,uuid,text,text);
DROP FUNCTION public.send_band_chat_message_atomic(uuid,uuid,text,text);
DROP FUNCTION public.send_match_chat_message_atomic(uuid,uuid,text,text);
DROP FUNCTION public.get_band_chat_messages_atomic(uuid,uuid,text);
DROP FUNCTION public.get_match_chat_page_atomic(uuid,uuid,boolean,timestamptz,uuid,integer,text);
NOTIFY pgrst, 'reload schema';
COMMIT;
```

The RPCs insert through existing tables/triggers. Do not drop or disable the
existing band-invitation notification outbox triggers or global mutation gate.

## Required postflight

- Confirm function owner is `postgres`, `SECURITY DEFINER` is true, and
  `search_path` begins with `pg_catalog`.
- Confirm EXECUTE is granted to `service_role` only (plus owner), with no
  PUBLIC/anon/authenticated grants.
- Confirm PostgREST schema cache sees all RPCs introduced by migrations 006–008.
- Exercise rollback only on a disposable database before any production use.


## 008 — atomic performance-request deletion

Restore the previous DELETE route first. Then, only after confirming the function is not in active use, run:

```sql
BEGIN;
DROP FUNCTION public.delete_open_performance_request_atomic(uuid,uuid,text);
NOTIFY pgrst, 'reload schema';
COMMIT;
```

Applying the migration itself does not alter table data or foreign keys. Invoking the RPC deletes a request only after its transactional checks pass. It verifies the current LINE subject against the facility user row. It deliberately rejects deletion while applications, matches, or application-attempt audit rows exist.
