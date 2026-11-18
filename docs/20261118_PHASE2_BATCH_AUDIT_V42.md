# Phase 2 v42 — withdrawal ordinary-application Outbox integration (2026-11-18)

## Scope and baseline

Continued from the v41 candidate archive. The batch focuses on the confirmed ordinary-application notification gap in candidate migration `20261118_016_integrated_withdrawal_dual_role_lifecycle_notifications.sql`. It also rechecks the existing dual-role withdrawal branches, direct-invitation fee flow, application-attempt lifecycle, Outbox event identity, and root/nested parity. Supplied Supabase exports remain the only database evidence; no live catalog inspection or SQL execution was performed.

## Candidate change incorporated

Updated migration 016 in both root and nested trees. No new migration number was added because migration 016 is still an unapplied candidate in this package lineage.

- Facility withdrawal: before pending applications are rejected, capture recipients for ordinary `performer_apply` and `band_apply` applications on that facility's requests. Solo applications notify the applicant; band applications notify each active band member. `facility_invite` is excluded because the dedicated direct-invitation cancellation/refund path already handles it.
- Performer withdrawal: determine active leader-owned bands before changing application state. Capture the affected facility recipient for the performer's pending solo applications and for pending applications belonging to bands that will actually be disbanded. A non-leader leaving a still-active band does not generate a false band-application cancellation notice.
- The captured payload includes application ID, recipient user ID, recipient LINE ID, request title, withdrawing role, application source, and band name where applicable. Recipients are captured before profile anonymization and cleanup.
- Both role branches append to a shared payload array, so a facility-primary dual-role account does not lose one side's notification batch.
- The Outbox wrapper inserts one event per application/recipient using the stable idempotency key `withdrawal_application:<application_id>:<recipient_user_id>` and `ON CONFLICT DO NOTHING`. It skips the withdrawing account, inactive/missing LINE recipients, malformed recipient payloads, and unknown withdrawing-role values.
- Notification text distinguishes facility withdrawal, solo performer withdrawal, and leader-triggered band disband. Existing direct-invitation refund notifications remain separate and unchanged.

This is a candidate source change only. It has not been PostgreSQL-parsed, executed, or exercised against Tokyo Supabase. The exact trigger behavior, Outbox recipient binding, and migration prerequisites still require target-catalog preflight and test-account verification before application.

## Remaining findings carried forward

### P2 — auto-completion pagination

`src/app/api/cron/auto-complete/route.ts` still fetches all candidates in one Supabase query without explicit `.range()` pagination or a bounded claim RPC. This remains a deployment-row-cap and scale risk. A pagination change is deferred until a safe per-run work budget can be chosen for the 60-second route and the sequential fee/completion RPCs; unbounded pagination could instead cause Cron timeouts.

### P2 — Outbox throughput and operations

The worker remains hard-capped at five rows per drain, and the scheduled Outbox Cron remains daily with five rows. A large withdrawal can create more than five notifications, so backlog monitoring, higher-frequency draining, retry/dead-letter review, and operational recovery remain unresolved. Do not interpret the withdrawal API's requested `100` as a 100-row drain.

### P2 — profile/avatar atomicity

Performer/facility registration still updates avatar fields and profile rows in separate REST transactions. Atomic RPC design remains deferred until the exact Tokyo schema, constraints, and response contract are confirmed.

### Additional release gates

- Administrator-only secondary-role provisioning procedure remains undocumented in the app source; do not add public self-service role switching.
- Migration 016 prerequisites and migration history must be inspected on the target database before any application.
- LINE delivery remains at-least-once; push accepted by LINE followed by failed acknowledgement can result in duplicate delivery.
- Ordinary application notifications are now represented in the candidate migration, but actual LINE payload delivery, Outbox recipient binding, and role-specific recipients are not runtime-verified.

## Static audit checklist (34 checks)

1. Reopened v41 as the source baseline for this batch.
2. Rechecked migration 016 prerequisite comments and fail-closed preflight.
3. Rechecked facility/performer dual-profile discovery and locking.
4. Rechecked primary-role/profile consistency guard.
5. Rechecked shared global mutation gate acquisition before user/profile locks.
6. Rechecked matched lesson and disputed match withdrawal blockers.
7. Rechecked active-match cancellation through the existing refund RPC.
8. Rechecked direct-invitation actual-debit lookup and idempotent refund helper.
9. Rechecked no-debit direct invitations are rejected without fabricated refund.
10. Rechecked direct-invitation notifications remain on their dedicated paths.
11. Rechecked facility withdrawal rejects pending applications and attempts.
12. Added pre-update capture of ordinary solo applicants on facility withdrawal.
13. Added pre-update capture of active band members for band applications on facility withdrawal.
14. Excluded `facility_invite` from ordinary-application notices to avoid overlapping direct-invite handling.
15. Excluded the withdrawing account from its own counterpart notification recipients.
16. Rechecked performer withdrawal closes own pending applications and attempts.
17. Moved leader-owned active band discovery before performer-side application cleanup.
18. Added pre-update facility capture for the performer's pending solo applications.
19. Added pre-update facility capture for pending applications of leader-owned bands being disbanded.
20. Did not notify facilities for unrelated bands that remain active when a non-leader leaves.
21. Appended notification payloads across both branches for dual-role users.
22. Included recipient user ID and application ID in the payload.
23. Added stable application/recipient Outbox event keys.
24. Added `ON CONFLICT DO NOTHING` for notification idempotency.
25. Rejected malformed role/recipient payloads in the wrapper loop.
26. Kept the notification inserts in the withdrawal wrapper transaction.
27. Rechecked lesson counterpart capture before the user status trigger.
28. Rechecked band invitation counterpart capture before invitation cancellation.
29. Rechecked band disband recipient capture before membership closure.
30. Rechecked root/nested migration copies for byte identity.
31. Rechecked auto-complete remains unpaginated and documented why unbounded paging is not safe.
32. Rechecked Outbox drain maximum remains five.
33. Rechecked daily Outbox Cron cadence and claim/ack error reporting.
34. Rechecked profile/avatar writes remain separate transactions.

## Non-actions and release status

No SQL execution, PostgreSQL validation, live Supabase read, build, test, lint, typecheck, local checks, deployment, commit, or push was performed. Supabase, GitHub, and Vercel were not changed. Stripe coin purchase remains disabled; lesson functionality remains enabled.

**Release status: BLOCKED.** v42 incorporates one concrete notification-gap fix into the unapplied candidate migration; runtime and target-schema verification remain mandatory.
