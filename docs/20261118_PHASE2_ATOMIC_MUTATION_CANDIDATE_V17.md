# Hakotohito Phase 2 — atomic mutation candidate (v17)

Date: 2026-11-18 (JST)
Baseline: v16 candidate ZIP; no live DB connection or production state was used.

## 1. Stripe refund/dispute incident ordering — P1 candidate implementation

Files:
- `src/app/api/stripe/webhook/route.ts`
- `supabase/migrations/20261118_006_ordered_stripe_payment_incidents.sql`

Changes in this candidate:
- The Stripe event contract now requires and validates `event.created`.
- The webhook passes its `processing_token` into the incident RPC.
- Payment-order lookup/PaymentIntent association, webhook lease verification,
  incident row lock, event-order comparison, and incident write are performed
  in one SECURITY DEFINER transaction.
- The migration itself acquires the exact global mutation advisory lock from
  migration 009 before preflight/ALTER TABLE, avoiding DDL-before-gate lock
  inversion. The RPC acquires that same lock before row locks; lock order is
  webhook event → payment order → incident.
- Older Stripe events are ignored. Equal `created` values use event ID as a
  deterministic tie-break. The same event replay cannot reopen an incident.
- A newer material Stripe state reopens the incident; unchanged material state
  preserves the admin resolution. Admin action history remains in the existing
  `stripe_payment_incident_actions` table.
- The RPC is owned by postgres, uses a fixed `pg_catalog, public, pg_temp`
  search_path, and grants EXECUTE to service_role only.
- Legacy refund/dispute incidents without trusted event ordering metadata make
  migration preflight fail. The runtime RPC also fails closed if such a row is
  encountered; `recorded_at` is not treated as Stripe event time.
- A guard trigger rejects direct legacy webhook upserts that omit or mismatch
  the new event-order metadata. This closes the migration-to-source-deploy gap:
  an old endpoint may return a retryable error, but cannot silently write an
  unordered incident; Stripe can retry after the new source is deployed.

Important limitation: no current operational row snapshot was supplied, so it
is not known whether legacy refund/dispute incidents exist. The preflight must
be reviewed against a fresh post-reset snapshot before applying. If legacy rows
exist, retrieve their original Stripe event timestamps from Stripe or reconcile
those incidents manually before migration; do not invent timestamps.

## 2. Band invitation creation — P2 candidate implementation

Files:
- `src/app/api/bands/invitations/route.ts`
- `supabase/migrations/20261118_007_atomic_invitation_and_chat_writes.sql`

The POST path now calls `create_band_invitation_atomic`. The RPC rechecks the
inviter's active account, active band, current active leader membership,
invitee account, existing membership, and pending invitation while holding the
global mutation gate; it then inserts the invitation. The existing invitation
INSERT trigger continues to enqueue the notification in the same transaction.
The earlier API reads remain only as user-friendly early validation; they are
not trusted by the write RPC.

## 3. Match chat and band chat — P2 candidate implementation

The same migration adds:
- `send_match_chat_message_atomic`: rechecks active account, active match,
  cancellation state, facility ownership or current solo performer/current
  band leader authorization, then obtains/creates the conversation and inserts
  the message in one transaction.
- `send_band_chat_message_atomic`: rechecks active account, active band and
  current active membership, then inserts the message in one transaction.

Both acquire the common global mutation gate before reads/writes. The API routes
call these RPCs for POST. Existing GET authorization/read behavior is not
changed by this patch; a separate read-side race remains possible if a match is
cancelled or a band member is removed after GET authorization but before the
message history query. This v17 change must not be described as closing all
chat authorization TOCTOU paths.

The match-chat RPC requires a non-partial unique index on
`conversations(match_id)`; the migration preflight verifies it before creating
functions. The migration also verifies the relevant gate triggers and the
band-invitation outbox trigger.

## 4. Verification still required

No PostgreSQL execution, disposable DB race test, build, lint, test, typecheck,
or local project check was run. This follows the user's instruction not to run
local checks before the 20:00 JST live verification window. Static source review
is not proof that the migrations compile or that the live schema matches.

Before applying:
1. Run `docs/20261118_PHASE2_V17_READ_ONLY_PREFLIGHT.sql` on the intended Tokyo
   Supabase project and retain timestamped results.
2. Confirm migration 009 global gate and migration 022 invitation outbox
   triggers are actually installed. The recent catalog evidence previously
   showed these candidate migrations were absent at snapshot time.
3. Confirm no legacy refund/dispute incident rows block migration 006.
4. Confirm all migration 007 preflight constraints, especially the unique
   conversations(match_id) index and gate triggers.
5. Apply to a disposable PostgreSQL database first; test reversed Stripe event
   order, same-event replay, lease reclaim, admin resolution race, leader
   demotion/disband versus invitation, member removal/disband versus band chat,
   and match cancellation/account withdrawal/leader change versus match chat.
6. Only after successful DB validation should the matching source and SQL be
   considered eligible for a controlled production maintenance window.

## 5. Status

- v17 contains source changes and two new candidate SQL migrations.
- Candidate only; not applied to Supabase and not deployed.
- No GitHub commit/push or Vercel deployment.
- No build/lint/test/typecheck/local checks.
- Operational business-row snapshot remains unavailable; stale 2026-11-13
  business data is not used.
- Release status remains BLOCKED pending fresh DB evidence and DB validation.
