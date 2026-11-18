# Stripe Webhook ordering / side-effect fencing audit v11 — 2026-11-18

## Scope
Static review of the v10 candidate's remaining Stripe webhook and incident-management paths. Focus: `src/app/api/stripe/webhook/route.ts`, `src/app/api/admin/stripe-incidents/[id]/route.ts`, `20261114_005_stripe_webhook_atomic_claim.sql`, and the global mutation gate / purchase fulfillment routines. No live DB access, SQL execution, build, lint, test, typecheck, local checks, Git operation, push, or deploy was performed.

## Confirmed P1 finding — Stripe incident upsert is not ordered by Stripe event time

`claim_stripe_webhook_event(text,text)` fences updates to the webhook-event row with `processing_token`. `saveWebhookState()` also checks that token. However, the token is not passed into `recordPaymentIncident()` and does not fence the side effect on `stripe_payment_incidents`.

`recordPaymentIncident()` currently performs these as separate PostgREST requests:

1. Read the payment order and optionally link a PaymentIntent.
2. Read the existing incident row and compare selected fields.
3. Upsert the incident row unconditionally on `(payment_order_id, incident_type)`.

The Stripe event's `created` timestamp is not included in `StripeEvent` or persisted as an ordering field. The stored `recorded_at` is local processing time, not Stripe event time.

Stripe can deliver distinct events for the same refund/dispute object out of order. For example, a later `refund.updated` event indicating `succeeded` can be processed first, then an earlier `refund.created` event indicating `pending` can arrive later. Both use the same `incident_type` (`refund:<refund_id>`). The older event can overwrite the newer details and potentially reopen an incident after an administrator has resolved it. Its webhook-event row may correctly fail the stale processing-token check, but that does not roll back the already committed incident upsert.

The global mutation gate serializes individual public-table DML statements, but it does not make the multi-request read/compare/upsert sequence atomic. Therefore it does not prevent this out-of-order overwrite.

### Required remediation before enabling Stripe payment flows

- Add Stripe's immutable `event.created` and `event.id` to the incident update contract.
- Move order/PaymentIntent association plus incident compare-and-upsert into one SECURITY DEFINER database RPC transaction.
- Acquire the global mutation gate before any row locks; lock the payment order and existing incident in a consistent order.
- Reject/ignore incoming events older than the persisted Stripe event timestamp. For equal timestamps, use a deterministic event-id tie-breaker or retain the existing state unless the same event is replayed.
- Reopen a resolved incident only when a newer Stripe event materially changes the Stripe object state; do not let an older event reopen it.
- Keep webhook event-row completion token-fenced. The incident RPC should be idempotent independently of the event-row lease because Stripe may redeliver events.
- Add the new RPC to the reviewed SECURITY DEFINER allowlist / ACL plan and verify its owner, search_path, and service_role-only EXECUTE grants.

No speculative code patch was applied in v11 because this requires an atomic SQL contract and explicit ordering semantics; changing only the TypeScript read/upsert sequence would not close the race.

## Reviewed and not currently flagged

- The coin-purchase fulfillment RPC is idempotent for an already-paid order and validates Checkout Session, PaymentIntent, amount, currency, and order state under the global mutation gate.
- Payment-order status changes for expired/failed sessions are conditional on `status='pending'`, so they do not overwrite a completed order.
- Checkout Session recovery is conditional on a null session ID; the fulfillment RPC subsequently validates the exact session ID.
- Admin incident status changes use `manage_stripe_payment_incident`, which acquires the global mutation gate and locks the incident row.
- The status lookup route binds the order to the verified LINE user. Withdrawn accounts have their LINE identity rewritten by the withdrawal routine; the active-account predicate remains a consistency hardening item, not a demonstrated bypass in this pass.
- API source search found direct DML in the Stripe webhook and admin payment-settings routes only; the webhook's other fulfillment path calls the guarded purchase RPC. This is a scoped static search, not proof that every non-route writer (Edge Functions, pg_cron, external schedulers, SQL console) has been inventoried.

## Release impact

Stripe coin purchase remains disabled for the limited release. The webhook is intentionally retained to reconcile sessions created before the feature was disabled. Before any future re-enablement of purchases, the incident ordering RPC and its concurrency behavior must be implemented and verified in a disposable database, including deliberately out-of-order refund/dispute events and an administrator resolution racing with a webhook update.

This finding does not by itself establish that the matching-core limited release must expose Stripe purchase functionality; keep purchase creation disabled. Existing payment sessions still require reconciliation evidence.

## Candidate status

Documentation-only audit update. No source code or SQL was changed in v11. No production DB, GitHub, or Vercel changes. No SQL execution, build/test/lint/typecheck, or local checks. Release remains **BLOCKED** pending the existing v10 blockers and the Stripe incident ordering remediation/evidence.
