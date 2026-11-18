# Phase 2 v37 package manifest

- Baseline: v36 candidate ZIP.
- Scope: 20-point source-only cross-audit of withdrawal, notifications, Outbox operations, band transfer replay, profile/avatar writes, and multi-query reads.
- New SQL migrations: none. No runtime source code changes were made because the highest-risk fixes require actor-aware transactional semantics, dual-role lifecycle reconciliation, or target-schema confirmation.
- Main P1 finding: later `withdraw_user_account` replacement in migration 013 regresses the dual-profile discovery/cleanup behavior explicitly implemented in migration 006; lesson cleanup migration 011 is also primary-role gated.
- Notification gaps: lesson application rejection, ordinary application rejection, band invitation cancellation, band disband/member departure.
- Outbox operations: daily cron and five-row drain limit; expiry cron daily with max 5,000 rows per run.
- Profile/avatar writes remain split across REST transactions; atomic RPC deferred pending schema/unique-key confirmation.
- Band transfer replay returns historical success before current membership/account checks, without a second debit; semantics require decision.
- Audit report: `docs/20261118_PHASE2_BATCH_AUDIT_V37.md` (root and nested copies synchronized).
- No SQL executed; no build/test/lint/typecheck/local checks.
- No Supabase/GitHub/Vercel changes.
- Release status: BLOCKED.
