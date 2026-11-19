# Hakotohito Phase 2 v18 — static review, evidence boundaries, and remaining blockers

Date: 2026-11-18 (JST)  
Baseline: v17 candidate ZIP.  
Scope: static inspection of uploaded source, candidate migrations, and uploaded Supabase exports. No live database connection was made.

## 1. v17 candidate re-review

### Stripe incident ordering (P1)

- v17 migration `20261118_006_ordered_stripe_payment_incidents.sql` correctly uses the same advisory transaction lock key as migration 009 before row locks and DDL.
- The RPC validates the current webhook lease token before associating the PaymentIntent and changing the incident row.
- The existing admin action history table is preserved; unchanged newer events do not clear an admin resolution, while materially changed newer events reopen the incident.
- v18 tightens the lease check: the stored `stripe_webhook_events.event_type` must also match the event type supplied to the RPC. A mismatch is treated as a stale/invalid lease and cannot write an incident.
- v18 also rejects blank event IDs in the incident guard.
- Event ID ordering for equal `event.created` values is deterministic only; Stripe event IDs are not a documented chronological clock. The implementation therefore does not claim true within-second chronology. This residual ambiguity must be covered in event-order testing and operational handling.
- Each incident row is written in its own RPC transaction. A `charge.refunded` event with multiple refund objects can therefore partially record before a later row fails. Retries are idempotent per `(payment_order_id, incident_type)` and event identity, but this is not an all-refunds-in-one-transaction batch.

### Band invitation and chat POST (P2)

- v17 routes call the new atomic RPCs after server-side LINE ID-token authentication; the RPCs re-check current database authorization under the global gate before inserting.
- Band invitation creation continues to use the existing INSERT notification-Outbox trigger.
- Match chat checks active match/cancellation state and current facility owner or performer/band leader before conversation/message creation.
- Band chat checks active account, active band, and active membership before insertion.
- The v17 POST changes do not close read-side races in the corresponding GET endpoints. Match-chat GET still authorizes, creates/loads a conversation, marks messages read, and reads message pages through separate requests. Band-chat GET authorizes and reads messages/sender profiles through separate requests. A cancellation, account withdrawal, or membership change can occur between those steps. This remains an explicit P2 follow-up; v18 does not claim complete chat TOCTOU closure.

### Performance-request DELETE (P2 / data-integrity gate)

- DELETE still checks application count, match count, and then deletes in separate PostgREST requests.
- The final DELETE includes request ID, facility ID, and `status='open'`, which is a useful compare-and-set guard, but it does not make the earlier dependent-row checks atomic.
- `application_attempts.request_id` is defined `ON DELETE CASCADE` in candidate migration 010. Other foreign keys and delete triggers for the target database are not present in the uploaded catalog evidence. Do not infer the complete delete behavior from the application route or this one migration.
- The v18 read-only preflight includes all FKs referencing `performance_requests`, their `confdeltype`, unique indexes, and relevant DELETE triggers. Until that result is reviewed, do not represent request deletion as safe against concurrent application/match creation or dependent-data loss.

## 2. What the uploaded Supabase files actually contain

The available uploaded materials were inspected directly:

- `supabase関数全体.txt`: routine definitions/owners/settings/ACL, RLS state, and table grants.
- `①②③.txt`: routine catalog and grants plus trigger definitions.
- `貼り付けたテキスト（1）(20261117-045023).txt` and `(20261117-045229).txt`: exported function definitions.
- `貼り付けたテキスト（1）(20261117-045339).txt`: exported function definitions/related metadata.
- `Hakotohito_20261117_ReadOnly_Final_Gate.sql` and `_v2.sql`: SQL query scripts, not captured query results.

These files do **not** contain the current business-row snapshot for users, applications, matches, coin transactions, webhook events, or payment incidents. They also do not provide a complete table-column/constraint/index catalog sufficient to prove the current schema for every v17 preflight requirement. The 2026-11-13 operational data export is older than the stated test-data reset boundary and is not used as current evidence.

The trigger export `①②③.txt` contains no entries named `trg_global_mutation_gate` or `trg_enqueue_band_invitation_created_line_notification` at its snapshot point. This is evidence that the uploaded snapshot did not show those triggers; it is not a substitute for a fresh target-database query. The candidate migrations 009 and 022 must not be treated as applied merely because their files exist in the ZIP.

## 3. Required DB preflight before any SQL application

Use `docs/20261118_PHASE2_V18_READ_ONLY_SCHEMA_AND_DATA_PREFLIGHT.sql` against the intended Tokyo Supabase project. Retain the result and timestamp. Review, at minimum:

1. Exact database identity and migration history.
2. Presence and exact columns of Stripe tables, webhook lease fields, incident actions, chat tables, and notification Outbox.
3. Global mutation gate triggers on all target tables and the two band-invitation Outbox triggers.
4. A valid non-partial unique index on `conversations(match_id)`.
5. Unique constraints/indexes for Stripe webhook event IDs and payment-order incident keys.
6. Existing refund/dispute incidents with missing Stripe event metadata. Migration 006 intentionally fails closed if such rows exist; reconcile from Stripe's original event history, never infer `event.created` from local `recorded_at`.
7. Every FK referencing `performance_requests`, its ON DELETE action, and DELETE triggers.
8. Post-reset aggregate row counts and application/match lifecycle distributions. No personal identifiers or free-text are needed for this gate.

The uploaded files are sufficient for source-level static review; they are not sufficient to fabricate or reconstruct the missing post-reset operational rows. No additional user upload is requested here. The remaining evidence must come from the read-only query against the target database during the user's available verification window.

## 4. Verification and release state

- No PostgreSQL execution or disposable-database race test was performed.
- No build, lint, test, typecheck, or local project check was performed, in accordance with the user's instruction.
- No Supabase change, Git operation, GitHub Push, or Vercel Deploy was performed.
- Stripe coin purchase remains disabled for the limited release. The webhook remains present for pre-existing Checkout Session reconciliation.
- Lesson functionality remains enabled.
- Release status remains **BLOCKED** until the fresh read-only DB evidence, disposable PostgreSQL validation, source integration review, and controlled LINE real-device tests are complete.

## 5. v18 file changes

- Tightened Stripe webhook lease/event-type matching and rejected blank Stripe event IDs in migration 006.
- Added privacy-safe, read-only schema/data/FK/index/trigger preflight SQL.
- Added this static review and evidence-boundary report.
- Updated `PUBLIC_RELEASE_CHECKLIST.md` and synchronized the repository copy under `music-matching/` so the two copies no longer disagree about v17/v18 progress.
