# V48 rollout runbook — candidate only (2026-11-22)

## Current release decision: BLOCKED

This runbook is an operational sequence, not authorization to change production. Do not apply V48 SQL or deploy the V48 source until the release gate in `20261122_V48_DEPLOYMENT_GATE.md` is closed. In particular, V48.004 and V48.005 introduce new debits that are not fully integrated with cancellation/refund paths.

## 1. Establish the live baseline (read-only first)

1. Confirm the exact Vercel Production deployment/commit and the active Supabase project and database branch.
2. Create a fresh Supabase backup and verify that the recovery point is usable.
3. Export/record the live migration history from the actual project. Do not infer applied state from filenames in this ZIP.
4. Run the relevant V47/V48 read-only preflight SQL only after confirming its prerequisites. At minimum review:
   - `docs/20261122_V48_PREFLIGHT_READONLY.sql`
   - `docs/20261122_V48_REFUND_SOURCE_PREFLIGHT_READONLY_V2.sql`
   - existing V47 application-attempt, participant, Outbox, fee, trigger, RLS and SECURITY DEFINER prerequisites.
5. Save the complete query output with a timestamp and target project identifier. Reconcile all existing rows, constraints, indexes, triggers, policies, RPC definitions, fee transactions and refunds before preparing DDL.
6. Stop if any prerequisite is missing, any result is ambiguous, or any existing transaction cannot be safely attributed. Do not clear `reserved_coins`, rewrite historical balances, or infer historical band rosters.

## 2. V48 migration order (future sequence only; NOT approved to execute)

After all release blockers are resolved and reviewed, the candidate migration order is:

1. Reconcile and apply only V47 prerequisite migrations that are confirmed absent from the live DB. Never replay historical migrations wholesale.
2. `20261122_001_application_participant_snapshot_and_trade_claims.sql`
3. `20261122_002_band_profile_edit_rpc.sql`
4. `20261122_003_match_time_fee_rate_settings.sql`
5. `20261122_004_performance_reward_fee_at_match.sql`
6. `20261122_005_lesson_match_fee_snapshots_and_no_holds.sql`
7. Run the relevant postflight SQL and reconcile every result against the expected schema and data invariants.

Each migration must be reviewed against the actual live function definitions, schema, constraints, triggers, RLS and grants. Use a transaction where the migration supports it. Stop on the first unexpected result; do not continue to later migrations.

**Important:** Steps 2–6 are listed to make the candidate dependency order explicit. They are not a recommendation to apply now. The V48.004/005 fee and refund gaps must be resolved first.

## 3. Application rollout (future sequence only)

1. Deploy only after all required database migrations and postflight checks are complete and the source/DB versions are mutually compatible.
2. Confirm Vercel supports the every-minute Outbox Cron schedule and verify `CRON_SECRET`, Supabase URL and service-role credentials in the correct environment.
3. Confirm the new deployment is Ready and that the production commit is the intended V48 source.
4. Keep rollback artifacts and the previous deployment available until smoke tests and data reconciliation pass.

## 4. LINE real-device tests and Supabase evidence collection

Run controlled tests with dedicated test accounts and record before/after database evidence. Avoid real payments or irreversible user actions unless separately approved.

- Registration and account-role state; verify no duplicate initial coin grant.
- Individual application: save the attempt-time fee (default 10 coins); submission checks balance only; no debit occurs until match acceptance.
- Direct invitation: facility balance check at creation; no debit until acceptance; payer is the facility.
- Match acceptance: verify the correct payer, exact debit amount, idempotency key and snapshot. Insufficient balance must roll back the entire acceptance.
- Band application: verify submission-time participant snapshot and claims; later membership edits must not rewrite the attempt snapshot.
- Event/rental: distinguish the once-per-request initial fee from the per-match fee; verify cancellation and rematch do not cause unintended duplicate charges.
- Performance reward: verify 10% of the total project/band reward, yen-to-coin conversion rounding, payer and immutable snapshot.
- Lesson: verify teacher-side 10% fee, conversion and snapshot at acceptance; creating/editing an offer must not reserve capacity-wide coins.
- Band profile edit: leader succeeds; non-leader and inactive account are rejected.
- Outbox: at most five records per batch, bounded multi-batch drain, delivery/ack/retry/dead-letter evidence and no duplicate delivery.
- Cancellation, rejection, withdrawal and dispute paths: verify every debit/refund pair by source transaction ID and ensure no duplicate refund.

For every test, capture relevant rows from users, applications/application_attempts, matches, lesson_applications/lesson_fee_snapshots, coin_transactions, match_fee_snapshots, Outbox and band membership/history tables. Record expected and actual balance deltas. Use read-only postflight queries; do not manually edit ledger rows to make a test pass.

## 5. Stop conditions

- Any mismatch between the live migration state and the candidate's assumptions.
- Any unlinked, duplicate, ambiguous or unexplained fee/refund transaction.
- Any source debit that cannot be uniquely identified for a refund.
- Any missing SECURITY DEFINER actor/admin check, RLS/grant discrepancy, lock-order inversion or race condition.
- Any participant-claim collision or historical snapshot uncertainty that could alter eligibility.
- Any SQL error, failed postflight invariant, Outbox backlog/lease anomaly, or Vercel Cron incompatibility.

Do not bypass a stop condition by disabling a trigger, dropping a constraint, clearing a reservation, or replaying a migration.
