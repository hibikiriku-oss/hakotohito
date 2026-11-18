# Phase 2 batch audit — v26 candidate

Date: 2026-11-18 (JST)  
Baseline: v25 batch remediation candidate ZIP  
Scope: static cross-review of API DML, active-account guards, global mutation gate ordering, withdrawal/role lifecycle, LINE Outbox event coverage, profile privacy/cache behavior, and lesson address flow.

## Candidate source corrections included

1. **Private performer profile cache policy** — `src/app/api/performers/profile/route.ts` now routes every GET/PATCH response (success and error) through a response helper that sets `Cache-Control: no-store, no-cache, must-revalidate`.
2. **Private facility profile cache policy** — `src/app/api/facilities/route.ts` now applies the same no-store policy to all GET/POST/PATCH responses, including responses that previously lacked the header. The endpoint returns the facility's registered address, so this avoids relying on framework defaults for private profile payloads.
3. **Lesson detail address response** — `GET /api/lesson-offers/[id]` now selects the existing `lesson_offers.address` column. The detail page already renders `offer.address`, and the lesson list API already returns it; this aligns detail API data with the existing UI and list response. This does not add address editing or change publication rules.

These are candidate source changes only. No SQL was executed and no live environment was changed.

## Batch findings and verification record

| # | Priority | Finding / check | Evidence and consequence | Status |
|---|---|---|---|---|
| 1 | P1 | Performer profile creation lacks role boundary | `POST /api/performers` resolves an active user by LINE subject but does not require `user_type='performer'`; a facility-primary account may create a secondary performer profile outside the admin-only dual-role setup path. | Unresolved; reconcile admin dual-role policy and existing users before adding guard. |
| 2 | P1 | Facility/performer dual-role withdrawal regression | Migration 006 detects both profile rows; migration 013 later replaces the function with a `user_type`-only branch. | Unresolved; merge current fee/refund behavior with dual-profile lifecycle and exact schema preflight. |
| 3 | P1 | Withdrawal lesson cleanup only covers performer-primary users | Migration 011 trigger checks `NEW.user_type='performer'`; a facility-primary dual-role user with a performer profile will not clean pending lesson applications. | Unresolved; depends on dual-role withdrawal decision. |
| 4 | P1 | Profile create/update spans multiple transactions | Performer POST, facility POST and facility PATCH write avatar/profile data in separate REST statements. A later failure can leave partial state. | Unresolved; transactional RPC requires exact schema and response contract. |
| 5 | P1 | Facility withdrawal pending ordinary applications lack notices | Withdrawal function rejects pending ordinary applications, but wrapper notification arrays cover match/direct-invitation cases only. | Unresolved. |
| 6 | P1 | Performer withdrawal pending ordinary applications lack notices | Same gap for facility recipients of performer/band applications rejected by withdrawal. | Unresolved. |
| 7 | P1 | Withdrawal-driven lesson rejection lacks counterpart notice | Migration 011 updates pending lesson applications; migration 016 handles INSERT and lesson-offer UPDATE, not status transition. | Unresolved; define both applicant/teacher recipient rules. |
| 8 | P2 | Pending band invitations cancelled by withdrawal are silent | Migration 022 response trigger only accepts `accepted`/`rejected`; withdrawal cancellation is not included. | Unresolved. |
| 9 | P2 | Band disband/leader withdrawal lacks member notice | Withdrawal disbands active leader bands and updates members, but no corresponding disband Outbox event path was found. | Unresolved. |
| 10 | P2 | Event cancellation rejects ordinary pending applications silently | Migration 013 rejection is not represented in migration 020 wrapper's cancelled-match/direct-invite notification loops. | Unresolved. |
| 11 | P2 | Application expiry lacks status-change notice | Migration 010 expiry RPC changes attempts to expired and applications to rejected; migration 015 trigger only handles attempt INSERT. | Unresolved; decide limited-release notification requirement. |
| 12 | P2 | Outbox worker cap is five regardless of caller request | TypeScript drain helper clamps limits to 5; withdrawal and cancellation callers passing 100/20 do not get those requested batch sizes. | Documented behavior; backlog policy decision required. |
| 13 | P2 | Outbox scheduled drain is daily | `vercel.json` schedules the worker at `5 2 * * *` (11:05 JST); request-triggered drains mitigate but do not guarantee backlog latency. | Operational decision; verify hosting plan limits and acceptable delay. |
| 14 | P2 | Outbox delivery is at-least-once | A LINE push may be accepted while its response is lost; lease expiry/retry can duplicate the external side effect. | Inherent provider ambiguity; document and monitor. |
| 15 | P2 | No Outbox operations UI | No admin view for pending/failed queue rows or controlled retry was found. | Unresolved; decide whether DB-only operations are acceptable for limited release. |
| 16 | P2 | Lesson offer address cannot be edited | Edit UI, API payload, and `update_lesson_offer_with_levels` signature omit address. | Unresolved feature decision; do not invent a new RPC signature without schema/UX approval. |
| 17 | P2 | Lesson offer address was absent from detail GET | Detail UI renders `offer.address`; list/create APIs already include it, but detail API select omitted it. | Corrected in this candidate by selecting `address`. |
| 18 | P2 | Lesson offer update notification comparison omits address | Migration 016 compares other visible offer fields but not address. This is dormant while address is immutable in the edit flow. | Tracked dependency on #16; update together if address editing is approved. |
| 19 | P2 | Performer private profile lacked explicit no-store | GET/PATCH returned private profile data without explicit cache policy. | Corrected in this candidate for all success/error responses. |
| 20 | P2 | Facility profile mutation responses lacked consistent no-store | POST/PATCH can return facility registered address and avatar data; only GET consistently set no-store. | Corrected in this candidate for all GET/POST/PATCH responses. |
| 21 | P2 | Withdrawn performer rows remain in discovery query | `GET /api/performers` does not filter the joined user's `account_status`; anonymized rows may appear as blank/anonymous listings. | Unresolved product decision: hide from discovery or retain anonymous representation. |
| 22 | P2 | Direct API DML still relies on database gate/guards | Static inventory found direct DML in favorites, inquiries, profile, performance request, completion report, registration, admin and Stripe webhook paths. Targeted account guards cover profiles, requests, lesson offers/applications, inquiries and favorites; remaining paths require their own RPC/ownership/state review. | Reviewed; no blanket replacement proposed. Specific residuals tracked in #4 and #26-#28. |
| 23 | P2 | Match completion report writes are direct REST updates | Performer/facility routes use compare-and-set filters (`active`, `scheduled`, null report timestamp, no dispute); matches table gate trigger serializes writes. | Static control present; retain DB trigger/gate and verify on target DB. |
| 24 | P2 | API-level active-account reads are not the final race defense | Several routes resolve user/profile then write separately. Migration 010's row guards are the authoritative stale-request defense for covered tables; target DB must confirm triggers are installed/enabled. | Candidate design present; live trigger inventory pending. |
| 25 | P2 | Outbox identity/ACL hardening remains dependent on migration order | v25 migration 004 revokes direct `service_role` table access and freezes event identity; 003 allowlist continuity and 004 postflight must be applied against the actual 014-created schema in the intended order. | Candidate static review passed; live ACL/catalog preflight and SQL execution pending. |
| 26 | P2 | Global gate order in migration 009 | Static scan of all 32 function bodies found the shared gate before explicit row locks. Older historical definitions in migrations 006/013/014 contain pre-gate lock patterns but are superseded by later definitions (009/013/004); do not apply historical fragments independently. | Static review passed for candidate definition; verify exact live definitions before migration. |
| 27 | P2 | Withdrawal wrapper notification coverage is narrower than lifecycle mutations | Wrapper 021 currently consumes match, pending direct-invite cancellation, and direct-invite refund arrays only; no ordinary application, lesson, band invitation or disband event arrays are consumed. | Unresolved; avoid adding speculative recipient mapping. |
| 28 | P2 | Withdrawal cleanup transaction behavior depends on trigger installation | Migration 011 runs BEFORE `users.account_status` update and updates pending lesson applications while account is still active; failure should abort the enclosing transaction. | Static transaction ordering is coherent; PostgreSQL rollback/concurrency test and target trigger preflight pending. |
| 29 | P3 | `GET /api/lesson-offers/[id]` still requires LINE authentication | Detail route returns 401 without token, matching the authenticated lesson UI and existing release checklist. | No change; intentional access boundary as currently implemented. |
| 30 | P3 | Public performer discovery requires an explicit withdrawn-profile policy | Existing list query includes profile rows without `users!inner` active filtering; anonymization reduces data exposure but does not remove the listing. | Unresolved product decision; no automatic filter added. |

## Important verification boundaries

- v25 candidate archive is the source baseline; stale production business-row snapshots were not used as current evidence.
- No current Tokyo DB catalog, post-reset operational rows, trigger state, Outbox backlog, or live ACL result was queried.
- No PostgreSQL execution, build, lint, test, typecheck, or local checks were performed.
- No Supabase, GitHub, or Vercel changes were made.
- Release remains **BLOCKED** pending P1 role/withdrawal/profile transaction issues, notification policy decisions, target DB read-only preflight, and controlled LINE verification.
