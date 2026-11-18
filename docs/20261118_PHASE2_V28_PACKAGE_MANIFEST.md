# Phase 2 v28 package manifest

- Baseline: v27 batch remediation candidate.
- Scope: 40-item static audit; one safe read-boundary correction.
- Source correction: `src/app/api/performers/route.ts` now filters related `users.account_status = 'active'` using an inner relation.
- No SQL migration added.
- Root and nested copies synchronized for all changed source and documentation files.
- No database execution, live DB read, build, lint, test, typecheck, or local checks.
- No Supabase, GitHub, or Vercel changes.
- Release remains BLOCKED.
- Detailed findings: `docs/20261118_PHASE2_BATCH_AUDIT_V28.md`.

## Archive verification

- Archive: `Hakotohito_20261118_limited_release_phase2_batch_remediation_candidate_v28.zip`
- File entries: 544 (840 ZIP entries including directory records)
- `zipfile.testzip()`: no errors
- SHA-256: `30286708d552465b6b956c411b3e3263172690b7ac3df7042b1b0ec13248b071`
