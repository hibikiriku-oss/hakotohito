# Phase 2 batch audit — v27 candidate

Date: 2026-11-18 (JST)  
Baseline: v26 batch remediation candidate ZIP  
Scope: static cross-review of LINE-authenticated API user resolution, active-account lifecycle, SECURITY DEFINER application/band RPCs, withdrawal races, and previously open P1/P2 release items.

## Candidate corrections included

1. **Active-account checks across LINE-authenticated APIs** — 37 route files were updated so every non-admin `users.line_user_id` lookup in the inspected API tree also requires `account_status = 'active'`. The covered routes include applications, bands, band invitations/messages/transfers, lesson offers/applications, facility requests/applications/invitations/matches/disputes/completion, performer invitations/matches/disputes/completion, match chat, reviews, coin balance/history, inquiry history/submission, map-search personalization, performance-request ownership/application status/create, Stripe checkout status, and performer directory access.
2. **Performer directory viewer check** — `GET /api/performers` now requires an active registered user after LINE token verification. This does not yet filter withdrawn performer rows out of the directory; that remains a product/data policy item.
3. **Band creation RPC active-account fence** — new candidate migration 012 replaces `create_band_with_leader` with a post-global-gate check that the supplied performer belongs to an active user before creating an active leader membership.
4. **Facility direct-invitation RPC active-account fence** — migration 012 also checks, after the global gate, that both the facility actor and target performer are active before creating an invitation or charging the direct-invite fee.
5. **Individual and band application RPC active-account fence** — new candidate migration 013 checks `p_user_id` is active after the global gate in both `apply_to_performance_request` and `apply_to_performance_request_as_band`. This closes the stale-token race that API filters alone cannot close.

The new migrations preserve existing RPC signatures and return shapes. `CREATE OR REPLACE FUNCTION` is used; the candidate does not execute SQL or change a live database. Migration preflight checks require the existing global gate, exact RPC signatures, and `users.account_status`.

## Batch findings and verification record

| # | Priority | Finding / check | Evidence and consequence | Status |
|---|---|---|---|---|
| 1 | P1 | Many LINE-authenticated APIs resolved users without requiring active status | A valid but stale LINE token could still resolve an anonymized/withdrawn user row in several endpoints. | Corrected at API lookup layer across 37 route files. |
| 2 | P1 | Personal application RPC did not re-check active account after global gate | `apply_to_performance_request` relied on caller-side lookup and performer ownership; a withdrawal could win the shared gate before a stale application RPC. | Corrected in candidate migration 013. |
| 3 | P1 | Band application RPC did not re-check active account after global gate | `apply_to_performance_request_as_band` validated band/profile relationships but did not re-read actor `account_status` after acquiring the gate. | Corrected in candidate migration 013. |
| 4 | P1 | Band creation RPC could create a new active band membership for a withdrawn performer | `create_band_with_leader` checked that the performer row existed, not that its owning user remained active. | Corrected in candidate migration 012. |
| 5 | P1 | Direct-invitation RPC could target a withdrawn performer | `create_facility_invitation_with_coins` checked request ownership/open status and performer-row existence but not both account statuses. | Corrected in candidate migration 012; actor and recipient are checked before insert/charge. |
| 6 | P1 | Direct-invitation RPC lacked a post-gate facility actor check | API role/auth lookup was not the final race defense for the SECURITY DEFINER function. | Corrected in candidate migration 012. |
| 7 | P1 | Active-account API checks are not a substitute for database checks | The global mutation gate serializes writes but does not itself revalidate the actor. | Three high-risk RPC gaps above are patched; continue inventorying all SECURITY DEFINER write RPCs. |
| 8 | P1 | Band tables are outside migration 010's generic active-account trigger scope | `bands`, `band_members`, `band_invitations`, band messages, and band transfer records are not among migration 010's guarded relations. | Partially mitigated by active API lookup, existing membership/status checks, and migration 012 band-creation check; full RPC-by-RPC DB audit remains. |
| 9 | P1 | Applications table is outside migration 010's generic active-account trigger scope | Ordinary application writes rely on SECURITY DEFINER RPC logic rather than the generic row guard. | Individual/band submit RPCs patched in migration 013; review remaining application writers and status transitions. |
| 10 | P2 | Inquiry history GET did not require active account | A withdrawn user row could still be resolved for a private inquiry-history query if its LINE subject remained usable. | Corrected with active lookup. |
| 11 | P2 | Inquiry POST did not require active account at API boundary | Database trigger already guarded inserts, but API returned a generic write failure rather than rejecting inactive actor early. | Corrected with active lookup; DB trigger remains final insert guard. |
| 12 | P2 | Lesson-offer owner/detail APIs lacked explicit active user resolution | Stale LINE subjects could reach profile/offer resolution before DB mutation guards. | Corrected with active lookup; migration 010 remains the final write guard for lesson-offer rows. |
| 13 | P2 | Lesson-application APIs lacked consistent active user resolution | Some GET/POST paths resolved user rows without `account_status`. | Corrected with active lookup; migration 010 validates both lesson participants at row-write time. |
| 14 | P2 | Facility request/application/invitation endpoints lacked consistent active user resolution | Read and mutation handlers used LINE identity but omitted active status in user lookup. | Corrected with active lookup; performance-request row guard remains the final mutation defense. |
| 15 | P2 | Facility match/dispute/completion endpoints lacked consistent active user resolution | Several routes looked up the user by LINE ID only. | Corrected with active lookup; completion/dispute RPC state and ownership checks remain in place. |
| 16 | P2 | Performer invitation/match/dispute/completion endpoints lacked consistent active user resolution | Several routes looked up the user by LINE ID only. | Corrected with active lookup; RPC-level state checks still require separate race review. |
| 17 | P2 | Match chat endpoint lacked active user resolution | A valid LINE token could resolve a withdrawn user before chat authorization. | Corrected with active lookup; match participant authorization remains required. |
| 18 | P2 | Reviews endpoint lacked active user resolution | The route helper resolved the user by LINE subject without active status. | Corrected with active lookup. |
| 19 | P2 | Coin balance/history endpoints lacked active user resolution | Private balance/history reads did not explicitly reject withdrawn users at lookup. | Corrected with active lookup; no coin accounting behavior changed. |
| 20 | P2 | Stripe checkout-status endpoint lacked active user resolution | Status lookup could resolve an inactive user before checking payer ownership. | Corrected with active lookup; coin purchases remain disabled for limited release. |
| 21 | P2 | Map-search personalization lookup lacked active user resolution | Withdrawn user could still resolve stored performer area preferences. | Corrected with active lookup; anonymous map search behavior is unchanged. |
| 22 | P2 | Performance-request detail owner helper lacked active status | Owner lookup could resolve a withdrawn facility user. | Corrected with active lookup. |
| 23 | P2 | Performance-request creation and application-status reads had inconsistent active filters | Some reads relied on earlier checks or the DB trigger. | Corrected with explicit active filters. |
| 24 | P2 | Performer directory only checked LINE token validity, not active registration | Withdrawn users could still call the authenticated directory endpoint. | Corrected by requiring an active viewer; withdrawn target profiles are still present pending discovery-policy decision. |
| 25 | P2 | Withdrawn performer profiles remain in performer discovery results | The list query does not filter the joined user's `account_status`; anonymization limits exposure but can leave blank/anonymous entries. | Unresolved product/data policy decision. |
| 26 | P1 | Dual-role withdrawal regression remains | Migration 013's withdrawal function branches on primary `users.user_type`, despite migration 006's dual-profile handling. | Unresolved; requires a merged lifecycle function and exact target-schema preflight. |
| 27 | P1 | Performer profile creation still lacks admin-only secondary-role boundary | `POST /api/performers` can create a performer profile for an active user whose primary role is facility. | Unresolved; do not add a guard until admin-created dual-role semantics are reconciled across both role APIs. |
| 28 | P1 | Profile create/update operations remain multi-statement | Avatar and performer/facility profile changes can partially persist if a later statement fails. | Unresolved; transactional RPC design requires preserving exact validation and response contracts. |
| 29 | P1 | Withdrawal notifications still omit ordinary application counterparties | Withdrawal cleanup rejects ordinary pending applications, but withdrawal Outbox wrapper does not include those recipients. | Unresolved; recipient/message policy required. |
| 30 | P1 | Withdrawal-driven lesson application rejection still lacks counterpart notification | Migration 011 status transition is not covered by migration 016's current INSERT/offer-update notification triggers. | Unresolved; define applicant/teacher notification recipients. |
| 31 | P2 | Pending band invitation cancellation remains silent during withdrawal | Migration 022 response notices cover accepted/rejected, not cancelled. | Unresolved. |
| 32 | P2 | Leader withdrawal disbanding still lacks member notices | Withdrawal disbands leader-owned bands and marks members left without a corresponding disband notice path. | Unresolved. |
| 33 | P2 | Event cancellation ordinary pending applications remain silent | Cancellation cleanup rejects applications, while the current wrapper only handles match/direct-invite paths. | Unresolved. |
| 34 | P2 | Application expiry status changes remain silent | Expiry path updates attempt/application statuses; existing trigger coverage does not emit a status-change notice. | Unresolved; confirm limited-release requirement. |
| 35 | P2 | Outbox worker cap remains five per drain call | Larger caller limits are clamped; high-volume withdrawal/cancellation batches may leave backlog. | Operational decision required. |
| 36 | P2 | Scheduled Outbox drain remains daily | Request-triggered drains help but do not guarantee low-latency delivery for backlog. | Hosting-plan limits and acceptable latency require confirmation. |
| 37 | P2 | LINE push delivery is at-least-once | A successful provider side effect with a lost response can be retried after lease expiry. | Inherent external-side-effect ambiguity; document and monitor. |
| 38 | P2 | No Outbox operations UI found | Pending/failed queue inspection and controlled retry require DB-level operations. | Decide whether DB-only operations are acceptable for limited release. |
| 39 | P2 | Lesson offer address remains non-editable | Edit UI/API/RPC signature still omit address. | Unresolved product decision; detail GET address was corrected in v26. |
| 40 | P2 | Lesson offer address change notification comparison omits address | Migration 016 does not compare address; dormant while address cannot be edited. | Tracked dependency on #39. |
| 41 | P2 | Target DB trigger/catalog state remains unverified | Candidate source cannot prove that Tokyo DB has all expected triggers enabled in the correct order. | Requires read-only preflight after the operational window. |
| 42 | P2 | New migration 012/013 have not been executed or PostgreSQL-validated | Function bodies and signatures were statically assembled from the candidate migrations only. | Candidate only; PostgreSQL syntax/return-shape and target schema validation remain mandatory before application. |

## Verification boundaries

- v26 candidate ZIP was the source baseline; no stale production business-row snapshots were used as current evidence.
- All non-admin `users.line_user_id` lookups in `src/app/api/**/route.ts` were statically scanned after the edits; no remaining lookup without an adjacent `account_status = 'active'` filter was found.
- The source changes and migrations are candidates only. No PostgreSQL execution, live database query, build, lint, test, typecheck, or local checks were performed.
- No Supabase, GitHub, or Vercel changes were made.
- Root and nested `music-matching/` copies are required to match for every changed source/migration/document file.
- Release remains **BLOCKED** pending unresolved P1 role/withdrawal/profile transaction/notification items, read-only Tokyo DB preflight, SQL validation, and controlled LINE verification.
