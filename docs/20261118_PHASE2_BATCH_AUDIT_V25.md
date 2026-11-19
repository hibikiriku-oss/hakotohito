# Phase 2 batch audit — v25 candidate

Date: 2026-11-18 (JST)  
Baseline: v24 candidate ZIP  
Scope: static review of withdrawal, profile writes, LINE notification Outbox, role boundaries, lesson lifecycle, and related API/RPC paths.

## Candidate corrections included in v25

1. **Outbox table privilege minimization** — migration 014 grants `service_role` direct `SELECT`, `INSERT`, and `UPDATE` on `line_notification_outbox`. The application source uses RPCs and triggers only. Migration 004 now revokes all direct table privileges from `service_role`; its worker/enqueue SECURITY DEFINER RPCs remain the only application access path.
2. **Outbox event identity immutability** — migration 004 now adds a `BEFORE UPDATE` guard preventing changes to `id`, `event_key`, `recipient_line_user_id`, `recipient_user_id`, `messages`, or `created_at`. Delivery/lease fields remain mutable by the fenced worker RPCs.
3. **Outbox lease postflight** — migration 004 now verifies that every `processing` row has both `lease_token` and `locked_at`, while non-processing rows have neither. It also verifies that `service_role` has no direct table privileges.
4. **ACL allowlist continuity** — migration 003 recognizes the new trigger-only Outbox guard function if the ACL migration is ever evaluated against a schema where the later Outbox migration has already been applied, and does not grant it direct `service_role` EXECUTE.
5. **Withdrawal lesson status type preflight** — migration 011 now follows domain base types and inspects domain CHECK constraints, in addition to enum labels and table CHECK constraints, before it installs the `pending` → `rejected` cleanup trigger.

These are candidate-source changes only. No SQL was executed.

## Findings requiring follow-up

| # | Priority | Finding | Evidence / consequence | Status |
|---|---|---|---|---|
| 1 | P1 | Performer profile creation lacks a role boundary | `src/app/api/performers/route.ts` POST resolves an active user by LINE ID but selects only `id`; it does not check whether the account is authorized to create a performer profile. This conflicts with the policy that secondary-role setup is administrator-controlled. | Unresolved; role model must be reconciled with admin-created dual-role accounts before adding a guard. |
| 2 | P1 | Dual-role withdrawal behavior is regressed | Migration 006 contains dual-profile handling, but later migration 013 replaces `withdraw_user_account(text)` with a branch on the single `users.user_type`. A dual-role account can have its secondary profile/related records left behind. | Unresolved; needs a merged withdrawal implementation and schema/data preflight. |
| 3 | P1 | Profile writes are split across independent transactions | Performer POST updates `users.avatar_*` then upserts `performers`; facility POST updates avatar then upserts `facilities`; facility PATCH updates `facilities` then updates avatar. A later failure or interleaving withdrawal can leave partial state. | Unresolved; consolidate each flow into a transactional RPC. |
| 4 | P1 | Facility withdrawal does not notify ordinary pending applicants | `withdraw_user_account` rejects pending `applications`; the withdrawal wrapper only emits match and direct-invitation notices. Ordinary performer/band applicants are not represented in its notification arrays. | Unresolved. |
| 5 | P1 | Performer withdrawal does not notify facilities about ordinary pending applications | The performer branch rejects pending applications, but only pending direct invitations are included in the withdrawal Outbox wrapper's notification handling. | Unresolved. |
| 6 | P1 | Withdrawal-driven lesson application rejection has no counterpart notice | Migration 011 changes pending lesson applications to `rejected`; migration 016 only enqueues on INSERT and lesson-offer UPDATE, not this status transition. Both the teacher and applicant counterpart paths can be affected. | Unresolved; notification recipient rules need explicit implementation. |
| 7 | P2 | Pending band invitations cancelled by withdrawal are silent | Migration 022 sends response notices only for `accepted` and `rejected`; withdrawal changes pending invitations to `cancelled`. | Unresolved. |
| 8 | P2 | Band members receive no disband notice | Withdrawal disbands active leader bands and marks active members as left. No corresponding band-disband Outbox trigger/wrapper was found. | Unresolved. |
| 9 | P2 | Event cancellation silently rejects ordinary pending applications | Migration 013 rejects all remaining pending applications, while migration 020's wrapper handles cancelled matches and pending direct invitations only. | Unresolved. |
| 10 | P2 | Application expiry has no status-change notice | `expire_pending_application_attempts` marks attempts expired and applications rejected; the application Outbox trigger in migration 015 only handles attempt INSERT. | Unresolved; confirm whether expiry notifications are required for limited release. |
| 11 | P2 | Outbox worker limit is always capped at five | `drainLineNotificationOutbox` clamps every caller's requested limit to five, including withdrawal callers passing 100 and other routes passing 20. This is intentional per-request load protection but means those call sites do not drain their requested amount. | Documented; batch/backlog policy remains to be decided. |
| 12 | P2 | Scheduled Outbox drain is only once daily | `vercel.json` schedules `/api/cron/line-notification-outbox` at `5 2 * * *` (11:05 JST). Any backlog beyond request-triggered batches may wait until the next daily run. | Operational risk; confirm hosting-plan cron limits and acceptable delivery latency. |
| 13 | P2 | Outbox delivery is at-least-once, not exactly-once | LINE push may be accepted while the response is lost/times out; the worker then retries after the lease expires and may send a duplicate. The current 10-second request timeout and 2-minute lease reduce, but cannot eliminate, this external side-effect ambiguity. | Inherent provider limitation; document and monitor. |
| 14 | P2 | No Outbox operations screen was found | No admin route/page was found for inspecting pending/failed rows or initiating a controlled retry. Failed rows currently require database-level inspection. | Unresolved; decide if DB-only operations are acceptable for limited release. |
| 15 | P2 | Lesson offer address cannot be edited after creation | The lesson edit page and `PATCH /api/lesson-offers/[id]` do not expose/pass `address`; `update_lesson_offer_with_levels` has no address parameter. A saved venue address is therefore immutable through the current edit flow. | Unresolved feature gap; confirm whether editability is required before release. |
| 16 | P2 | Lesson offer update notification comparison omits address | Migration 016 compares title, description, instruments, genres, area, date/time, fee, capacity, and target levels, but not `address`. This is currently dormant because the update RPC/API cannot change address; it must be addressed if address editing is added. | Tracked dependency on #15. |
| 17 | P2 | Withdrawal status preflight previously missed domain constraints | A status column can be a domain over text or enum. The earlier preflight only checked a direct enum and table CHECK constraints. | Corrected in v25 candidate; still requires target-schema read-only inspection. |
| 18 | P2 | Outbox event identity was mutable after insert | The v24 recipient-binding trigger ran only BEFORE INSERT, while `service_role` retained direct UPDATE privileges. Identity/payload fields could therefore be changed outside the worker RPC contract. | Corrected in v25 candidate by immutable-field trigger and direct table ACL revocation. |
| 19 | P2 | Outbox postflight did not require a lease token on processing rows | The prior check rejected some inconsistent states but did not require `lease_token` and `locked_at` for every `processing` row. | Corrected in v25 candidate. |
| 20 | P2 | Outbox service role retained direct table privileges | Migration 014 granted direct SELECT/INSERT/UPDATE; migration 004 previously left those grants intact even though all source access is through RPCs/triggers. | Corrected in v25 candidate. |
| 21 | P3 | Performer private-profile responses omit explicit no-store headers | `src/app/api/performers/profile/route.ts` GET/PATCH responses do not set `Cache-Control: no-store`, unlike several adjacent authenticated profile routes. Next route behavior is dynamic, but explicit response policy would be clearer. | Unresolved hardening item. |
| 22 | P3 | Withdrawn performer rows are not filtered from the performer list query | `GET /api/performers` queries all performer rows and does not filter the joined `users.account_status`. Withdrawal anonymizes profile fields, so this is primarily a blank/anonymous listing consistency issue rather than exposure of the cleared profile. | Unresolved; decide whether public discovery should exclude withdrawn profiles. |

## Important verification boundaries

- The supplied source archive is the candidate baseline; this audit did not use stale production business-row snapshots as current evidence.
- The target Tokyo database's current catalog, domain constraints, live business rows, trigger bindings, ACLs, and Outbox backlog still require read-only preflight before any SQL application.
- No build, lint, test, typecheck, local checks, PostgreSQL execution, or live database query was performed.
- No Supabase, GitHub, or Vercel changes were made.
- Release remains **BLOCKED** until the P1 items and the operational Outbox decisions are resolved and controlled LINE verification is completed.
