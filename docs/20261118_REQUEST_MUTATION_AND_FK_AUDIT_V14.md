# Performance Request mutation / FK audit (v14)

Date: 2026-11-18  
Baseline: Phase 2 candidate v13  
Scope: `performance-requests/[id]` PATCH/DELETE, performance request creation, completion report direct updates, favorites writes, and global mutation gate coverage.  
Mode: static source/migration review only; no DB access, SQL execution, build, tests, lint, typecheck, or local checks.

## Findings

### 1. Request DELETE has a multi-request preflight window; FK outcome remains unverified

`src/app/api/performance-requests/[id]/route.ts` DELETE performs:

1. read request and verify facility ownership/status;
2. count `applications`;
3. count `matches`;
4. delete request with `id`, `facility_id`, and `status='open'` predicates.

The final DELETE is a conditional compare-and-set for ownership/status, but it does not make the two history-count checks atomic with deletion. A concurrent application/match creation can occur after the count checks. The source package does not contain the authoritative base-table DDL for the `applications.request_id` and `matches.request_id` foreign keys, so their `ON DELETE` actions cannot be established from this archive. Migration `20261116_010` adds `application_attempts.request_id REFERENCES performance_requests(id) ON DELETE CASCADE`, but that does not establish the behavior of the pre-existing applications/matches foreign keys.

**Assessment:** do not claim data loss or classify this as a confirmed P2 yet. If the pre-existing FKs are restrictive (NO ACTION/RESTRICT), concurrent history insertion should cause the DELETE to fail rather than orphan the history; the API currently may surface a generic 500 instead of a controlled 409. If either FK cascades, deleting a request after a concurrent insert could remove history and would be materially more serious. The actual Tokyo DB schema must be checked read-only before deciding.

**Required preflight:** query `pg_constraint`/`pg_class`/`pg_attribute` for the exact FK definitions and `confdeltype` for `applications.request_id -> performance_requests.id` and `matches.request_id -> performance_requests.id`; also inspect dependent tables and delete triggers. Do not run DELETE tests against production. Use a disposable DB to test insert-vs-delete races.

### 2. PATCH status guard is atomic at the row statement level

The request PATCH updates only where `id`, `facility_id`, and `status='open'` match. This avoids a stale pre-read granting edit rights after a request transitions out of open. Global mutation gate serializes each public-table DML statement, and the status predicate is evaluated by the UPDATE itself. No separate TOCTOU defect was established for this path.

### 3. Completion report direct updates use compare-and-set predicates

Facility and performer completion-report routes update only active/scheduled matches where the corresponding report timestamp is NULL and no dispute timestamp exists. A zero-row result triggers a fresh state read and conflict/idempotency handling. Final completion and fee settlement remain in `complete_match_with_fee`. No new defect established in this scope.

### 4. Favorites writes

Favorite creation resolves the target profile's `user_id` before inserting `(user_id,target_user_id)`. Self-favorite is rejected and duplicate insert is handled via unique-violation response. The target profile can theoretically be removed between lookup and insert, but no material authorization escalation is established from the reviewed route; FK behavior and profile deletion semantics remain dependent on the live schema. DELETE is scoped to the authenticated user's own favorite row.

## Global mutation gate interpretation

Migration `20261116_009_global_mutation_gate.sql` installs a statement-level BEFORE INSERT/UPDATE/DELETE/TRUNCATE trigger on every public ordinary/partitioned table existing when migration runs. This serializes individual DML statements under the shared transaction advisory lock. It does **not** turn multiple independent PostgREST requests (read/count then write) into one atomic transaction. Any multi-request invariant still requires a single RPC/transaction, a database constraint, or a compare-and-set predicate sufficient for that invariant.

## Release status / next actions

- No source code or SQL was changed in v14; this is an audit-document/checklist update only.
- No new confirmed P1/P2 is added from this scope.
- Keep the existing P1 Stripe Webhook event-ordering issue and P2 band invitation/chat authorization races open.
- Before production readiness, verify the live Tokyo FK/delete-trigger schema read-only and reproduce relevant concurrency behavior in a disposable database.
- Production DB, GitHub, and Vercel remain untouched. No build/test/lint/typecheck/local checks were run.

