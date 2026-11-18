# Phase 2 v42 package manifest

Base: v41 candidate archive.

## Changes
- Updated `supabase/migrations/20261118_016_integrated_withdrawal_dual_role_lifecycle_notifications.sql` and its nested mirror to capture ordinary pending application recipients before withdrawal cleanup and enqueue actor-aware Outbox notifications.
- Facility withdrawal notices solo applicants and active band members for ordinary applications; direct invitations remain on the fee-aware dedicated path.
- Performer withdrawal notices the facility for pending solo applications and applications of leader-owned bands that are actually disbanded.
- Payloads are combined across both role branches for dual-role accounts; Outbox event keys are stable per application and recipient.
- Added `docs/20261118_PHASE2_BATCH_AUDIT_V42.md` and its nested documentation copy.
- Updated root/nested `PUBLIC_RELEASE_CHECKLIST.md` with v42 progress and remaining gates.

## Deferred
- Auto-completion pagination / bounded claim RPC (must respect 60-second execution budget).
- Outbox cadence, backlog alerting, retry/dead-letter and recovery runbook.
- Atomic profile/avatar write after Tokyo schema/constraint verification.
- Target DB migration-history/catalog preflight and real LINE verification.

Candidate only. No SQL execution, PostgreSQL validation, live DB access, build, tests, lint, typecheck, local checks, deployment, commit, or push.
