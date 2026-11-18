# Hakotohito Phase 2 v19 — static review, repository synchronization, and atomic chat reads

Date: 2026-11-18 (JST)  
Baseline: v18 candidate ZIP.  
Scope: source/static SQL inspection and candidate authoring only. No live database connection or PostgreSQL execution was performed.

## 1. Repository mirror inconsistency found and corrected

The archive contains the project at its root and a nested `music-matching/` copy. At the initial v18 inspection, a full file-hash comparison found exactly four differing application source files: Stripe webhook, band invitation POST, band chat POST, and match chat POST. The root copies contained v17 changes, while nested repository copies remained at the older implementation. The candidate migrations 006/007 and several v17/v18 audit artifacts were also absent from the nested repository copy; migration 008 was added during v19.

v19 copies the authoritative root source files, migrations 006/007/008, and the relevant v17/v18/v19 audit artifacts into `music-matching/`. The root project and nested repository copies now have identical contents for all five changed API files and all three new migrations. The checklist is synchronized in both trees.

This corrects a packaging defect; it does not prove which copy the user's local checkout currently uses. The nested `music-matching/` tree is the repository-shaped copy and now contains the complete candidate changes.

## 2. Stripe migration 006 preflight hardening

The ordered-incident RPC reads `stripe_webhook_events.event_type`. v18 verified the lease fields but did not explicitly check the `event_type` column's existence/type in migration 006 preflight. v19 adds explicit text-type checks for `event_type` and `stripe_event_id` before function creation. This is a fail-closed preflight improvement; it does not replace a fresh target-DB schema inspection.

The equal-second event-ID tie-break remains deterministic, not chronological. Different Stripe events sharing the same `created` second can still be misordered lexicographically. This limitation remains visible and must be covered in the operational test plan; do not claim sub-second ordering.

## 3. Chat GET TOCTOU candidate closure

### Match chat GET

Added `get_match_chat_page_atomic(uuid,uuid,boolean,timestamptz,uuid,integer)` and routed GET through it. The RPC acquires the global mutation gate before authorization reads, then validates active account/match and facility-owner or performer/current-band-leader authorization. It creates/loads the conversation, computes unread count or marks incoming messages read, and fetches the cursor page in one transaction. The RPC returns the same message fields expected by the current API, preserving the 100-row page size and descending cursor semantics while returning display order oldest-to-newest.

The route retains LINE token verification and the existing authorization helper as an early guard; the RPC repeats all mutable authorization checks under the global gate, so those early reads are not trusted for the final read/write decision.

### Band chat GET

Added `get_band_chat_messages_atomic(uuid,uuid)` and routed GET through it. The RPC acquires the global gate, verifies active account/band/membership, and retrieves the latest 100 messages with sender names in one transaction.

### Migration safeguards

Migration 007 now preflights the columns referenced by all invitation/chat RPCs, including the new GET functions, and requires the existing non-partial unique `conversations(match_id)` index and mutation-gate triggers. All five migration 007 RPCs are postgres-owned, fixed-search-path SECURITY DEFINER functions with EXECUTE granted only to service_role. The routes pass the LINE subject from the verified ID token, and each RPC checks that the database user still has that exact `line_user_id`, closing the account-rebinding gap between the route precheck and the atomic operation. Rollback notes include the GET RPCs and their current signatures.

## 4. Performance-request DELETE candidate

Added migration `20261118_008_atomic_performance_request_delete.sql` and changed the DELETE route to call `delete_open_performance_request_atomic(uuid,uuid)`. The RPC acquires the global mutation gate, distinguishes missing request from wrong owner, verifies an active facility and the current verified LINE subject, checks `status='open'`, counts applications, matches, and application attempts, and deletes only when all are zero. The API also rejects malformed UUIDs before calling the RPC. Application attempts are treated as anti-abuse/audit history and are not silently removed by the known `ON DELETE CASCADE` relationship.

Both migration preflight and runtime RPC fail closed if an unreviewed foreign key references `performance_requests` or an unreviewed DELETE trigger is present on that table. This is intentionally conservative. The migration depends on migration 010 (`application_attempts`) and migration 009 (global gate); the live target must confirm the dependency graph and trigger set before application.

## 5. Remaining blockers

- No PostgreSQL execution or disposable-database race test was performed. SQL function bodies and runtime behavior remain unverified.
- No fresh post-reset business-row snapshot is present in the uploaded materials. Recent exports are catalogs/functions/ACL/RLS/triggers, not current applications/matches/coins/webhook incidents. The 2026-11-13 dump remains stale and is not used.
- No fresh target DB evidence proves migrations 009/010/022, enabled gate triggers, Outbox trigger, unique indexes, exact columns, or Stripe legacy incident metadata.
- Stripe equal-second ordering ambiguity remains.
- Performance-request DELETE now has an atomic fail-closed candidate. It remains unverified until the target DB confirms all referencing FKs and DELETE triggers, and PostgreSQL concurrency tests pass.
- Other APIs and read paths outside the audited chat endpoints remain outside this candidate's scope.

## 6. Verification boundaries

- No build, lint, test, typecheck, or local project check was run, per instruction.
- No Supabase SQL, Git operation, GitHub push, or Vercel deploy was performed.
- Stripe coin purchase remains disabled for limited release; webhook remains for pre-existing Checkout Session reconciliation.
- Lesson functionality remains enabled.
- Release state remains **BLOCKED** pending fresh read-only DB evidence, PostgreSQL/disposable DB validation, integration review, and controlled LINE real-device tests.
