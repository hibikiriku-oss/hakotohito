# Phase 2 v38 package manifest

- Baseline: v37 candidate ZIP.
- Scope: 20-point source-only audit of cron authentication, expiry lifecycle, hardened Outbox identity/lease behavior, retry semantics, and worker observability.
- Runtime source changes: `src/lib/line-notification-outbox.ts` and `src/app/api/cron/line-notification-outbox/route.ts` (mirrored under `music-matching/`).
- Fix: claim-RPC errors previously collapsed into zero counters and the cron endpoint always returned HTTP 200 / `success:true`. The helper now exposes additive `claimError`; cron reports HTTP 500 / `success:false` for claim errors or failed lease acknowledgements.
- No SQL migration added.
- Audit report: `docs/20261118_PHASE2_BATCH_AUDIT_V38.md` (root and nested copies synchronized).
- No SQL executed; no build/test/lint/typecheck/local checks.
- No Supabase/GitHub/Vercel changes; no LINE delivery.
- Release status: BLOCKED; v37 P1 dual-role withdrawal and actor-aware notification gaps remain.
