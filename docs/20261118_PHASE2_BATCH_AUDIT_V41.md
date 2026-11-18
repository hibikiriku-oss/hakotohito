# Phase 2 v41 — withdrawal notification / cron / profile consistency follow-up (2026-11-18)

## Scope and evidence

Follow-up static audit from the v40 candidate archive. Reviewed migration 016 and its direct-invitation refund dependency, the withdrawal API, application-attempt expiry migration 015, Outbox worker and cron routes, auto-completion cron, performer/facility profile registration routes, and root/nested source parity. The supplied Supabase exports remain the evidence baseline; no live database connection or target-catalog inspection was performed.

## Confirmed findings

### P2 — ordinary application rejection during withdrawal has no counterpart notification

Migration 016 closes pending applications in both withdrawal branches:
- facility withdrawal rejects pending applications belonging to the facility's requests;
- performer withdrawal rejects pending applications belonging to the performer, and rejects pending applications belonging to bands disbanded by that performer.

The function captures notification payloads for matches, pending direct invitations, pending lesson applications, pending band invitations, and band disband events. It does not capture ordinary pending application recipients or insert corresponding Outbox events. Migration 015's application-status trigger is specifically expiry-only: it sends only when the latest `application_attempts` row is `expired`; withdrawal changes pending attempts to `rejected`, so that trigger does not cover withdrawal. Consequently, ordinary applicants (including band applicants) or facilities may not be told that an application was rejected because the other party withdrew. This is a real notification gap, but it does not itself change balances or authorization. A future fix must be actor-aware, distinguish solo and band applications, exclude direct invitations already covered by their dedicated messages, and capture recipients before anonymization/cleanup.

### P2 — auto-completion candidate query has no explicit pagination

`src/app/api/cron/auto-complete/route.ts` queries eligible matches and processes the returned array, but the query has no `.range()`/cursor pagination and no explicit bounded page loop. Supabase/PostgREST row caps are configurable; if the deployment cap is reached, eligible matches beyond the returned page may not be processed in that run. The cron is daily (`0 0 * * *`, 09:00 JST). This is a scale/operational risk rather than proof of a current missed match. Before growth, add deterministic pagination and ensure the total work fits the deployed function duration/plan; alternatively use a bounded DB claim RPC.

### P2 — Outbox throughput and withdrawal response latency remain constrained

`drainLineNotificationOutbox` clamps every request to at most five rows. The withdrawal API passes `100`, but the effective batch remains five. The scheduled Outbox cron runs once daily at 02:05 UTC (11:05 JST), also with five rows. A withdrawal that creates more than five notices therefore leaves a backlog after the immediate drain; remaining messages depend on later user-triggered drains or the daily cron. The worker correctly surfaces claim/ack-record failures after v38, but cadence, backlog alerting, and operational recovery remain unverified. Do not describe the requested `100` as a 100-row drain.

### P2 — performer/facility profile and avatar writes are separate transactions

Both `POST /api/performers` and `POST /api/facilities` update `users.avatar_type/avatar_emoji` before the profile upsert. If the subsequent profile write fails, the avatar change remains committed while profile registration fails. The reverse partial state is also possible in any future reordered two-call implementation. A single transaction/RPC is required for atomicity; do not add one until the exact Tokyo schema, constraints, and response contract are verified. The v40 role guard is correctly before both writes and remains intact.

## Rechecked behavior

- `POST /api/performers` selects `id,user_type` and rejects non-performer primary accounts before avatar/profile writes; this closes the public secondary-profile creation path without treating an existing admin-configured dual-role profile as invalid.
- `POST /api/facilities` uses the facility-primary account guard. Its profile GET is owner-authenticated and is the only inspected route here that returns the facility registration address; the public facility detail route does not select that registration address.
- `/api/account/withdraw` derives the LINE user ID exclusively from the verified LINE ID token and invokes the Outbox wrapper with the server-side service-role client. It does not accept a caller-supplied user ID.
- The global mutation gate trigger in migration 009 is statement-level BEFORE INSERT/UPDATE/DELETE/TRUNCATE, so ordinary write statements acquire the advisory gate before row-level writes. Migration 016 also acquires the same gate before its user/profile locks. This static review found no basis to remove the global serialization design.
- The withdrawal helper's direct-invitation refund contract checks the actual debit and idempotency key; no-debit pending invitations are rejected without inventing a refund. Event/rental once-per-request fee policy is not changed by this batch.
- The wrapper inserts Outbox rows in the same transaction as withdrawal. External LINE delivery remains at-least-once: a successful push followed by failed acknowledgement can be retried and duplicated.
- The supplied 2026-11-17 function inventory does not prove migration 016's prerequisites exist in the target database. Its preflight and full migration chain remain mandatory; no SQL was run.

## Static audit checklist (30 checks)

1. Reopened the v40 candidate archive as the sole source baseline for this batch.
2. Confirmed root/nested copies of the v40 performer route match byte-for-byte.
3. Confirmed root/nested copies of migration 016 match byte-for-byte.
4. Rechecked v40's performer primary-role guard location before writes.
5. Rechecked facility primary-role guard.
6. Rechecked existing dual-role profile PATCH is update-only and does not create a profile.
7. Rechecked withdrawal API LINE ID comes from verified ID token.
8. Rechecked withdrawal API calls the Outbox wrapper, not the legacy RPC.
9. Rechecked wrapper and withdrawal RPC execute privileges are restricted to service_role in candidate SQL.
10. Rechecked migration 016 preflight checks global-gate, refund helper, wrapper, attempts, and Outbox prerequisites.
11. Rechecked migration 016 preflight validates required table triggers and withdrawal/lesson cleanup trigger.
12. Rechecked both profiles are independently discovered and locked for dual-role withdrawal.
13. Rechecked the primary-role/profile consistency check fails closed.
14. Rechecked matched lessons block withdrawal.
15. Rechecked disputed active matches block withdrawal.
16. Rechecked active matches are cancelled through the existing refund RPC.
17. Rechecked direct-invitation refund uses the actual debit and stable refund key.
18. Rechecked no-debit pending direct invitations are rejected without a fabricated credit.
19. Rechecked application_attempts are closed alongside direct-invitation rejection.
20. Rechecked facility withdrawal rejects pending request applications.
21. Rechecked performer withdrawal rejects pending applications and disbanded-band applications.
22. Found no ordinary-application withdrawal counterpart notification in migration 016.
23. Confirmed migration 015's status trigger only handles latest-attempt expiry, not withdrawal rejection.
24. Rechecked lesson counterpart payload capture occurs before the user-status cleanup trigger.
25. Rechecked band invitation counterpart payload capture occurs before invitation cancellation.
26. Rechecked band disband recipient capture occurs before membership closure.
27. Rechecked Outbox drain limit is hard-capped at five rows.
28. Rechecked withdrawal API's requested batch of 100 is therefore still five rows.
29. Rechecked scheduled Outbox cron cadence is daily and has claim/ack error HTTP 500 behavior.
30. Rechecked auto-completion query has no explicit pagination and noted deployment row-cap dependency.

## Release gates / non-actions

- Add actor-aware ordinary application withdrawal notifications, including solo/band recipient rules, before considering notification coverage complete.
- Decide Outbox cadence, backlog monitoring, retry/dead-letter handling, and operational recovery for the actual Vercel plan and LINE limits.
- Add explicit auto-completion pagination or a bounded claim RPC before eligible-match volume approaches the configured PostgREST row cap.
- Design atomic performer/facility profile + avatar writes only after target schema and constraints are verified.
- Decide and document the administrator-only secondary-role provisioning procedure; no self-service role-switching endpoint should be added.
- Inspect the exact target database catalog and migration history before any SQL application. The supplied exports are not sufficient to assert that the later Outbox/attempt migrations are installed.
- No SQL execution, PostgreSQL validation, live Supabase read, build, test, lint, typecheck, local checks, deployment, commit, or push was performed. Supabase, GitHub, and Vercel were not changed.
- Stripe coin purchase remains disabled; lesson functionality remains enabled.

**Release status: BLOCKED.** v41 is a static audit follow-up; it adds no SQL migration and does not claim runtime validation.
