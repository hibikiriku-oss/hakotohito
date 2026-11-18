# Phase 2 v41 package manifest

Base: v40 candidate archive.

## Changes
- Added `docs/20261118_PHASE2_BATCH_AUDIT_V41.md` and its nested documentation copy.
- Updated `PUBLIC_RELEASE_CHECKLIST.md` in both root and nested trees with the v41 audit findings and remaining gates.
- No application source changes and no new SQL migration in this batch. v40's performer primary-role guard and migration 016 candidate are retained unchanged.

## Newly confirmed follow-up findings
- Ordinary pending application rejection during withdrawal has no actor-aware counterpart Outbox notice; migration 015 only covers expiry transitions.
- Auto-completion query has no explicit pagination and depends on configured PostgREST row cap.
- Outbox worker is capped at five rows per drain; daily cron is also five rows, so a larger withdrawal backlog can remain pending.
- Performer/facility registration writes avatar before profile upsert in separate REST transactions, allowing partial success.

Candidate only. No SQL execution, DB changes, build, tests, lint, typecheck, local checks, deployment, commit, or push.
