# Phase 2 v26 batch remediation candidate manifest

Baseline: `Hakotohito_20261118_limited_release_phase2_batch_remediation_candidate_v25.zip`.

Included candidate changes:
- `src/app/api/performers/profile/route.ts`: apply explicit no-store headers to every private GET/PATCH response.
- `src/app/api/facilities/route.ts`: apply explicit no-store headers to every private GET/POST/PATCH response.
- `src/app/api/lesson-offers/[id]/route.ts`: include the existing `address` field in the detail response, matching list/create APIs and the detail UI.
- `docs/20261118_PHASE2_BATCH_AUDIT_V26.md`: 30-item cross-review of role boundaries, withdrawal, notifications, Outbox, mutation gates, cache policy, and lesson address flow.
- `PUBLIC_RELEASE_CHECKLIST.md`: v26 progress and unresolved blockers.

Validation:
- Static source inspection only; no build, lint, test, typecheck, or local checks.
- No PostgreSQL execution or live database query.
- No Git operation, Supabase mutation, GitHub push, or Vercel deployment.
- ZIP integrity, root/nested mirror equality, and SHA-256 are checked during package assembly.

Release remains **BLOCKED**. This package is not approved for production application until P1 remediation, Tokyo read-only preflight, SQL validation, and controlled LINE verification are complete.
