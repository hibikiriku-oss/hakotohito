# Phase 2 batch audit — v28 candidate

Date: 2026-11-18 (JST)  
Baseline: v27 batch remediation candidate ZIP  
Scope: static cross-review of active-account API/RPC guards, dual-role withdrawal, notification lifecycle, Outbox worker behavior, performer discovery privacy, profile write atomicity, and SECURITY DEFINER lock ordering.

## Candidate correction included

1. **Withdrawn performer discovery filtering** — `GET /api/performers` now uses an inner relation to `users`, selects `account_status`, and filters the related user to `active`. The authenticated viewer check from v27 remains. This prevents retained/anonymized performer rows from appearing as blank or anonymous entries in public performer discovery. It does not delete historical performer/profile rows or alter review/match evidence.

No new SQL migration was added in this batch. The remaining database-side issues depend on the current Tokyo schema, dual-role semantics, notification recipient policy, or transaction contract; adding speculative replacement functions would risk overwriting current business logic.

## Batch findings and verification record

| # | Priority | Finding / check | Evidence and consequence | Status |
|---|---|---|---|---|
| 1 | P1 | Withdrawn performer profiles could remain in discovery | v27 added active viewer authentication but the performer list joined `users` without filtering target account status. | Corrected: inner join + active target filter. |
| 2 | P1 | API active checks remain defense-in-depth | API lookup and later DML are separate requests; only DB gate/row guards close stale-token races. | Confirmed; do not treat API filters as final concurrency control. |
| 3 | P1 | Individual application RPC active check is serialized with withdrawal | v27 migration 013 acquires shared global gate before reading `users.account_status`. | Static ordering confirmed. |
| 4 | P1 | Band application RPC validates only submitting leader account status | Member target-level checks do not independently join every active membership to an active user. Normal withdrawal removes membership, but stale/legacy membership rows need DB preflight. | Unresolved; inspect current membership data before changing behavior. |
| 5 | P1 | Band creation RPC checks creator account after global gate | migration 012 verifies performer ownership and active user. | Static check confirmed. |
| 6 | P1 | Direct invitation RPC checks both actor and target active status | migration 012 checks facility actor and performer target after global gate, before request lock/insert/charge. | Static check confirmed. |
| 7 | P1 | Dual-role withdrawal regression remains | migration 006 handles both existing profiles; migration 013 later replaces the withdrawal function and branches on primary `user_type`. | Unresolved; merge must preserve current refund/cancellation behavior and migration 011 trigger ordering. |
| 8 | P1 | Secondary-role creation boundary remains ambiguous | performer POST can create a performer profile for an active facility-primary account unless role/admin semantics are enforced elsewhere. | Unresolved; align with admin-only dual-role policy before patch. |
| 9 | P1 | Profile/avatar multi-statement writes can partially persist | performer/facility APIs still perform profile and avatar/user updates in separate DML statements. | Unresolved; transactional RPC requires exact validation and response-contract inventory. |
| 10 | P1 | Withdrawal wrapper does not enqueue ordinary application rejection notices | migration 013 changes pending applications to rejected; migration 021 wrapper consumes match/direct-invite notification arrays only. | Confirmed gap; recipient and message policy needed. |
| 11 | P1 | Withdrawal lesson rejection has no matching Outbox event | migration 011 updates `lesson_applications.status`; migration 016 only covers INSERT and lesson-offer UPDATE. | Confirmed gap. |
| 12 | P2 | Withdrawal cancels pending band invitations without notices | migration 022 UPDATE trigger only handles pending→accepted/rejected. | Confirmed gap; cancelled actor/counterparty semantics need explicit design. |
| 13 | P2 | Leader withdrawal disbands bands without member notices | withdrawal function marks bands disbanded and members left; no corresponding disband event enqueue is present. | Confirmed gap. |
| 14 | P2 | Event cancellation rejects ordinary applications without counterpart notice | migration 020 wrapper handles event cancellation/match/direct-invite paths, not every ordinary pending application recipient. | Confirmed gap. |
| 15 | P2 | Application expiry silently changes application state | migration 010 expiry function changes attempt/application states; migration 015 trigger is AFTER INSERT on attempts, not status UPDATE. | Confirmed gap; decide whether expiry notice is required for limited release. |
| 16 | P2 | Application notification trigger covers new attempts | migration 015 fires on `application_attempts` INSERT and checks application remains pending. | Static behavior confirmed. |
| 17 | P2 | Reapplication notification can be generated by a new attempt | existing application row may be reused, but a new attempt row is inserted. | Static behavior confirmed; duplicate key is attempt-scoped. |
| 18 | P2 | Lesson application notification only covers INSERT | migration 016 has no status-transition trigger for pending→rejected/cancelled. | Confirmed gap. |
| 19 | P2 | Lesson offer update comparison omits address | migration 016 compares title/details/area/date/time/fee/capacity/levels, not address. | Currently dormant because address editing is unavailable; keep coupled to future address edit. |
| 20 | P2 | Lesson offer address remains non-editable | edit API/RPC signatures omit address although create/detail can carry it. | Product decision remains open. |
| 21 | P2 | Outbox claim batch is hard-capped at five | migration 004 rejects limits above five and helper clamps to five. | Confirmed; backlog may require repeated drains. |
| 22 | P2 | Scheduled Outbox drain is daily | `vercel.json` schedules `/api/cron/line-notification-outbox` once daily; event routes also attempt immediate drains. | Confirmed; acceptable latency is an operations decision. |
| 23 | P2 | Immediate route drains are not a complete backlog service | helper claims at most five and makes one drain pass per call. | Confirmed; no loop-until-empty worker. |
| 24 | P2 | LINE delivery is at-least-once | provider success followed by lost response/lease expiry can cause a retry; DB lease fencing cannot retract a sent push. | Inherent external-side-effect ambiguity; document/monitor. |
| 25 | P2 | No Outbox operations UI found | source has worker endpoint/helper but no administrative queue inspection/retry screen. | Confirmed; decide whether DB-only operations suffice. |
| 26 | P1 | Outbox recipient binding is account-stable | migration 004 resolves recipient LINE ID to exactly one active user and stores `recipient_user_id`. | Static check confirmed. |
| 27 | P1 | Outbox identity/payload immutability is enforced | migration 004 rejects updates to event key, recipient, messages, and creation identity. | Static check confirmed. |
| 28 | P1 | Worker acknowledgements are lease-fenced | complete/retry require row ID and lease token; stale worker cannot update a reclaimed row. | Static check confirmed. |
| 29 | P2 | Legacy unbound pending Outbox rows are dead-lettered | migration 004 marks unsent legacy rows failed rather than risk delivery to a re-registered LINE identity. | Safe-by-design but requires operator review of failed backlog. |
| 30 | P1 | Global mutation gate precedes explicit row/advisory locks in migration 009 RPC inventory | Static parser reviewed 32 SECURITY DEFINER function blocks; each explicit gate occurrence precedes the first explicit `FOR UPDATE`/`FOR SHARE` or non-global advisory lock found. | Static ordering confirmed; does not prove nested-call or trigger lock order. |
| 31 | P1 | Nested RPC calls can reacquire the transaction gate | PostgreSQL transaction advisory locks are re-entrant for the same transaction; nested functions can call gated helpers without waiting on themselves. | Expected behavior; still review nested row-lock order. |
| 32 | P1 | Migration 012/013 do not change RPC signatures | `CREATE OR REPLACE FUNCTION` preserves declared signatures/return shapes in candidate source. | Static source check only; target catalog ACL/return type preflight still required. |
| 33 | P1 | Migration 012/013 remain unexecuted | no PostgreSQL parser/runtime validation has been performed. | BLOCKER before application. |
| 34 | P1 | Migration 010 does not generically guard band membership tables | bands/invitations/members/messages/transfers are outside the listed row-trigger scope. | Requires RPC-by-RPC and stale-row preflight. |
| 35 | P1 | Active account API scan does not prove every DB writer is safe | service-role and SECURITY DEFINER write paths can bypass API lookup filters. | Continue DB RPC inventory. |
| 36 | P2 | Performer discovery filter does not delete retained historical data | filter only hides rows whose owning user is not active. | Corrected at read boundary; historical retention unchanged. |
| 37 | P2 | Facility directory/profile privacy differs from performer discovery | facility detail response intentionally omits registered address; request venue address is separately public. | Existing policy preserved; recheck all public selectors before release. |
| 38 | P1 | Current Tokyo trigger/catalog state is unknown | source migrations cannot prove target trigger enabled state, trigger ordering, applied migration history, or grants. | Requires read-only target preflight. |
| 39 | P1 | Current post-reset operational rows are unavailable in candidate source | no fresh post-reset business-row snapshot is included. | Do not infer current queue/application/membership state from old snapshots. |
| 40 | P1 | Profile RPC design cannot be safely finalized from source alone | unique constraints, exact column types, dual-role behavior, and client response expectations must be read-only verified. | Keep as blocker rather than generate guessed SQL. |

## Verification boundaries

- v27 candidate ZIP was the baseline; no pre-reset business-row dumps were used as current evidence.
- `GET /api/performers` was changed only to exclude target performer rows whose owning user is not active. Root and nested source copies are synchronized.
- The migration 009 scan was static and limited to explicit lock statements in function bodies; trigger execution order and nested row-lock paths still require database validation.
- No PostgreSQL execution, live DB query, build, lint, test, typecheck, or local checks were performed.
- No Supabase, GitHub, or Vercel changes were made.
- Release remains **BLOCKED** pending dual-role lifecycle integration, profile transaction consolidation, notification policy/coverage, target DB preflight, SQL validation, and controlled LINE verification.
