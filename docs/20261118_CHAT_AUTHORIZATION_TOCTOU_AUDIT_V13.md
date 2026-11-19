# 2026-11-18 Chat Authorization TOCTOU Audit (v13)

## Scope
Static review of the v12 candidate archive. Focus: match chat and band chat authorization-to-write sequences, alongside the previously identified matching-core TOCTOU items. No database connection or execution.

## Finding 1: match chat authorization can become stale before message insertion

**Severity: P2 (post-cancellation write window)**

File: `src/app/api/matches/[id]/chat/route.ts`.

`POST` calls `getAuthorizedMatch()`, which separately verifies the LINE ID token, resolves the current user, reads the match and requires `status = active` and `performance_status <> cancelled`, then checks the facility owner or the individual performer/current band leader. Later, it calls `getOrCreateConversation()` and performs a separate direct INSERT into `messages`.

A cancellation/withdrawal or band leadership change can commit after the authorization reads but before the message INSERT. The message INSERT does not itself re-check match status or current participant/leader authorization in the same transaction. The global mutation gate serializes individual DML transactions, but it does not retain the earlier read predicates across these separate HTTP requests. Thus a request authorized just before cancellation may still append a message after the match has become unavailable for chat. For band matches, leader demotion/removal has the same gap.

This is not an unauthenticated access path: the route verifies LINE identity and checks participant/leader status. The issue is stale authorization across requests. Static review does not establish that it has occurred in production.

### Recommended correction
Move final match-state validation, participant/current-leader validation, conversation resolution/creation, and message INSERT into one SECURITY DEFINER RPC transaction. Acquire the global mutation gate first, then lock rows in a documented consistent order (match, request/facility or band, membership, conversation as applicable). Re-check all authorization predicates inside the transaction immediately before inserting. Restrict EXECUTE to `service_role`, pin `search_path`, and include the routine in the explicit security-definer ACL allowlist/revokes. Keep notification enqueueing transactionally coupled if message notifications are added later.

## Finding 2: band chat membership can become stale before message insertion

**Severity: P2 (post-removal write window)**

File: `src/app/api/bands/[bandId]/messages/route.ts`.

The POST path calls `verifyActiveBandMember()`, which reads the band and requires `status = active`, then separately reads an active `band_members` row. The message is inserted into `band_messages` in a subsequent PostgREST request. A concurrent member removal or band disband between those requests can therefore be followed by a successful message insert from a member who is no longer active, unless an uninspected database-side constraint/trigger independently rejects it. No such authorization trigger was established in the candidate source reviewed here.

### Recommended correction
Use a single RPC transaction for band status/member validation and message insertion. Acquire the global mutation gate before row locks, lock the band then membership row consistently with band disband/member-removal routines, re-check active state, and insert. Apply the same service-role-only ACL and pinned search_path requirements as Finding 1.

## Other reviewed paths

- `getOrCreateConversation()` uses a read-then-insert pattern. Its unique-conflict recovery re-reads by `match_id`, which is a reasonable concurrent-create recovery path provided the deployed unique constraint on `conversations.match_id` exists. The candidate migration set did not provide sufficient schema evidence to independently prove that deployed constraint, so confirm it in the Tokyo DB read-only schema preflight.
- Performance-request update uses a conditional UPDATE scoped by request ID, facility ID, and `status = open`. Application RPCs acquire the global mutation gate and lock the request row before applying. The delete route checks application/match counts before a conditional delete; the final safety still depends on deployed foreign-key delete behavior and transaction ordering. No concrete cascade/data-loss conclusion is made without authoritative schema confirmation. Keep this as a schema-preflight item rather than treating it as a confirmed exploit.
- Existing band-invitation creation P2 from v12 remains open.
- Existing Stripe Webhook incident ordering P1 from v11 remains open.

## Required follow-up

1. Implement atomic match-chat message RPC and band-chat message RPC, or a carefully parameterized shared RPC, with transaction-bound authorization and insert.
2. Add disposable-DB concurrency coverage: match cancellation vs message send; band leader removal vs match-chat send; band member removal/disband vs band-chat send; simultaneous conversation creation.
3. Confirm `conversations.match_id` uniqueness and performance-request/application/match FK delete actions using read-only Tokyo DB schema inspection before finalizing delete safety.
4. Keep production DB, GitHub, and Vercel unchanged until the reviewed candidate is approved and validated.

## Limitations

This is a static source/migration review of the v12 archive. It does not establish deployed DB schema state, runtime behavior, RLS state, or whether candidate migrations have been applied. No SQL, build, lint, test, typecheck, or local checks were run.
