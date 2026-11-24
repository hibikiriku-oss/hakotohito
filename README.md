# Hakotohito V48 integrated candidate

**Status: NOT APPROVED FOR PRODUCTION APPLICATION.**

This ZIP is a full project candidate based on the V47.1 source with V48 changes through 2026-11-22. It is not an `src/`-only overlay. It contains application source, historical and candidate Supabase migrations, rollback candidates, read-only SQL, operational documentation, and project configuration.

## Important handling rules

- Do not apply every migration in this archive. Historical migrations may already be present in the live database; reconcile the live database first.
- Do not apply V48 migrations 001–005 or deploy this source to production until the release blockers are closed and the live Supabase state is reconciled.
- V48.004 event/rental per-match fees and facility reward fees, and V48.005 lesson fees, are not yet connected to all cancellation/refund lifecycles. Other business-policy and live-DB preflight items remain open.
- Follow `docs/20261122_V48_ROLLOUT_RUNBOOK.md` and `docs/20261122_V48_DEPLOYMENT_GATE.md`. The current release decision is **BLOCKED**.

## Project commands

The package is a Next.js application. The user has explicitly requested that local build, lint, test, typecheck, and other local checks not be run during this workflow. No such checks have been performed for this candidate.

No production SQL, GitHub push, or Vercel deployment is performed without explicit authorization.

## 2026-11-24 production integration status

This integrated candidate includes the V48 V12 source tree and the user's local 10-file patch after a three-way comparison against Production baseline `1258308fbb7aaaca8d140e061032c36fb139464d`. The performer-home profile-existence guard from V48 is retained.

**Production release remains BLOCKED. Do not apply the included V48 migrations or deploy this source as-is.** The live production DB evidence and unresolved source-linked refund / fee lifecycle work are documented in `docs/20261124_PRODUCTION_DB_EVIDENCE_AND_PACKAGE_STATUS.md` and `docs/20261122_V48_DEPLOYMENT_GATE.md`. Stripe coin purchases remain disabled. No production DB mutation, GitHub push, Vercel deployment, or local build/lint/test/typecheck was performed for this package.


## V48 final remediation package (2026-11-24)
See `INTEGRATED_PACKAGE_README_20261124.md` and `docs/20261124_V48_FINAL_PACKAGE_NOTES.md` for the source-linked refund, fee lifecycle, withdrawal, and band leadership changes. Apply Supabase migrations in order only after checking the production migration ledger and taking a backup.
