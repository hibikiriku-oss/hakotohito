# 2026-11-18 Matching Core API TOCTOU Audit (v12)

## Scope
Static review of the v11 candidate archive. Focus: direct DML routes, actor identity, and multi-request authorization/write sequences around matching, completion, bands, chat, registration, favorites, and profile APIs. No database connection or execution.

## Finding: band invitation creation has a leader-role TOCTOU window

**Severity: P2 (authorization race; low-frequency concurrent-operation case)**

File: `src/app/api/bands/invitations/route.ts` (POST invitation creation path, approximately lines 385-520).

The route performs separate requests in this order:
1. Read the band and require `status = active`.
2. Read the caller's active `band_members` row.
3. Require `role = leader`.
4. Read target membership and pending invitation state.
5. Insert a pending `band_invitations` row directly.

The insert is not part of the same database transaction as the band/member authorization reads. The global mutation gate serializes individual DML statements, but it does not hold a transaction-wide lock across these separate PostgREST requests. Therefore, if a concurrent operation demotes/removes the caller or disbands the band after step 3 but before step 5, the invitation may still be inserted by a caller who is no longer an active leader (or into a band that is no longer active). The unique-conflict handler protects duplicate pending invitations, not this authorization race.

This is not an unauthenticated direct access: the route verifies the LINE ID token and resolves the performer profile. The defect is the time gap between valid authorization and the write. No evidence in this static review establishes that the race has occurred in production.

### Recommended correction
Move band-active validation, inviter active-membership/leader validation, target membership validation, pending-invitation uniqueness handling, and invitation insert into one SECURITY DEFINER RPC transaction. Acquire the global mutation gate before row locks, lock the band row and inviter membership row in a consistent order, re-check all predicates inside the transaction, and insert only if they still hold. Preserve the existing unique constraint as a final idempotency guard. Restrict EXECUTE to `service_role`, pin `search_path`, set a safe owner, and include the function in the explicit ACL allowlist/revokes. Keep notification enqueueing transactionally coupled to the insert trigger.

## Other reviewed paths

- Performer/facility completion reports use conditional updates (`status=active`, `performance_status=scheduled`, relevant report timestamp `IS NULL`, and no dispute). Both sides then call `complete_match_with_fee`; the final fee/completion decision remains in the database RPC. The report update and completion RPC are separate transactions by design, but the conditional update prevents duplicate first reports, and the completion RPC must re-check current state. No additional concrete bypass was established in this pass.
- Performance request updates/deletes are preceded by verified LINE identity and facility ownership resolution. Deletion additionally inspects linked applications/matches; the full safety of the final delete still depends on database constraints and concurrent writes. Treat transactionally coupling the preconditions and delete as a hardening candidate, not a confirmed exploit from this review.
- Band invitation response delegates the state transition to `respond_to_band_invitation` with the authenticated performer ID; the route's prior context read is for notification context, not authorization.
- User registration handles unique-conflict races by re-reading the active account. Initial coin eligibility remains database-trigger controlled.
- Favorites are scoped to the authenticated user ID. Chat/message writes use the resolved current user ID and match/conversation checks; conversation creation/read-marker updates are separate from message insert and warrant future race/idempotency review, but no specific financial or cross-user write was confirmed here.
- Profile/facility/admin direct updates reviewed in this pass derive actor identity from verified LINE token or `requireAdmin`; no client-supplied user ID authorization bypass was established in the inspected write paths.

## Required follow-up

1. Implement the atomic band invitation creation RPC before treating the invitation authorization race as closed.
2. Add disposable-DB concurrency coverage: leader demotion vs invitation insert; band disband vs invitation insert; two simultaneous invites to the same target.
3. Review request delete/update and chat conversation creation for transaction-bound preconditions/idempotency in a separate pass.
4. Keep production DB, GitHub, and Vercel unchanged until the reviewed candidate is approved and validated.

## Limitations

This is a static source/migration review of the v11 archive. It does not establish deployed DB schema state, runtime behavior, RLS state, or whether the candidate migrations have been applied. No SQL, build, lint, test, typecheck, or local checks were run.
