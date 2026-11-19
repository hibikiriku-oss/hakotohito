# Phase 2 v30 candidate package manifest

- Baseline: `Hakotohito_20261118_limited_release_phase2_batch_remediation_candidate_v29.zip`
- Date: 2026-11-18 JST
- Scope: active-owner visibility and private GET cache policy across performer/facility/request/map/lesson/favorites APIs.
- Source changes: 9 API route files (performer detail, performer reviews, facility detail, performance request list/detail, map search, lesson offer list/detail, favorites).
- SQL migrations added: 0
- Read-only SQL executed: 0 (user currently has no environment available)
- Build/lint/test/typecheck/local checks: not run, per instruction
- Supabase/GitHub/Vercel: unchanged
- Required validation still pending: PostgREST nested relationship paths, disposable PostgreSQL integration, Tokyo read-only preflight, controlled LINE verification.
- Release status: BLOCKED

Detailed audit: `docs/20261118_PHASE2_BATCH_AUDIT_V30.md`.
