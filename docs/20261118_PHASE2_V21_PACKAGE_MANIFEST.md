# v21 package manifest

Baseline: v20 candidate.

Changes:
- Migration 007 `get_band_chat_messages_atomic` now takes a shared global advisory lock and a `FOR SHARE` band lock because it is read-only; independent readers no longer serialize behind the exclusive mutation gate.
- Added migration 010 with active-account row guards for performer/facility profiles, performance requests, lesson offers/applications, inquiries, favorites, and withdrawn-user avatar updates.
- Added a static inventory of direct API DML and account-withdrawal TOCTOU paths. Identified multi-request profile update partial-write risk as P2.
- Added a read-only preflight for target columns, gate/guard trigger inventory, function security metadata, and aggregate inactive-owner indicators.
- Updated PUBLIC_RELEASE_CHECKLIST.md. Root project and nested `music-matching/` project copies are synchronized.

No PostgreSQL execution, live SQL, build, lint, test, typecheck, local checks, Git operation, GitHub push, or Vercel deploy was performed. Release remains BLOCKED.
