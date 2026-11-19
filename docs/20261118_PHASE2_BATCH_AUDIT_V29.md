# Phase 2 batch audit — v29 candidate

Date: 2026-11-18 (JST)  
Baseline: v28 batch remediation candidate ZIP  
Scope: public performer response minimization, withdrawal function lineage/dual-role regression, transaction and notification coverage, Outbox worker scheduling/limits, active-account/role boundaries, and target-DB preflight design.

## Candidate correction included

1. **Remove internal account status from public performer directory payload.** `GET /api/performers` still inner-joins `users` and filters `users.account_status = 'active'`, but no longer selects/serializes `users.account_status` in the nested public response. The status remains a server-side filter only. Root and nested source copies are synchronized. No historical data is changed.

## High-priority confirmed findings

### A. Withdrawal function lineage — P1

The migration lineage contains two materially different definitions of `public.withdraw_user_account(text)`:

- `20261114_006_withdrawal_dual_role_direct_invite_refunds.sql` detects both performer and facility profiles (`v_is_performer`, `v_is_facility`) and processes both when both exist. It also contains the shared global mutation gate only in neither function body at this historical point; later migration 009 adds the gate to the then-current function.
- `20261116_013_cancel_reapply_and_direct_fee_refund.sql` is later and is the active source definition in the candidate sequence. It correctly acquires the global mutation gate first and updates `application_attempts` alongside application lifecycle changes, but it regresses to selecting/processing only the profile indicated by `users.user_type`.

Consequences: an administrator-created dual-role account can have its secondary profile and associated data left behind at withdrawal. The v28 checklist correctly identifies the need to integrate the two versions; this audit confirms it by a direct function-body diff. Do not simply restore migration 006 wholesale: that would lose the later application-attempt cleanup and current deferred-fee/refund behavior. A merged replacement requires preserving all later logic and verifying the current Tokyo schema/ACL first.

### B. Public performer payload minimization — P2

Before this batch, the directory query selected `users.account_status` and returned the entire nested `users` object. The query already had `.eq("users.account_status", "active")`, so the selected status field was not required to enforce the filter. v29 removes only that field from the nested response. The inner join and active filter remain.

### C. Profile/avatar multi-write behavior — P1

Static source review confirms separate PostgREST requests remain:

- performer registration: `users.avatar_*` UPDATE occurs before `performers` UPSERT;
- facility registration: `users.avatar_*` UPDATE occurs before `facilities` UPSERT;
- facility PATCH: `facilities` UPDATE commits before `users.avatar_*` UPDATE;
- performer PATCH updates only `performers`, so it does not share the same two-write failure mode.

A failed second request can leave a partial state while the API returns an error. A single SECURITY DEFINER RPC is the correct transaction boundary, but its validation, return shape, unique constraints, and role policy must be verified against the intended Tokyo schema before generating SQL.

### D. Notification lifecycle coverage — P1/P2

Static trigger/function inspection confirms:

- withdrawal wrapper `withdraw_user_account_with_notification_outbox(text)` enqueues match-cancellation and pending direct-invite notices from arrays returned by the base withdrawal function;
- base withdrawal also rejects ordinary pending `applications` and updates pending `application_attempts`, but does not return those application IDs/recipients to the wrapper;
- lesson withdrawal cleanup migration 011 changes pending `lesson_applications` to `rejected`; migration 016's lesson notification trigger is `AFTER INSERT`, not a status-transition trigger;
- band invitation migration 022 handles INSERT and pending→accepted/rejected, but not pending→cancelled;
- leader withdrawal disbands bands and changes active members to `left`; no matching band-disband/member notification event is created;
- event cancellation migration 020 does not cover every ordinary pending application rejection;
- expiry migration 010 updates application/attempt status, while migration 015 listens to attempt INSERT rather than status UPDATE.

Do not add generic triggers without first defining recipients, privacy-safe message content, event-key identity, and suppression for the withdrawing/cancelling actor. The existing Outbox's recipient UUID binding and lease fencing should be reused.

### E. Outbox operational limits — P2

- `src/lib/line-notification-outbox.ts` clamps each drain call to 5 rows, even when a caller passes 100 (the withdrawal API does this).
- `vercel.json` schedules the Outbox cron once daily at 02:05 UTC; immediate route drains are one bounded batch, not a continuous backlog worker.
- Delivery is at-least-once across the LINE external side-effect boundary: lease fencing prevents stale DB acknowledgements, but cannot retract a push accepted by LINE before a timeout/lease-expiry ambiguity.
- No dedicated queue inspection/retry UI was found in the source tree. Decide whether DB-only operator procedures are sufficient for a small limited release.

## Batch audit register (30 checks)

| # | Priority | Check / finding | Status |
|---:|---|---|---|
| 1 | P2 | Public performer nested `account_status` was unnecessary disclosure | Corrected in v29; server-side active filter retained |
| 2 | P1 | Latest withdrawal function is defined by migration 013, not the older migration 006 | Confirmed by migration order and duplicate function search |
| 3 | P1 | Migration 006 detects both performer and facility profiles | Confirmed |
| 4 | P1 | Migration 013 branches only on primary `users.user_type` | Confirmed; dual-role regression |
| 5 | P1 | Migration 013 acquires global mutation gate before user/profile row locks | Confirmed; preserve this in any merge |
| 6 | P1 | Migration 013 updates pending `application_attempts` when rejecting applications | Confirmed; preserve this in any merge |
| 7 | P1 | Migration 013 does not fetch/lock the secondary profile for a dual-role account | Confirmed |
| 8 | P1 | Withdrawal wrapper calls the base `withdraw_user_account(text)` and consumes its JSON result | Confirmed |
| 9 | P1 | Wrapper enqueues match cancellation notices from `notifications` | Confirmed |
| 10 | P1 | Wrapper enqueues pending direct-invite cancellation/refund notices | Confirmed |
| 11 | P1 | Ordinary pending applications rejected during withdrawal are not returned as notification targets | Confirmed gap |
| 12 | P1 | Pending application attempts are changed to rejected without a status-update notification trigger | Confirmed |
| 13 | P1 | Lesson withdrawal cleanup updates pending lesson applications | Confirmed in migration 011 |
| 14 | P1 | Lesson Outbox trigger listens to INSERT, not pending→rejected UPDATE | Confirmed gap |
| 15 | P2 | Band invitation trigger covers INSERT and pending→accepted/rejected | Confirmed |
| 16 | P2 | Band invitation pending→cancelled is not covered by migration 022 | Confirmed gap |
| 17 | P2 | Leader withdrawal disbands bands and ends active membership rows | Confirmed in migration 013 |
| 18 | P2 | No corresponding band-disband Outbox event is created in withdrawal function | Confirmed gap |
| 19 | P2 | Event cancellation wrapper does not return every ordinary application rejection recipient | Confirmed gap in migration 020 coverage |
| 20 | P2 | Expiry function updates application/attempt status | Confirmed in migration 010 |
| 21 | P2 | Application Outbox trigger listens to application_attempts INSERT | Confirmed in migration 015 |
| 22 | P2 | Expiry status UPDATE does not invoke the INSERT-only notification trigger | Confirmed gap |
| 23 | P1 | Performer registration updates avatar before profile upsert | Confirmed two-request write |
| 24 | P1 | Facility registration updates avatar before profile upsert | Confirmed two-request write |
| 25 | P1 | Facility PATCH commits profile before avatar update | Confirmed two-request write |
| 26 | P2 | Performer PATCH changes performer row only | Confirmed; no avatar DML in this route |
| 27 | P2 | Outbox helper clamps every drain to at most five rows | Confirmed in TypeScript |
| 28 | P2 | Withdrawal API passes 100 but helper still clamps to five | Confirmed caller/helper mismatch |
| 29 | P2 | Scheduled Outbox cron runs once daily; route drains are bounded single passes | Confirmed in `vercel.json` and helper |
| 30 | P1 | Tokyo post-reset business rows/catalog/trigger state are not included in candidate archive | Unverified live state; requires read-only preflight |

## Read-only target DB preflight

A new SQL file, `docs/20261118_PHASE2_V29_READONLY_TOKYO_PREFLIGHT.sql`, is included. It only reads catalogs and aggregate operational counts; it does not mutate data. Run it only against the intended Tokyo Supabase project after confirming the project reference. It reports migration history (when the standard Supabase migration table exists), relevant column/type/constraint metadata, trigger enabled state, function signatures/definition hashes, profile uniqueness constraints, dual-role aggregate counts, and Outbox queue counts. It does not select personal content or expose LINE IDs.

The preflight is not a substitute for PostgreSQL execution in a disposable database or LINE device tests. Do not treat old pre-reset row exports as current evidence.

## Verification boundaries

- Baseline was the v28 candidate ZIP; no earlier pre-reset business-row dumps were used as current evidence.
- One source correction was made: remove `users.account_status` from the public performer directory nested selection while retaining the active filter.
- Root and nested source copies are synchronized for the changed route and new audit artifacts.
- No PostgreSQL execution, live DB query, build, lint, test, typecheck, or local checks were performed.
- No Supabase, GitHub, or Vercel changes were made.
- Release remains **BLOCKED** pending dual-role withdrawal integration, profile transaction consolidation, notification coverage/policy, Tokyo read-only preflight, SQL validation, and controlled LINE verification.
