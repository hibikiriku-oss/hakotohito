# Phase 2 v35 — direct-invitation lifecycle and notification expiry audit

Date: 2026-11-18 JST  
Baseline: v34 candidate. Tokyo preflight SQL unavailable and not executed.

## Summary

A 24-point source-only audit rechecked the direct-invitation fee lifecycle across the candidate migrations, application-attempt expiry, notification triggers, band transfer/application guards, dual-role withdrawal lineage, and profile/avatar write boundaries. One stale API comment was corrected: the API no longer describes the fee as a fixed 100 coins; it describes the configured fee, charged only at match establishment. No runtime behavior was changed in this pass.

## Source change

- `src/app/api/facility/invitations/route.ts`: corrected the explanatory comment from a fixed 100-coin balance check to a check against the configured fee. The actual fee collection remains in the match-establishment transaction.
- Synchronized the matching `music-matching/` copy.

## Direct invitation lifecycle — verified in source

1. `create_facility_invitation_with_coins` reads `coin_rate_settings.direct_invitation_fee_coins` (fallback 100 only if the singleton row is absent).
2. It checks the facility balance against the configured amount without debiting coins at invitation creation.
3. It stores the configured amount in `application_attempts.fee_amount`, with `fee_due=true`.
4. It records the attempt start and seven-day expiry.
5. A rejected/expired previous attempt can be replaced with a new pending attempt while preserving attempt history.
6. Match-establishment functions load the pending attempt and charge only when `fee_due` is true.
7. Fee collection and match creation occur in the same transaction in the candidate functions.
8. Attempt/match-specific idempotency and existing refund/cancellation paths remain part of the migration lineage and must be regression-tested after DB preflight.

The above is static source verification only; PostgreSQL execution and actual configured DB values remain unverified.

## Notification gap confirmed

- `20261116_015_application_notification_outbox.sql` creates notifications on `INSERT` into `application_attempts`.
- `20261116_010_application_attempts_and_expiry.sql` expires attempts and changes pending `applications` to `rejected` inside `expire_pending_application_attempts`.
- No corresponding `AFTER UPDATE` notification trigger for the `applications.status` transition was found in the inspected notification migrations.
- Therefore, the expiry worker can reject an application without enqueueing the counterpart notification. This is a confirmed source-level gap, not merely an unknown.
- Similar notification gaps on withdrawal and lesson application rejection remain unresolved.

## Additional audit findings

1. Direct-invitation API comment had stale fixed-100 wording; corrected.
2. Configured direct-invitation fee is read by the RPC.
3. Invitation creation performs a balance sufficiency check but no debit.
4. Attempt stores fee amount snapshot.
5. Attempt expiry is seven days.
6. Reapplication updates the existing application and inserts a new attempt.
7. Previous pending attempt is closed before new attempt insertion.
8. Match-establishment path consumes `fee_due` and updates attempt charge metadata.
9. Attempt-level idempotency is present in the match-establishment lineage.
10. Refund/cancellation functions reference direct-invitation ledger keys; full DB-level regression remains pending.
11. Expiry worker caps each invocation at 5,000 rows.
12. Expiry worker updates application status but does not itself enqueue a status-change notification.
13. Attempt notification trigger is INSERT-only.
14. No general application status UPDATE notification trigger was found in the inspected migrations.
15. Band transfer acquires the global mutation gate before its advisory/row locks.
16. Band transfer checks active band membership and both account statuses for new transfers.
17. Band transfer idempotent replay returns the prior result before rechecking current account/membership state; no new debit occurs, but stale replay success semantics should be decided.
18. Band application checks all active members' owning accounts after the global gate.
19. Band application checks each active member's target level.
20. API transfer route uses verified caller identity and calls the security-definer RPC; database ACL/runtime state remains unverified.
21. Performer profile POST still writes avatar and profile in separate REST transactions.
22. Facility profile POST/PATCH still have separate profile/avatar write boundaries.
23. Migration 006 dual-role withdrawal behavior cannot be restored in isolation without preserving migration 013's later refund/attempt lifecycle.
24. Outbox worker throughput/retry/cron operational configuration cannot be confirmed from source migrations alone; deployment configuration and DB read-only inspection remain pending.

## Unresolved blockers

| Priority | Issue | Status |
|---|---|---|
| P1 | Dual-role withdrawal preserving later refund and attempt lifecycle | Unresolved |
| P1 | Atomic profile/avatar writes | Unresolved |
| P1 | Withdrawal/lesson application counterpart notifications | Unresolved |
| P1 | Expired ordinary application notification | Confirmed gap; implementation pending |
| P2 | Band transfer idempotent replay after membership/account status changes | Semantics require decision |
| P2 | Band invitation cancellation/disband notifications | Unresolved |
| P2 | Outbox drain schedule, backlog recovery and operational monitoring | Unverified |
| P2 | Tokyo DB constraints, migration history, function ACLs and live settings | Pending read-only access |

## Verification boundary

Only source inspection, text edits, copy synchronization, ZIP integrity and SHA-256 checks. No SQL was executed. No build, test, lint, typecheck or local checks were run. No Supabase, GitHub or Vercel changes. Release remains **BLOCKED**.
