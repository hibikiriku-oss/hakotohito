# v22 package manifest

Baseline: v21 candidate.

Changes:
- Added active-account filters to the facility user resolver, performer registration user lookup, and performer profile GET/PATCH user lookups.
- Synchronized the four changed API source copies between the archive root and nested `music-matching/` project.
- Added an audit record explaining why API checks are defense-in-depth and why v21 DB guards remain authoritative for stale-request races.
- Added read-only preflight output for exact column types and active-account/global-gate trigger inventory.
- No SQL migration changed; no new RPC introduced because the uploaded DB evidence does not establish the complete profile table constraints/return contract needed to safely consolidate avatar/profile writes.

No PostgreSQL execution, live SQL, build, lint, test, typecheck, local checks, Git operation, GitHub push, or Vercel deploy was performed. Release remains BLOCKED.
