# v24 package manifest

Baseline: v23 candidate.

Changes:
- Hardened migration 011 preflight: if a CHECK constraint references `lesson_applications.status` but does not visibly allow `rejected`, migration aborts before installing the withdrawal cleanup trigger.
- Documented that lesson application status cleanup does not currently establish a dedicated outbox notification for counterparties; this remains a release review item.
- Kept root and nested `music-matching/` copies synchronized for changed migration and audit documentation.

Verification: ZIP integrity and source-copy equality only. No PostgreSQL execution, live SQL, build, lint, test, typecheck, local checks, Git operation, GitHub push, or Vercel deploy. Release remains BLOCKED.
