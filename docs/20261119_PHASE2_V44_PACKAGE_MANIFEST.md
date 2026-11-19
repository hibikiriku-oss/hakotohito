# Phase 2 v44 candidate package manifest — 2026-11-19

Base: `Hakotohito_20261118_limited_release_phase2_batch_remediation_candidate_v43.zip`.

## Included
- Applied the seven Vercel TypeScript build-error corrections from the 2026-11-19 patch archive to both root and nested `music-matching/` source mirrors.
- Added `docs/20261119_FACILITY_SMOKE_TEST_FOLLOWUP.md` with the user's facility-side LINE smoke-test findings, source-level correlation, open policy decisions, and follow-up work.
- Added `docs/20261119_FACILITY_RUNTIME_READONLY_DIAGNOSTICS.sql`, containing SELECT-only checks for the new venue-address column, delete RPC, direct-invitation charge timing, Outbox trigger/backlog, recent direct-invite ledger shape, and limited-release coin-purchase switch.
- Updated both copies of `PUBLIC_RELEASE_CHECKLIST.md` with the 2026-11-19 test observations and the v44 audit status.

## Not performed
- No SQL execution or database changes.
- No build, lint, test, typecheck, or local application checks.
- No Git operations, GitHub push, Vercel deployment, or production changes.
- No conclusion about live Tokyo DB migration state; the new SQL is read-only diagnostic material only.

**Status: unapplied candidate; release remains BLOCKED.**
