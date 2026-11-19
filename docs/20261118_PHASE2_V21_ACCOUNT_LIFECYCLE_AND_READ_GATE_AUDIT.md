# Hakotohito Phase 2 v21 — account lifecycle mutation guards and read-lock audit

Date: 2026-11-18 (JST)  
Baseline: v20 candidate  
Scope: static source review, uploaded DB function/catalog review, candidate SQL authoring. No PostgreSQL execution or live DB access.

## 0. Global mutation-gate lock-order cross-check

The raw uploaded function export represents the pre-migration definitions and must not be mistaken for the post-009 candidate definitions. A static scan of all 32 `CREATE OR REPLACE FUNCTION` blocks in `20261116_009_global_mutation_gate.sql` found that each block containing an explicit row lock or advisory lock acquires `pg_advisory_xact_lock(2147483000, 20261116)` before its first such lock. The trigger-only helpers (`set_initial_coin_balance` and `prevent_disputed_match_cancellation`) are invoked by table statements whose statement-level global gate fires before row triggers. This corrects the scope of the v20 raw-export finding: migration 009 already gate-first-redefines the coin fulfillment and admin incident routines; v20 migration 009's remaining unique purpose is to make webhook claim explicitly gate-first as well, while preserving the Stripe function contracts.

This is a static source conclusion only; the target DB may not yet have migration 009 applied, and the current uploaded catalog snapshot did not show its gate trigger.

## 1. New finding: stale authenticated requests can mutate after withdrawal

The global mutation gate serializes DML statements and the withdrawal RPC, but a route may read an active user/profile before withdrawal, then issue its DML after withdrawal has acquired and released the gate. The statement trigger serializes the write but does not re-check the account state or the relationship used by the earlier authorization read.

The uploaded `20261116_009_global_mutation_gate.sql` withdrawal function retains the `performers` and `facilities` rows and anonymizes them before setting `users.account_status='withdrawn'`. Therefore, stale profile/request writes can still find their owner rows after withdrawal unless the final DML checks the current account state.

### Source paths confirmed

- `src/app/api/facilities/route.ts`: profile POST/PUT performs avatar and facility writes in separate PostgREST requests.
- `src/app/api/performers/route.ts`: profile registration performs avatar and performer upsert in separate requests.
- `src/app/api/performers/profile/route.ts`: profile update looks up user/profile, then updates the performer row separately.
- `src/app/api/performance-requests/route.ts`: request POST looks up user/facility, then inserts the request separately.
- `src/app/api/performance-requests/[id]/route.ts`: request PATCH uses owner/open-status compare-and-set, but does not atomically re-check owner account status.
- `src/app/api/inquiries/route.ts`: user lookup and inquiry INSERT are separate; lookup does not require `account_status='active'`.
- `src/app/api/favorites/route.ts`: favorite INSERT follows separately resolved actor/target identities.
- `src/app/api/users` and profile routes: avatar updates are direct service-role DML.

This is a P1 account-lifecycle integrity issue: a request that passed authentication before withdrawal can potentially create/update a public profile or request after withdrawal. The statement-level gate alone does not close this read-then-write gap.

## 2. Candidate remediation added in migration 010

Added `20261118_010_active_account_mutation_guards.sql`. It adds row-level database guards, evaluated after the global statement gate has been acquired:

- `performers` and `facilities`: the owning user must still be active on INSERT/UPDATE.
- `performance_requests`: the facility's owning user must still be active on INSERT/UPDATE.
- `lesson_offers`: the owning performer user must still be active on INSERT/UPDATE.
- `lesson_applications`: both teacher and applicant accounts must still be active on INSERT/UPDATE.
- `inquiries`: the submitting user must still be active on INSERT.
- `favorites`: both the actor and target user must still be active on INSERT.
- `users` avatar fields: a withdrawn user's avatar cannot be changed by a stale profile request.

Withdrawal remains compatible with these guards: the current withdrawal function anonymizes/closes the related profile, requests and lesson offers before changing the user's account status, so those in-transaction cleanup writes still see the account as active. The guard does not disable lesson functionality; it only rejects writes for withdrawn participants.

The migration also rejects changes to profile owner IDs, request facility ownership, lesson-offer ownership, and lesson-application participant identity. It has fail-closed preflight checks for required columns, the global mutation gate helper/triggers, and duplicate guard objects. `docs/20261118_PHASE2_V21_READ_ONLY_PREFLIGHT.sql` provides a separate read-only target inventory and aggregate check. It is a candidate and has not been executed against PostgreSQL.

## 3. Lesson-specific account-state gap

Static review of the global-gate candidate definitions found that `create_lesson_offer`, `update_lesson_offer_with_levels`, and `apply_to_lesson_offer` lock rows and check balances/offer state but do not consistently verify `users.account_status='active'` for the teacher and applicant. Migration 010's `lesson_offers` and `lesson_applications` row guards cover those write paths at the database boundary.

Lesson functionality remains enabled. This change is not a feature-disable switch.

## 4. Read-lock inefficiency corrected

`get_band_chat_messages_atomic` is read-only: it checks active band membership and returns the latest 100 messages without writing read receipts. v20 nevertheless took the exclusive global mutation gate and locked the band `FOR UPDATE`, unnecessarily serializing independent chat reads and all writers.

Migration 007 now uses `pg_advisory_xact_lock_shared(2147483000, 20261116)` and `FOR SHARE` for this read-only RPC. Writers continue to take the exclusive gate first, so membership/band changes cannot pass concurrently while the read transaction is active, while multiple band-chat readers can coexist.

`get_match_chat_page_atomic` remains on the exclusive gate because it may create a conversation and update message read receipts.

## 5. Remaining direct-write consistency issue

Facility and performer profile registration/update still consists of two independent requests (avatar and profile). Migration 010 prevents either from mutating a withdrawn account, but it does not make the two profile writes atomic. A transient failure can still leave the avatar updated while the profile write fails, or vice versa. This is P2 and should be consolidated into a single profile RPC after the current DB schema and response contract are verified.

Admin-only settings/inquiry/announcement writes remain direct DML behind `requireAdmin`; Stripe webhook state/payment-order updates remain compare-and-set/lease-fenced paths and were not changed in this pass.

## 6. Verification boundaries

- Static review only; no PostgreSQL parser/runtime, disposable DB, concurrency test, build, lint, test, typecheck, or local checks were run.
- No Supabase, GitHub, or Vercel mutation was performed.
- Uploaded catalog/function exports do not contain a current post-reset business-row snapshot. The 2026-11-13 dump remains stale and is not used as current evidence.
- Migration 010 depends on migration 009 global gate. Migration 007 is still a candidate and must be applied only after its own preflight.
- Release remains **BLOCKED** pending target read-only preflight, PostgreSQL migration/trigger tests, concurrency tests, and controlled LINE verification.
