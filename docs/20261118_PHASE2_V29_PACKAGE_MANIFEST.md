# v29 candidate package manifest

- Baseline: v28 batch remediation candidate
- Candidate: 2026-11-18 Phase 2 batch remediation v29
- Source correction: remove nested `users.account_status` from public performer directory response; retain active-user inner join/filter.
- Audit: `docs/20261118_PHASE2_BATCH_AUDIT_V29.md`
- Read-only DB preflight: `docs/20261118_PHASE2_V29_READONLY_TOKYO_PREFLIGHT.sql`
- Root and `music-matching/` copies are synchronized.
- No SQL migration added or executed.
- No live Supabase, GitHub, or Vercel changes.
- No build, lint, test, typecheck, or local checks performed.
- Release status: BLOCKED.
