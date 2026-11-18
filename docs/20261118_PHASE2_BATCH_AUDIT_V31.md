# Phase 2 batch audit — v31 candidate

Date: 2026-11-18 (JST)  
Baseline: v30 batch remediation candidate ZIP  
Scope: authenticated API response cache policy, database error disclosure, dual-role withdrawal lineage, and notification Outbox delivery behavior.  
Constraint: Tokyo read-only preflight SQL was not run because the user does not currently have an execution environment. No SQL migration was added or executed.

## Candidate corrections included

1. Added a shared `privateJson` response helper to authenticated/user-specific routes and applied it to every `NextResponse.json` response in the affected route files. The shared `requireAdmin` helper now also marks its authentication failure responses no-store. The helper forces `Cache-Control: no-store, no-cache, must-revalidate` while preserving the response status and other supplied headers.
2. Applied the helper to the facility-owned request list endpoint. This endpoint returns the facility's own request records and latest match status; it previously had no explicit cache policy on success, errors, or authentication failures.
3. Applied the helper to band applications, band messages, band detail, band transfers, band directory, facility match detail, lesson application lists, performer invitation detail/list, performer match detail/list, and admin dispute listing. These endpoints return user-, membership-, transaction-, or administrator-specific data.
4. Replaced four API responses that returned raw Supabase/PostgREST `error.message` strings with stable Japanese error messages. Detailed errors remain in server-side logs. The affected operations are facility request list retrieval, performance request list retrieval, performance request creation, and performer profile creation.
5. Confirmed the application submission route already uses `getSafeApplicationError`; no change was needed there.

## Batch audit register (33 checks)

| # | Priority | Check / finding | Status |
|---:|---|---|---|
| 1 | P1 | Facility-owned request list contains private request and match state but lacked explicit no-store headers | Corrected |
| 2 | P1 | Band application list is membership-scoped and user-specific | Corrected |
| 3 | P1 | Band chat history is membership-scoped and private | Corrected |
| 4 | P1 | Band detail includes membership/owner-specific state | Corrected |
| 5 | P1 | Band transfer history contains financial activity | Corrected |
| 6 | P2 | Band directory response can contain viewer-specific membership state | Corrected |
| 7 | P1 | Facility match detail contains private transaction/dispute state | Corrected |
| 8 | P1 | Lesson application list contains applicant identity and status | Corrected |
| 9 | P1 | Performer invitation detail contains private invitation state | Corrected |
| 10 | P1 | Performer invitation list is account-specific | Corrected |
| 11 | P1 | Performer match detail contains private match/transaction state | Corrected |
| 12 | P1 | Performer match list contains private match state | Corrected |
| 13 | P1 | Admin dispute list contains sensitive dispute data | Corrected |
| 14 | P1 | Facility request list returned raw database error text | Corrected; generic client error, detailed server log retained |
| 15 | P1 | Performance request list returned raw database error text | Corrected; generic client error, detailed server log retained |
| 16 | P1 | Performance request creation returned raw database error text | Corrected; generic client error, detailed server log retained |
| 17 | P1 | Performer profile creation returned raw database error text | Corrected; generic client error, detailed server log retained |
| 18 | P2 | Application submission error path already sanitizes internal errors | Confirmed; no change |
| 19 | P2 | Remaining `error.message` occurrences in API sources are server logs, controlled error-code matching, or sanitized application error output; no additional raw database message response was found by source search | Static search result |
| 20 | P1 | Current migration 013 withdrawal routine branches on primary `users.user_type` and only loads that role's profile | Confirmed unresolved |
| 21 | P1 | Migration 006 dual-profile withdrawal loads both performer and facility profiles, but migration 013 replaces it and omits that dual-profile behavior | Confirmed unresolved |
| 22 | P1 | Shared `users.account_status` becomes withdrawn, so active-owner filters hide both profiles, but the secondary profile's associated requests/offers/memberships may remain open or active | Confirmed lifecycle risk; not repaired without integrated RPC design |
| 23 | P1 | Migration 011 pending lesson application cleanup is gated by `NEW.user_type='performer'`; a dual-profile account whose primary role is facility can bypass performer-side lesson cleanup | Confirmed unresolved |
| 24 | P1 | Migration 013 matched-lesson block checks both teacher and applicant ownership through `performers.user_id`, but later cleanup still follows only the primary role | Confirmed mixed coverage |
| 25 | P1 | Migration 021 withdrawal wrapper emits Outbox events for cancelled matches and pending direct invitations only | Confirmed |
| 26 | P1 | Ordinary pending applications changed to rejected by withdrawal are not included in the wrapper's notification arrays | Confirmed unresolved |
| 27 | P1 | Pending lesson applications changed to rejected by migration 011 have no status-transition Outbox event | Confirmed unresolved |
| 28 | P2 | Pending band invitations changed to cancelled by withdrawal are not included in migration 021's wrapper output | Confirmed unresolved |
| 29 | P2 | Leader-driven band disband updates membership and pending applications but does not enqueue counterpart/member notices in the withdrawal wrapper | Confirmed unresolved |
| 30 | P2 | Outbox worker clamps every drain to at most five rows, even when withdrawal API passes `100` | Confirmed; API caller argument does not raise actual batch size |
| 31 | P2 | Vercel cron schedule `5 2 * * *` runs once daily at 02:05 UTC (11:05 JST); immediate drains cover selected API paths, but residual backlog can wait for another drain or the daily cron | Confirmed operational risk |
| 32 | P2 | LINE push acceptance followed by timeout/lease ambiguity can lead to duplicate delivery after retry; database lease fencing cannot retract an accepted external push | Confirmed at-least-once behavior |
| 33 | P1 | Exact dual-role rows, current trigger catalog, Outbox backlog, and post-reset operational rows remain unverified because Tokyo read-only preflight was not run | Not run per user instruction |
| 34 | P2 | Shared `requireAdmin` helper returned authentication failure responses without explicit no-store headers | Corrected; all admin-auth failure responses now no-store |

## Important design conclusions

- Do not restore migration 006 wholesale. It predates the current global mutation gate and does not include all later `application_attempts`, deferred-fee, direct-invite refund, and notification-wrapper behavior.
- A safe dual-role withdrawal replacement must load both profiles under the global mutation gate, reject if either role has a protected matched/disputed transaction, cancel/close both role-owned activity sets, process both participant roles, and preserve idempotent refunds and the current wrapper contract. The current source does not yet prove that complete design.
- Do not add a generic `AFTER UPDATE` rejection notification trigger without actor/recipient suppression. Facility withdrawal can reject applications on the withdrawing facility's own requests; a naive trigger could notify the withdrawing account itself or send redundant notifications. Capture counterpart recipients transactionally with explicit role-aware rules.
- The five-row Outbox cap is intentional in the worker implementation to fit the LINE request timeout and Vercel route duration. Increasing it without concurrency/timeout validation is not recommended. The daily cron is a recovery path, not a high-volume queue service.

## Verification boundaries

- Baseline was the v30 candidate ZIP; no pre-reset business-row dump was treated as current evidence.
- Source changes are limited to authenticated response cache policy and generic client-facing errors; no SQL migration was added.
- Static source search found no remaining raw `error.message` database response in API routes; this is not a runtime proof.
- No live DB query, SQL execution, PostgreSQL test, build, lint, test, typecheck, or local checks were performed.
- No Supabase, GitHub, or Vercel changes were made.
- Stripe coin purchase remains disabled for limited release; lesson functionality remains enabled.
- Release remains **BLOCKED** until P1 items and required validation are complete.
