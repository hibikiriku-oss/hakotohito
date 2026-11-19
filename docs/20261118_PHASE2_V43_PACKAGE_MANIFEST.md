# Phase 2 v43 package manifest

Base: v42 candidate archive.

## Changes
- `src/lib/line-notification-outbox.ts`: support both pre-hardening acknowledgement RPC signatures and post-migration lease-token signatures; a present-but-empty token fails closed rather than using the legacy overload. This is a rollout bridge; after migration 004 returns `lease_token`, only fenced acknowledgements are used.
- `supabase/migrations/20261116_009_global_mutation_gate.sql`: avoid duplicate trigger installation on inherited partition children; partitioned parents install cloned triggers on their partitions.
- `supabase/migrations/20261118_004_harden_line_notification_outbox.sql`: remove blanket failure of all pending/processing Outbox rows. The migration now aborts before schema changes if any such rows exist or duplicate active LINE IDs are found, or the Outbox mutation-gate trigger is missing/disabled/misbound, requiring queue drain/reconciliation and identity cleanup first.
- Add `supabase/migrations/20261118_017_retire_legacy_outbox_acknowledgement_rpcs.sql`, to be applied only after the v43 app is deployed, old instances are drained, and no Outbox row remains processing.
- Add `docs/20261118_PHASE2_V43_OUTBOX_ROLLOUT_RUNBOOK.md` with the required queue-zero, migration, deploy, old-instance-drain, and final-contract sequence. Do not include migration 017 in a bulk push before deployment.
- Require an active viewer account in `/api/performers/[id]` and `/api/performers/[id]/reviews`, matching the active-account gate used by related read APIs.
- Record unresolved P2: admin-created dual-role accounts may be able to self-apply/self-match; policy decision and DB/API guards are still required before using one dual-role account as both sides of a test.
- Correct the Outbox read-only preflight/runtime evidence scripts to avoid querying the nonexistent app-owned `supabase_migrations.schema_migrations`; use live schema markers and manually record each SQL Editor migration in the release checklist. The duplicate LINE-ID check returns counts only, not raw IDs.
- Add `docs/20261118_PHASE2_BATCH_AUDIT_V43.md`, `docs/20261118_PHASE2_V43_RUNTIME_EVIDENCE_CAPTURE.sql` (read-only before/after aggregate snapshot), `docs/20261118_PHASE2_V43_PRODUCTION_ROLLOUT_GUIDE.md`, and update `PUBLIC_RELEASE_CHECKLIST.md` with a manual SQL Editor migration-application ledger. The report records an offline 31/31 hash match between migration 009's required routines and the uploaded 2026-11-17 function export, plus 35/35 existing SECURITY DEFINER signatures covered by migration 003's allowlist and 53/53 required signatures reconciled against the candidate chain, confirmation of request-scoped event/rental initial-fee charge/refund idempotency, and confirmation of completion/application fee timing and paid/free lesson fee reservation; live catalog preflight is still required.

## Deferred
- Outbox throughput/cadence/backlog monitoring and retry/dead-letter operations (target Vercel plan and LINE constraints not verified).
- Bounded auto-completion processing within the 60-second route budget.
- Pagination/aggregation for performer directory, filter options, and match history at scale.
- Target Tokyo database migration-history/catalog preflight and controlled LINE verification.
- Migration 016 target dependency/schema validation.

Archive integrity was checked; 622 entries, 311 root/nested mirrored file pairs, no `.env` or credential/secret files (only `.env.example`). ZIP root is the app root; nested `music-matching/` is a mirror, not an additional project level.

Candidate only. No SQL execution, PostgreSQL validation, live Supabase access, application build, tests, lint, typecheck, application-local checks, deployment, commit, or push. Only static source/document inspection and archive integrity/file-parity checks were performed.
