# Phase 2 v25 batch remediation candidate manifest

Baseline: `Hakotohito_20261118_limited_release_phase2_privacy_acl_candidate_v24.zip`.

Included candidate changes:
- `supabase/migrations/20261118_003_lock_down_security_definer_rpc_acl.sql`: allowlist continuity for the later trigger-only Outbox immutable-identity guard.
- `supabase/migrations/20261118_004_harden_line_notification_outbox.sql`: revoke direct `service_role` table access; protect immutable Outbox event identity/payload; strengthen lease-state and privilege postflight checks.
- `supabase/migrations/20261118_011_close_pending_lesson_applications_on_withdrawal.sql`: inspect domain base types and domain CHECK constraints before allowing `rejected` status writes.
- `docs/20261118_PHASE2_BATCH_AUDIT_V25.md`: 22-item static audit with priorities, evidence, and unresolved follow-up decisions.
- `PUBLIC_RELEASE_CHECKLIST.md`: v25 progress and remaining release blockers.

Validation:
- Static source review only.
- ZIP integrity, extraction, root/nested mirror equality, and SHA-256 are to be checked when the candidate archive is assembled.
- No PostgreSQL execution, live DB query, build, lint, test, typecheck, local checks, Git operation, GitHub push, or Vercel deployment.

Release remains **BLOCKED**. This package is not approved for production application until Tokyo read-only preflight, SQL validation, P1 remediation, and controlled LINE verification are complete.
