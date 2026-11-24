Hakotohito V48 integrated candidate package

Status: NOT APPROVED FOR PRODUCTION APPLICATION.
Baseline: Hakotohito V47.1 candidate source, integrated with V48 changes through 2026-11-22.

This ZIP is a full project candidate, not an src-only overlay. It contains:
- src/ application source
- supabase/migrations/ historical and V48 candidate migrations
- supabase/rollback/ rollback candidates
- docs/ read-only preflight/postflight SQL, rollout notes, audit and implementation records
- project configuration and package manifests

IMPORTANT
- Do not apply every SQL file in this ZIP. Many migrations are historical and may already be applied in production.
- Do not apply V48 migrations 001-005 or deploy this application source to production until the V48 release blockers are closed and the live Supabase state is reconciled.
- V48.004 event/rental per-match fee and facility reward fee, and V48.005 lesson fee, are not yet connected to all cancellation/refund lifecycles. Other business-policy and live-DB preflight items are also open.
- Follow docs/20261122_V48_ROLLOUT_RUNBOOK.md and docs/20261122_V48_DEPLOYMENT_GATE.md. The current decision is BLOCKED.

User workflow constraints:
- No local build, lint, test, typecheck, or other local checks are performed.
- No production SQL, GitHub push, or Vercel deployment is performed without explicit authorization.

This package is an integration candidate for review and completion. It is not a production deployment artifact yet.
