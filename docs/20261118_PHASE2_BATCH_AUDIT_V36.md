# Phase 2 v36 — expiry notification and lifecycle audit

Date: 2026-11-18 JST  
Baseline: v35 candidate. Tokyo read-only preflight SQL remains unavailable and was not executed.

## Summary

A 28-point source-only audit was performed across application expiry, direct-invitation fee lifecycle, notification recipient selection, Outbox identity/lease fencing, withdrawal and lesson notification paths, profile/avatar write boundaries, band transfer/application authorization, API authentication, and cron scheduling. One new candidate migration was added for expiry notifications.

## Source change

- Added `20261118_015_expired_application_notification_outbox.sql` in both root and nested migration trees.
- It enqueues a notification only for a `pending` -> `rejected` application transition where the newest `application_attempts` row is actually `expired` and its expiry time has passed.
- Performer applications and direct invitations notify the active performer account. Band applications notify active members of the relevant band. Withdrawn/unlinked LINE accounts are excluded.
- Event keys include the attempt and recipient account identity; the existing Outbox recipient-binding trigger adds the stable recipient identity and rejects mismatched payload reuse. `ON CONFLICT DO NOTHING` prevents duplicate enqueue.
- Manual rejection is not notified by this migration: it is intentionally limited to the latest attempt being expired.

## 28 audit points

1. Confirmed expiry worker changes pending attempts to `expired`.
2. Confirmed the worker changes corresponding pending applications to `rejected`.
3. Confirmed the existing application notification trigger is `AFTER INSERT` on `application_attempts`, not an application status-update trigger.
4. Confirmed expiry status updates previously had no corresponding Outbox enqueue path.
5. Added an expiry-specific `AFTER UPDATE OF status` trigger.
6. Restricted the trigger to pending-to-rejected transitions.
7. Required the newest attempt to be expired, preventing stale prior attempts from causing false expiry notices.
8. Required `expires_at <= now()` before notification.
9. Performer applications notify the applicant's active account.
10. Direct invitations notify the invited performer's active account.
11. Band applications notify active members, not the facility that already received the original application notice.
12. Excluded inactive accounts.
13. Excluded empty and withdrawn LINE IDs.
14. Used attempt- and recipient-specific event keys.
15. Preserved Outbox conflict-based duplicate suppression.
16. Added fail-closed preflight checks for required relations, columns, and the migration 004 Outbox recipient-binding trigger.
17. Added preflight rejection if the trigger/function already exists.
18. Kept the new trigger function SECURITY DEFINER with a fixed search_path.
19. Revoked direct function execution from all API roles; invocation occurs only through the table trigger.
20. Acquired migration locks in the same order as the Outbox hardening lineage.
21. Confirmed Outbox hardening binds notifications to active account UUIDs.
22. Confirmed worker acknowledgements use lease tokens in migration 004.
23. Confirmed stale lease acknowledgements are fenced by token matching.
24. Confirmed the worker route drains at most five records per invocation.
25. Confirmed Vercel schedules expiry once daily and Outbox drain once daily; this can delay expiry notices and delivery and requires an operational schedule decision.
26. Confirmed performer profile POST still updates avatar and profile in separate REST transactions.
27. Confirmed facility profile POST/PATCH still update avatar and facility profile separately; atomic RPC remains unresolved pending schema/response-contract verification.
28. Rechecked direct-invitation deferred fee semantics, band active-account guards, dual-role withdrawal lineage, and lesson/withdrawal notification gaps; no additional runtime behavior was changed in those areas.

## Remaining blockers

| Priority | Issue | Status |
|---|---|---|
| P1 | Dual-role withdrawal preserving migration 013 refund/attempt behavior | Unresolved; DB definition/constraints must be verified before safe merge |
| P1 | Atomic performer/facility profile and avatar persistence | Unresolved; schema/response contract not sufficient for a safe speculative RPC |
| P1 | Withdrawal and lesson-application counterpart notifications | Unresolved |
| P1 | Expiry notification migration 015 | Candidate added; requires DB preflight and PostgreSQL application review |
| P2 | Band invitation cancellation/disband notifications | Unresolved |
| P2 | Outbox/expiry cron frequency and backlog operations | Daily schedules confirmed in source; deployment plan decision required |
| P2 | Band transfer idempotent replay after account/membership state changes | Existing replay semantics need product decision; no new debit occurs on replay |
| P2 | Live DB constraints, migration history, ACLs, and settings | Pending read-only access |

## Important boundaries

- Direct-invitation creation does not debit coins. It stores the configured `direct_invitation_fee_coins` snapshot and a seven-day attempt. Collection remains at match establishment.
- Rejected/expired attempts can be retried while preserving attempt history.
- The new expiry notification trigger does not alter fees, application statuses, or matching creation; it only enqueues notifications after the existing expiry worker changes application status.
- The migration has not been executed. Its behavior and compatibility with actual PostgreSQL catalog/data remain unverified.

## Verification boundary

Source inspection, candidate SQL authoring, root/nested synchronization, text comparison, ZIP integrity, and SHA-256 only. No SQL execution, build, test, lint, typecheck, or local checks. No Supabase, GitHub, or Vercel changes. Release remains **BLOCKED**.
