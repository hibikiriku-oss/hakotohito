# Hakotohito Phase 2 — Release-prep evidence and TOCTOU audit (v16)

Date: 2026-11-18 (JST)
Baseline: `Hakotohito_20261118_limited_release_phase2_privacy_acl_candidate_v15.zip`

## 1. Evidence inventory and recency boundary

The latest uploaded Supabase-related artifacts available in the Library were inspected:

- `supabase関数全体.txt`: exported public function definitions/catalog metadata.
- `①②③.txt`: broad function catalog/definition export.
- `貼り付けたテキスト（1）(20261117-045023).txt`: selected function definitions, including `withdraw_user_account`.
- `貼り付けたテキスト（1）(20261117-045229).txt` and `(20261117-045339).txt`: function owner/ACL/definition exports.
- `Hakotohito_20261117_ReadOnly_Final_Gate.sql` and `_v2.sql`: query scripts, not result exports.

These recent files are catalog/function/ACL evidence, not operational table-row snapshots. No data-only dump or current query-result export dated 2026-11-18 was found among the inspected recent artifacts. The only located business-row dump was `貼り付けたテキスト（1）(20261113-130305).txt`, captured on 2026-11-13. It is stale relative to the user's stated reset/current-data boundary and MUST NOT be used as current operational evidence. No inference about current balances, matches, refunds, applications, or test remnants is made from it.

The 2026-11-17 read-only gate SQL files are query definitions only. They do not prove that the queries were run or provide their result rows.

## 2. Stripe webhook incident ordering — P1 reconfirmed

Source: `src/app/api/stripe/webhook/route.ts`.

- The local `StripeEvent` type contains only `id`, `type`, and `data`; it omits Stripe's `created` timestamp.
- `recordPaymentIncident()` separately reads `payment_orders`, may update/link `stripe_payment_intent_id`, reads an existing incident, compares material fields, then performs an unconditional upsert keyed by `(payment_order_id, incident_type)`.
- `details.recorded_at` is local processing time, not Stripe event creation time.
- The webhook processing token fences updates to `stripe_webhook_events`, but it is not passed to or checked by the incident write path.
- Therefore a delayed older event for the same refund/dispute object can overwrite a newer incident state, and a delayed event can reopen an incident after an administrator resolved it. Global statement-level mutation serialization does not make this multi-request read/compare/write atomic.

Required remediation contract (not implemented in this candidate):

1. Pass and persist `event.created` and `event.id` as source ordering metadata.
2. Move payment-order association, incident row lock, monotonic event comparison, and incident upsert into one SECURITY DEFINER transaction/RPC.
3. Acquire the common global mutation gate before row locks; use a documented stable lock order.
4. Reject stale events. Define deterministic tie-breaking for equal `created` values using event ID, while remaining idempotent for duplicate delivery of the same event.
5. A stale event must never reopen an admin-resolved incident. Define whether a newer material event reopens it and preserve admin action history.
6. Restrict RPC EXECUTE to `service_role`; verify owner, fixed `search_path` including `pg_catalog`, and ACL postflight.
7. Exercise reverse-order refund/dispute delivery, concurrent delivery, retry after lease expiry, and admin-resolution races on a disposable database.

No speculative SQL or TypeScript patch was added: the required ordering and admin-resolution semantics must be implemented together, and no PostgreSQL execution environment or disposable DB evidence is available here.

## 3. Chat authorization/write race — P2 reconfirmed

Sources:

- `src/app/api/matches/[id]/chat/route.ts` (`POST`)
- `src/app/api/bands/[bandId]/messages/route.ts` (`POST`)

Match chat: `getAuthorizedMatch()` verifies the match is active/not cancelled and verifies the current facility or performer/current band leader through separate reads. The route then obtains/creates a conversation and inserts a message in later requests. A cancellation, account withdrawal, or band-leader change between authorization and insert can leave the insert based on stale authorization.

Band chat: `verifyActiveBandMember()` separately reads band status and active membership; `POST` then inserts into `band_messages`. A band disband or membership removal between those operations can permit a message after access was revoked.

Required remediation contract (not implemented): one RPC per chat domain that acquires the global gate first, locks/validates current user, match/band, relevant profile/member rows in a stable order, then creates/gets the conversation and inserts the message in the same transaction. Re-check current account status and authorization inside the RPC; do not trust API-side preflight alone. Restrict execution to service_role and test concurrent revoke/cancel versus send.

## 4. Band invitation race — P2 remains open

The v12 finding remains unresolved in source: active-leader authorization and invitation creation are not one atomic transaction. The eventual RPC must serialize with leader/member/band state changes and enforce duplicate/pending invitation rules in the same transaction.

## 5. Production data evidence plan

Before any production mutation, obtain a fresh read-only snapshot from the intended Tokyo Supabase project after the user's reset boundary. It must include capture timestamp/project identity, schema and constraints, relevant row aggregates, balances and ledger reconciliation, active matches/applications, direct-invite fee/refund linkage, outbox states, and migration/trigger/ACL state. Keep personal identifiers out of the general report; preserve a restricted raw export only where needed for exact reconciliation.

Do not apply migration candidates or upload application source until:

- the current snapshot is available and its capture time is confirmed;
- backup/restore point is verified;
- migration dependency order and preflight pass;
- the P1/P2 fixes are implemented and reviewed;
- a rollback plan and maintenance window are ready.

## 6. Status

- v16 adds audit documentation and checklist status only.
- No application source or SQL migration changed in this version.
- No database was connected to or modified; no GitHub/Vercel action was performed.
- No build, lint, test, typecheck, or local project checks were run.
- Release remains BLOCKED. Stripe coin purchase remains disabled during limited release.
