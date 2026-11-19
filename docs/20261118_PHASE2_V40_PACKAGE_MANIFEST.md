# Phase 2 v40 package manifest

Base: v39 candidate archive.

## Changes
- Updated `src/app/api/performers/route.ts` and its nested copy: public performer profile creation now requires the account's primary `user_type` to be `performer`; facility-primary accounts receive HTTP 403 before avatar/profile writes.
- Existing admin-configured dual-role profiles remain intact and can be edited through the existing PATCH route, which requires an existing performer profile.
- Added `docs/20261118_PHASE2_BATCH_AUDIT_V40.md` in root and nested documentation trees.
- Updated `PUBLIC_RELEASE_CHECKLIST.md` history in both trees.
- No new SQL migration. The v39 migration 016 remains candidate-only and unexecuted.

## Supabase evidence
Used the latest supplied data dump (`貼り付けたテキスト（1）(20261113-130305).txt`), corroborating `data.sql`, `schema(2).sql`, and `supabase関数全体.txt`. The facility-primary dual-profile row is treated as an allowed administrator-configured account; its existence alone is not an authorization finding.

Candidate only. No SQL execution, DB changes, build, tests, lint, typecheck, local checks, deployment, commit, or push.
