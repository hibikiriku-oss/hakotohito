# Phase 2 v39 — Supabase snapshot reconciliation and integrated withdrawal repair (2026-11-18)

## Evidence used

This batch uses the user's latest uploaded Supabase evidence and the user's confirmation that the database has not changed since that upload:

- `貼り付けたテキスト（1）(20261113-130305).txt` (uploaded 2026-11-13 13:03 UTC): latest timestamped public table data dump; SHA-256 `300c3599352eb49d37b501f3dd04f00c2aee081e880e14429e5e50aa6ed248f9`. Its SQL/data payload matches `data.sql` uploaded at 13:01 UTC; the two files differ only in line endings.
- `schema(2).sql` (uploaded 2026-11-12): public schema/function snapshot; SHA-256 `a88730a3a02bedd43ec7b02e0aa3ac1d014e3be1fb602c9ffa61e9aeec5dac3e`.
- `supabase関数全体.txt` (uploaded 2026-11-17 15:22 UTC): latest supplied function/ACL/trigger inventory; SHA-256 `a09f76ae80ad2adc31960bcbe18a9a20e8b5fb151ce432f5d0aabe9bf7fd56da`.

The data snapshot contains 2 active users and confirms that one account has both a `performers` row and a `facilities` row while its primary `users.user_type` is `facility`. The same snapshot has one active band with one active leader membership, 2 pending applications, 2 performance requests, no matches, no lesson offers/applications, and no coin transactions for direct-invitation fees. No personal identifiers are reproduced in this report.

The schema/data exports predate the later application-attempt and Outbox migrations. The 2026-11-17 function inventory also contains only the legacy `withdraw_user_account(text)` definition and does not list the wrapper, application-attempt expiry RPC, or Outbox worker RPCs. Therefore the supplied live snapshot does not establish that migrations 009-015/021 are applied. Migration 016 is deliberately dependent on that complete earlier chain and will fail closed if applied alone. The user's statement that the database has not changed since the final data upload is treated as the current-state premise; the age and coverage limitations of the exports remain explicit.

## High-priority findings

1. **Confirmed dual-role account exists in supplied data.** A facility-primary user also owns a performer profile. This is not a hypothetical edge case.
2. **Later migrations overwrite dual-role withdrawal handling.** Migration 006 contains a dual-profile implementation, but migration 009 replaces `withdraw_user_account` with a single-`user_type` branch to add the global mutation gate. Migration 013 replaces it again with single-role handling plus attempt lifecycle logic. The final migration order therefore loses the dual-role behavior from 006.
3. **Dual-role personal data can remain after withdrawal.** With a facility-primary dual-role account, the later function anonymizes the facility profile but skips performer anonymization, lesson-offer closure, band membership cleanup, and performer-side pending application cleanup.
4. **Deferred direct-invitation fee regression in migration 013.** The 013 withdrawal loops call `reject_direct_invitation_with_refund_for_withdrawal` for every pending direct invitation. The supplied helper requires an existing debit row and returns failure if none exists. Under the current policy, pending direct invitations have no debit until match establishment; therefore withdrawal can roll back merely because a no-fee pending invite exists. Migration 006 correctly checks for an actual debit first and rejects without inventing a refund.
5. **Lesson cleanup trigger misses dual-role facility-primary accounts.** Migration 011 returns early unless `NEW.user_type='performer'`; a user with an actual performer profile but primary type `facility` does not have pending lesson applications closed.
6. **Withdrawal lock order must retain the global gate.** Migration 009 added the global transaction gate before the first row lock. The integrated function preserves this as its first transactional action.
7. **Application attempts must close with the parent application.** The integrated function explicitly marks pending attempts rejected for facility requests, performer applications, direct invitations, and disbanded-band applications. This closes gaps where the direct-invite helper rejects the parent application before broad pending-only cleanup can find it.
8. **Band disband must invalidate all pending invitations in the disbanded band.** The integrated function collects counterpart recipients before changing membership, then cancels pending invitations involving the withdrawing performer or any disbanded band.
9. **Counterpart notifications were incomplete.** Existing withdrawal wrapper only handled match and direct-invite arrays. The integrated wrapper additionally enqueues lesson-application, band-invitation-cancellation, and band-disband notices in the same transaction.

## Candidate changes in v39

- New migration `20261118_016_integrated_withdrawal_dual_role_lifecycle_notifications.sql` is included in both migration trees.
- Reconciles dual-profile handling from migration 006 with application-attempt lifecycle from migration 013.
- Acquires the global mutation gate before reading/locking account rows.
- Checks for actual legacy direct-invite debit before invoking refund helper; no-debit invitations are rejected without a refund.
- Updates pending `application_attempts` when related applications are rejected.
- Captures counterpart lesson and band notifications before the account/profile state is anonymized.
- Cancels pending invitations associated with a withdrawn performer and invitations in any band disbanded by that withdrawal.
- Replaces the lesson cleanup trigger function so it uses actual performer-profile existence, not the primary `user_type` label.
- Extends the existing Outbox wrapper while retaining match and direct-invite notification behavior.
- Keeps all new SQL as candidate-only; no database execution.
- Explicitly requires the earlier 20261116 009-014/021 and 20261118 001-015 migration chain; it is not a standalone hotfix.

## Static review checklist (20 checks)

1. Latest supplied data snapshot loaded and hashed.
2. Latest supplied function inventory loaded and hashed.
3. Dual-role account count and relation verified without disclosing IDs.
4. Current exported `withdraw_user_account` compared with migration 006.
5. Migration 009 overwrite identified.
6. Migration 013 overwrite identified.
7. Global gate placement in 009 checked.
8. Final integrated function acquires gate before row locks.
9. Both profile rows are independently discovered and locked.
10. Primary role/profile mismatch remains fail-closed.
11. Active matched lessons still block withdrawal.
12. Pending lesson notifications are captured before trigger cleanup.
13. Lesson cleanup trigger no longer relies on primary user_type.
14. Legacy direct-invite debit is checked before refund helper call.
15. No-debit direct invitations are rejected without a fabricated refund.
16. Attempt rows are closed for direct invitations and general application paths.
17. Band disband invitations are cancelled in addition to direct invitations.
18. Band members receive disband notification before membership rows are closed.
19. Wrapper inserts new notifications through existing Outbox table and event-key idempotency.
20. Root/nested migration copies are byte-identical; ZIP integrity verified.

## Remaining release gates

- PostgreSQL preflight and actual migration application are not performed.
- The supplied schema/data files are older than the latest application-attempt and Outbox migrations; live post-migration catalog verification remains required before applying v39.
- No SQL execution, build, tests, lint, typecheck, local checks, LINE delivery, GitHub, Supabase, or Vercel changes were performed.
- Vercel Cron cadence and Outbox operational alerting remain open.
- Profile/avatar atomic-write design remains open.
- Notification to a band's leader when a non-leader member withdraws (without disbanding the band) remains a separate follow-up.
- Release status remains **BLOCKED** pending SQL review/preflight, actual device checks, and operational gates.
