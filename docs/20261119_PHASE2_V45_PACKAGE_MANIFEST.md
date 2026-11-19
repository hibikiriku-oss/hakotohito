# Phase 2 v45.2 candidate package manifest — 2026-11-19

Base: `Hakotohito_20261119_limited_release_phase2_batch_remediation_candidate_v44(1).zip` (use nested `music-matching/` project as the authoritative source).

## V45.3 safety refinement
- Migration preflight now requires exact MD5 matches for the five production routine definitions inspected by the user and the exact inspected `users_account_status_check` definition. It aborts on any drift.
- Read-only preflight reports expected hashes and whether each live definition matches the inspected baseline.

## Included changes
- Added `20261119_001_lesson_no_holds_and_registration_approval.sql`.
  - Removes lesson-offer virtual holds: creation/edit checks the current balance against remaining capacity but writes `reserved_coins=0`.
  - Lesson application is immediate matching in the existing flow; it rechecks the teacher and applicant active status and atomically charges the configured lesson fee with the matched application.
  - Clears existing virtual `reserved_coins` values.
  - Removes reservation subtraction from `transfer_band_coins` and `spend_coins_legacy`.
  - Adds `approved_at` and `approved_by_user_id` metadata columns.
  - Extends the inspected `users_account_status_check` to allow `pending_approval` while retaining `active` and `withdrawn`. Existing active-only API/RPC guards therefore continue to deny pending accounts without introducing a second status field. The migration stops if an unexpected additional account-status constraint exists.
- Added first-registration approval flow: new users are created as `pending_approval`; `/lobby` displays the waiting state; existing active users are not moved back to pending.
- Added admin-only pending-user list and approval endpoint plus `/admin/approvals` screen and admin-menu link.
- Added pending-state redirects to root registration, performer/facility profile setup and both role home screens.
- Removed `reserved_coins` from lesson API projections and response fields.
- Added V45 read-only preflight and postflight SQL plus database/source application-state ledger.

## Preserved behavior
- Performance application and facility direct invitation remain balance-check-only at submission; their fees remain charged at match establishment.
- Existing notification Outbox behavior and limited-release coin-purchase disablement are unchanged.
- Existing active accounts are unaffected by approval gating.

## Status
- Candidate only. Migration `20261119_001` is not applied.
- No SQL has been executed against Supabase; no Git commit/push or Vercel deployment has been performed.
- No build, lint, test, typecheck, or local checks have been run.
- Before production application, run `docs/20261119_V45_READONLY_PREFLIGHT.sql`, reconcile live routine hashes/ACLs and current DB state, then apply the migration and run `docs/20261119_V45_POSTFLIGHT.sql`.
- Release remains BLOCKED until Supabase and Vercel changes and LINE device verification are complete.
