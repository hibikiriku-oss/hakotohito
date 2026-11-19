# Phase 2 batch audit — v30 candidate

Date: 2026-11-18 (JST)  
Baseline: v29 batch remediation candidate ZIP  
Scope: active-account visibility across public discovery/detail/favorites endpoints, response minimization for embedded owner joins, personalized GET cache policy, and remaining release blockers.  
Constraint: Tokyo read-only preflight SQL was not run because the user has no environment available. No SQL migration was added or executed.

## Candidate corrections included

1. **Performer detail and performer review endpoints** now inner-join the owning `users` row and filter `users.account_status='active'`. Retained profile rows for withdrawn users no longer resolve through these public detail routes.
2. **Facility detail endpoint** now inner-joins the owning user and filters active account status. The internal join is not copied into the explicit response payload.
3. **Performance request list and detail endpoints** require the related facility owner to be active. The join-only `users.id` field is stripped before returning embedded facility data. The list's personalized response (venue address and application state) now has explicit `Cache-Control: no-store`.
4. **Map search** requires active facility owners for performance requests and active performer owners for lesson offers. Internal join data is stripped from embedded entities. The personalized map response now has explicit no-store headers.
5. **Lesson offer list and detail endpoints** require an active performer owner, strip the internal owner join from the embedded performer object, and return no-store responses because `is_mine` is viewer-dependent.
6. **Favorites** now omits favorites whose target user is no longer active, rejects new favorites for inactive targets, and marks the personalized GET response no-store. DELETE remains able to remove an old favorite even if its target has withdrawn.

No business rows, reviews, favorites, or transaction evidence are deleted. The changes affect discovery/visibility only. Historical records remain intact.

## Batch audit register (28 checks)

| # | Priority | Check / finding | Status |
|---:|---|---|---|
| 1 | P1 | Performer detail previously loaded a retained profile without checking the profile owner's account status | Corrected with active owner inner join |
| 2 | P1 | Performer review detail previously resolved reviews for a retained withdrawn performer profile | Corrected with active owner inner join |
| 3 | P1 | Facility detail previously loaded a retained facility profile without checking owner status | Corrected with active owner inner join |
| 4 | P1 | Performance request discovery could return open requests belonging to a withdrawn facility | Corrected with active facility owner join |
| 5 | P1 | Performance request detail could expose a request from a retained withdrawn facility | Corrected with active facility owner join |
| 6 | P1 | Map performance search did not require an active facility owner | Corrected |
| 7 | P1 | Map lesson search did not require an active performer owner | Corrected |
| 8 | P1 | Lesson offer list could expose an open offer from a retained withdrawn performer | Corrected with active performer join |
| 9 | P1 | Lesson offer detail could resolve a retained withdrawn performer's offer | Corrected with active performer join |
| 10 | P2 | Favorites GET could still include a withdrawn target user/profile | Corrected by active target filter and row omission |
| 11 | P2 | Favorites POST could create a new favorite for a withdrawn target profile | Corrected with active owner join |
| 12 | P2 | Favorites DELETE must remain available for stale inactive-target favorites | Preserved intentionally |
| 13 | P2 | Map search response includes viewer-specific application state | Explicit no-store added |
| 14 | P2 | Performance request list includes viewer-dependent venue/application fields | Explicit no-store added |
| 15 | P2 | Lesson offer list includes viewer-dependent `is_mine` | Explicit no-store added |
| 16 | P2 | Lesson offer detail includes viewer-dependent `is_mine` | Explicit no-store added |
| 17 | P2 | Favorites GET is user-specific | Explicit no-store added |
| 18 | P2 | Embedded active-owner join fields could expose internal user UUIDs | Stripped from map/list/detail response objects where newly selected |
| 19 | P2 | Existing performer directory active filter remains intact after v29 | Confirmed; no regression in candidate source |
| 20 | P2 | Existing facility-profile private GET/POST/PATCH no-store helper remains intact | Confirmed |
| 21 | P1 | Profile/avatar registration and update still use multiple PostgREST writes | Unresolved; requires single transaction RPC |
| 22 | P1 | migration 006 dual-role withdrawal and migration 013 current refund/attempt lifecycle remain divergent | Unresolved; do not restore 006 wholesale |
| 23 | P1 | Ordinary application rejection notifications remain incomplete for withdrawal/cancellation/expiry | Unresolved; recipient/message/event-key policy required |
| 24 | P1 | Pending lesson application rejection still lacks status-transition Outbox event | Unresolved |
| 25 | P2 | Pending band invitation cancellation and leader-driven band disband notifications remain incomplete | Unresolved |
| 26 | P2 | Outbox worker remains capped at five sends per drain; daily cron can delay backlog | Operational decision required |
| 27 | P2 | LINE push accepted before timeout/lease ambiguity can be delivered at-least-once | Document operational duplicate risk; no exactly-once claim |
| 28 | P1 | Post-reset Tokyo schema/catalog/business-row state remains unverified | Not run per user instruction; do not use stale pre-reset data |

## Query and response notes

- Active owner filters use existing `users` relationships already used by the application and PostgREST embedded-resource filtering. The exact nested relationship path and generated schema must still be confirmed against the intended Tokyo project when read-only access becomes available.
- Newly selected owner join IDs are removed from public response objects. The explicit facility detail response continues to return only its established public fields.
- `favorites` DELETE intentionally does not require an active target so users can clean up stale saved entries after a target account withdraws.
- The map search endpoint remains performer-authenticated. The request listing's anonymous behavior remains unchanged: anonymous users do not receive facility profile data or venue address.
- This batch does not change withdrawal, refund, application fee, lesson fee, or band accounting behavior.

## Deferred work

1. Integrate dual-role withdrawal while preserving migration 013's global gate, `application_attempts` closure, cancellation/refund behavior, and notification wrapper contract.
2. Consolidate performer/facility profile and avatar writes into a single transaction RPC after exact target schema/unique constraints/role policy are known.
3. Complete ordinary application, lesson application, band invitation, and band disband notification lifecycle using the existing Outbox with explicit recipient, message, idempotency key, and actor suppression rules.
4. Decide operationally acceptable Outbox backlog latency, retry inspection, and manual recovery process.
5. Run read-only Tokyo preflight when the user has an appropriate environment; then validate migrations in disposable PostgreSQL and perform controlled LINE-device checks.

## Verification boundaries

- Baseline was the v29 candidate ZIP; no pre-reset business-row export was treated as current evidence.
- Source changes are limited to API visibility/cache handling and response minimization; no SQL migration was added.
- No live DB query, SQL execution, PostgreSQL test, build, lint, test, typecheck, or local checks were performed.
- No Supabase, GitHub, or Vercel changes were made.
- Stripe coin purchase remains disabled for limited release; lesson functionality remains enabled.
- Release remains **BLOCKED** until P1 items and required validation are complete.
