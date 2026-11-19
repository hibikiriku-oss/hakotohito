# v23 package manifest

Baseline: v22 candidate.

Changes:
- Added migration 011 to close pending lesson applications before an active performer account transitions to withdrawn. The cleanup covers applications submitted by the performer and applications received on the performer's lesson offers. Matched/completed rows are untouched.
- Added migration 011 read-only preflight and schema rollback. Rollback does not restore rejected application rows.
- Added static audit documentation and release checklist entry.
- Root and nested `music-matching/` copies of all changed files are byte-identical.

No PostgreSQL execution, live SQL, build, lint, test, typecheck, local checks, Git operation, GitHub push, or Vercel deploy was performed. Release remains BLOCKED.
