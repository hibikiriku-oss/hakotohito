# Phase 2 v27 batch remediation candidate manifest

Baseline: `Hakotohito_20261118_limited_release_phase2_batch_remediation_candidate_v26.zip`.

Included candidate changes:
- 37 API route files: add `account_status = 'active'` to non-admin LINE subject user resolution; `GET /api/performers` additionally requires an active viewer.
- `supabase/migrations/20261118_012_active_account_rpc_guards.sql`: redefines `create_band_with_leader` and `create_facility_invitation_with_coins` with active-account checks after the shared global mutation gate.
- `supabase/migrations/20261118_013_active_account_application_rpc_guards.sql`: redefines individual and band performance application RPCs with active actor checks after the shared global mutation gate.
- `docs/20261118_PHASE2_BATCH_AUDIT_V27.md`: 42-item static review record, including unresolved blockers.
- `PUBLIC_RELEASE_CHECKLIST.md`: v27 progress and remaining release blockers.

Validation boundaries:
- Static source inspection only. No build, lint, test, typecheck, or local checks.
- No PostgreSQL execution and no live Supabase read/write.
- No Git operation, Supabase mutation, GitHub push, or Vercel deployment.
- Root and nested `music-matching/` copies must match for all changed files.
- ZIP integrity and SHA-256 are checked during package assembly.

Release remains **BLOCKED**. Migration 012/013 require PostgreSQL validation and Tokyo read-only preflight before any application. Dual-role withdrawal, profile transactionality, notification coverage, Outbox operations, and remaining RPC active-account review remain open.
