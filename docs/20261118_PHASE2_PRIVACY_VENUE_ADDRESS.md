# 2026-11-18 Phase 2 privacy follow-up — request venue addresses

## Scope and status

Candidate baseline: `Hakotohito_20261118_privacy_security_phase1_followup.zip`.

This is an unapplied source/SQL candidate. No Supabase SQL, database data, build, test, lint, typecheck, local checks, commit, push, or deployment was performed.

## Confirmed privacy gap

The facility profile's registered `facilities.address` was still selected and returned through performer-facing request, invitation, match, facility-detail, and map-related paths. The performer request detail UI also displayed the facility profile address as the venue. The request creation/edit flow had no request-specific venue-address field, despite the intended requirement that a facility can choose a venue address per request and explicitly disclose it.

## Changes in this candidate

- Add nullable `performance_requests.venue_address` (maximum 500 characters) with migration `20261118_002_performance_request_venue_address.sql`.
- Do not backfill existing requests from `facilities.address`. Existing facility registration addresses remain private unless a facility owner explicitly copies the address into an individual request.
- Add an optional venue-address field to performance request creation and editing. The facility owner can explicitly copy their registered address into the field. The form warns that the entered venue address is disclosed to logged-in performers; the profile address is not automatically published.
- Create/update APIs validate and persist `venue_address`.
- Performer-facing request list/detail, direct-invitation detail/list, and match list/detail use the request-specific `venue_address` only.
- Anonymous performance-request list responses mask `venue_address` as well as facility profile data.
- Map search geocodes `venue_address`; if absent, the performer map uses the approximate request area rather than falling back to the facility profile address.
- `GET /api/facilities/[id]` returns public facility profile/review fields without `address` or the internal `user_id`; it computes the current viewer’s favorite state server-side so the performer UI does not need the facility owner UUID.
- Remove client-console logging of the full LINE profile and facility API response. Map geocoding diagnostics no longer log exact addresses, request titles, or internal request IDs. LINE push logging no longer records recipient LINE user IDs or raw LINE response bodies; outbox failure details are reduced to generic error codes and HTTP status/name metadata.
- Normalize candidate migration function definitions to `search_path = pg_catalog, public, pg_temp` (with the global mutation-gate trigger helper using `pg_catalog, pg_temp`). Static inspection found 66 `SECURITY DEFINER` function definitions across the migration files, 49 unique names, and no remaining definition without explicit `pg_temp` after this change.
- Add `20261118_003_lock_down_security_definer_rpc_acl.sql` to set every current `SECURITY DEFINER` function in `public` to `search_path = pg_catalog, public, pg_temp`, revoke `PUBLIC`, `anon`, and `authenticated` execution, then grant execution to `service_role`. This uses an explicit allowlist of 53 exact function signatures (49 candidate signatures plus four existing database signatures) and aborts if an unreviewed `SECURITY DEFINER` function exists in `public`, if `anon`/`authenticated` can create objects in `public`, or if any exact candidate signature is missing/different or is not SECURITY DEFINER. The global mutation-gate trigger helper retains its narrower `pg_catalog, pg_temp` search path and receives no direct `service_role` EXECUTE grant. It matches the source call graph: all application RPC calls are made by server-side routes using the service-role client; trigger functions continue to execute through their installed triggers. `docs/20261118_SECURITY_DEFINER_ACL_VERIFY.sql` provides a read-only post-application check of owner, function settings, effective role privileges, and untrusted schema CREATE privileges. The migration remains unapplied; the live production function list, exact signatures, owners, ACLs, and non-public schema dependencies must still be compared before SQL approval. Any unlisted function intentionally in `public` must be reviewed and explicitly added or excluded before applying.
- Performer request, invitation, match, favorites, and map UI no longer render facility registration addresses. Lesson-offer addresses remain unchanged because they are separately stored on the individual lesson offer.

## Important compatibility note

The new SQL migration must be applied before deploying this source candidate. It is not applied here. Existing requests retain `venue_address = NULL`; they are not automatically assigned a facility address. A facility must edit an existing request and explicitly enter/copy a venue address if it should be disclosed.

- Follow-up static review found participant-facing match responses that included unnecessary internal profile/account UUIDs or entire match rows. The facility match-detail response now omits `users.id`, performer profile IDs, and server-only relationship IDs; the facility match list omits performer profile IDs and nested request IDs; the performer direct-invitation acceptance response returns only the match ID; completion endpoints no longer return full match rows. The facility completion GET remains the source for refreshing the visible match state.
- The favorites API now accepts public performer/facility profile IDs, resolves the backing `users.id` only on the server, and returns `target_performer_id` or `target_facility_id` instead of `target_user_id`. It no longer returns `users.id` or nested `user_id`; performer directory/favorites screens use public profile IDs. The performer request-detail favorite toggle was also updated to send `targetFacilityId` using the facility profile ID; the facility match-list response no longer includes unused `request_id` or nested `facility_id`. The chat API now computes `isMine` server-side and omits `currentUserId`, message `sender_id`, nested `users.id`, and conversation identifiers from participant responses. These API contract changes are reflected in both client screens.

- Add `docs/20261118_READONLY_PRIVACY_ACL_PREFLIGHT.sql` as a read-only production evidence collector for target database identity, schema CREATE privileges, default ACLs, public/storage RLS and policies, Storage bucket exposure, exact SECURITY DEFINER signatures/owners/ACLs, trigger bindings, and role attributes. It has not been executed; its output is required before approving the ACL migration.


- ACL follow-up correction: the supplied 2026-11-17 database export also contains `configured_coin_fee(text, integer)`, `configured_lesson_fee(integer)`, and `set_initial_coin_balance()`, which were omitted from the v5 allowlist. The corrected candidate adds all three; `set_initial_coin_balance()` and all Outbox trigger-only functions are not granted direct `service_role` EXECUTE. See `docs/20261118_PHASE2_ACL_ALLOWLIST_AUDIT.md`.

- Additional v6 corrections: the legacy `cancel_event_request_with_refund(uuid, uuid)` SECURITY DEFINER wrapper is now included in the reviewed ACL allowlist and retains its `service_role` grant for old-deployment compatibility until the old route is drained; trigger-only functions are not granted direct `service_role` EXECUTE. The facility acceptance API no longer selects every request column, and favorites authentication now requires an active account.

- v6 static review also found unresolved transactional-Outbox release blockers: queued rows store only a LINE ID rather than a stable recipient user UUID; the worker does not revalidate the same account at send time; claim/finish operations have no lease token; and duplicate event-key conflicts do not verify recipient/payload equality. See `docs/20261118_PHASE2_OUTBOX_AUDIT_BLOCKERS.md`.

## Remaining security audit items

- Reconfirm the production Storage bucket/policy inventory; the supplied read-only export previously returned no bucket/policy rows, and this source tree contains no Supabase Storage upload/download/public-URL usage.
- Obtain the current production RLS policy and ACL/default-privilege exports; RLS enabled on 31 public tables was confirmed earlier, but the prior policy export was empty and therefore did not establish the exact policy set.
- Complete per-function owner, EXECUTE ACL, and `SECURITY DEFINER` `search_path` review against the current production function export.
- Finish the full API response/authorization review, including internal UUID exposure and participant-only data boundaries.
- Assess LINE ID-token bearer replay/expiry handling and review remaining server/client logs for tokens or personal data.

## Verification

Static source review only. Automated/local checks are intentionally not run per instruction. Supabase migration application, Git commit/push, and Vercel deployment remain on hold.
- Performer match-detail and direct-invitation responses now omit internal performer/request/facility profile UUIDs that the screens do not use. Band match state is represented by `isBandMatch`; band display data excludes its internal row ID.
