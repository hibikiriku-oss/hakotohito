# Phase 2 v43 — Outbox migration rollout safety and API inventory follow-up (2026-11-18)

## Baseline and scope

Baseline: v42 candidate archive. This batch revisited Outbox migration 004, worker RPC compatibility, cron processing, withdrawal notification volume, expiry notifications, and public/API read paths. Source-only static audit; the supplied Supabase exports remain historical evidence and were not treated as a live catalog.

## Supabase migration-history query correction

The prior Outbox read-only preflight and runtime evidence script queried `supabase_migrations.schema_migrations`, but the user's established Supabase workflow has no such application-owned table. Supabase internal histories (`auth.schema_migrations`, `realtime.schema_migrations`, `storage.migrations`) are platform-managed and are not Hakotohito's migration ledger. v43 removes the invalid query from both scripts, replaces it with live schema/function/trigger stage markers, and directs the operator to record each SQL Editor file and successful `COMMIT` manually in `PUBLIC_RELEASE_CHECKLIST.md`. The production guide now follows the user's established SQL Editor workflow: one complete file per batch, confirm final `COMMIT;` and success before proceeding.

## Global mutation-gate partition handling

Migration `20261116_009_global_mutation_gate.sql` installs a statement-level trigger on every public table. PostgreSQL automatically clones a trigger created on a partitioned parent to its partitions. The original loop also visited inherited partition children and could attempt to drop/recreate those clones separately. v43 now skips relations present as `pg_inherits.inhrelid`, installing on top-level tables/partitioned parents only; PostgreSQL propagates the trigger to partitions. This is defensive and does not assume the current project contains partitioned tables.

## Supplied Supabase function-export reconciliation

The uploaded 2026-11-17 function export was compared offline against the exact 31 required routine-definition hashes embedded in migration `20261116_009_global_mutation_gate.sql`. After the same CRLF-to-LF normalization used by the migration, **31/31 required routine definitions matched**. The same export contains 35 SECURITY DEFINER routines; all 35 identity signatures were found in migration `20261118_003_lock_down_security_definer_rpc_acl.sql`'s reviewed required/optional allowlist. A separate signature inventory also reconciled all 53 required signatures in migration 003: 35 are in the uploaded export and 18 are defined by the candidate migration chain, with zero missing; all four optional Outbox signatures are defined by the candidate chain. This supports the static baseline used by migrations 009 and 003, but it does not establish the live Tokyo catalog or migration history and is not a substitute for target read-only preflight.

## Confirmed rollout hazards and candidate corrections

### P1 — migration 004 could silently discard queued notifications

The previous migration 004 changed every existing `pending`/`processing` Outbox row to `failed` before recipient UUID binding. That avoids misdelivery to a LINE ID that may have been released/reused, but it also silently drops legitimate notifications already queued by Outbox triggers.

**v43 correction:** remove the blanket status update. The migration preflight now raises an exception if any row is `pending` or `processing`, before altering the table. The operator must drain or explicitly reconcile the old queue and rerun the migration. The same preflight now also rejects duplicate active LINE user IDs, because recipient binding requires exactly one active account. It also verifies that the Outbox global mutation-gate trigger is enabled and bound to the expected helper, rather than merely checking that a trigger with the expected name exists.

### P1 — migration 004 previously removed acknowledgement RPCs before the new app could be deployed

Migration 004 changes the claim result to include `lease_token` and replaces the legacy acknowledgement signatures with lease-token signatures. Removing the old signatures before deploying the new worker would break currently deployed Vercel instances; an instance could send a LINE push and fail to acknowledge it, causing retry/duplicate delivery.

**v43 correction:** migration 004 now keeps the legacy `complete(uuid)` and `retry(uuid,text)` signatures temporarily while adding the fenced overloads. The compatibility overloads also clear `lease_token` when acknowledging/retrying, preserving the new row-state invariant. The v43 worker supports both contracts, but treats a present-yet-empty token as a contract failure and never falls back to an unfenced acknowledgement in that case. New migration `20261118_017_retire_legacy_outbox_acknowledgement_rpcs.sql` drops the legacy signatures only after the v43 app is Ready, old instances have drained, and no Outbox row remains `processing`. The legacy signatures remain unfenced during this short transition, so migration 017 must not be skipped or delayed unnecessarily.

## Additional findings retained

### Confirmed — lesson fees are reserved at offer creation and charged per matched learner

`configured_lesson_fee` returns the configured fixed fee for free lessons and `CEIL(lesson_fee * paid_lesson_fee_percent / 100)` for paid lessons. Offer creation reserves the fee across capacity; `apply_to_lesson_offer` deducts one share when each learner is matched, rejects a match when the teacher's available balance is insufficient, and reduces the remaining reservation. The lesson path remains enabled. This matches the current lesson-fee design; no change was made.

### Confirmed — completion fee uses configured percentage and does not block completion for insufficient balance

`complete_match_with_fee` calculates `CEIL(fee_base * completion_fee_percent / 100)`, locks the payer, subtracts the fee even when the balance becomes negative, records the idempotent ledger transaction, and then completes the match in the same transaction. This matches the recorded 1%/negative-balance policy; no change was made.

### Confirmed — direct-invitation fee is deferred until the performer accepts and a match is created

`create_facility_invitation_with_coins` creates the pending application/attempt and records `fee_due` without calling `spend_coins`. `accept_direct_invitation_atomic` creates the match and charges `direct_invite_fee` using the attempt-scoped idempotency key in the same transaction; an insufficient-balance exception rolls back the match and charge together. This matches the recorded direct-invitation fee timing; no change was made.

### Confirmed — application fee is charged at match establishment, not at application submission

`accept_application_with_coins` charges only when the selected `application_attempts` row has `fee_due`, using `application_match_fee:<attempt_id>` in the same transaction as match creation and acceptance. Band applications therefore remain one fee per accepted application attempt, not per band member. This matches the recorded fee timing; no change was made.

### Confirmed — event/rental initial fee remains once per request across full-cancellation refund and re-match

The match-establishment function charges the initial event/rental fee with `event_match_fee:<request_id>`. The full-request cancellation function refunds that same ledger debit with the request-scoped key `event_match_refund:<request_id>` only when no match has completed. Re-match checks the original request-scoped charge key, so the fee is not charged again after the refund. Individual participant cancellation does not refund the request-level fee while the event continues. This matches the recorded once-per-request policy; no change was made.

### P2 — Outbox drain throughput / backlog operations

- `drainLineNotificationOutbox` clamps every requested batch to five rows, including call sites that pass 20 or 100.
- Vercel Outbox Cron is scheduled once daily and drains at most five rows per run.
- Withdrawal and event-cancellation paths may enqueue more than five counterpart notices; only five are attempted immediately, with the rest waiting for later drains.
- Expiry Cron runs once daily and queues notification rows through the database trigger; the Outbox Cron is scheduled one hour later.
- Backlog age, retry/dead-letter alerting, and an operator recovery procedure still need runtime/plan verification. No cadence or batch change was made because the target Vercel plan and LINE limits are not verified.

### P2 — auto-completion candidate query remains unbounded

`/api/cron/auto-complete` fetches all matching rows without `.range()`/`.limit()` and then sequentially calls `complete_match_with_fee`. It can be truncated by the Supabase/PostgREST row cap or exceed the 60-second route budget. A bounded claim RPC or keyset pagination with a measured per-run budget is still required; no speculative pagination change was made.

### P2 — admin-created dual-role accounts may be able to self-apply/self-match

The personal application path validates that the performer profile belongs to the active caller, and the acceptance path validates facility ownership and the application attempt payer, but neither explicitly rejects `performer.user_id = facility.user_id`. The direct-invitation create/accept RPCs likewise validate the facility and performer separately without comparing their owning user IDs. Since administrator-created dual-role accounts legitimately have both profiles, such an account may be able to apply to its own facility request or send/accept a direct invitation to its own performer profile. This could create a self-match and corresponding fee/review records.

**No code change in v43:** the intended self-match policy has not been explicitly confirmed. Recommended policy is to reject self-application and self-invitation at both API and DB RPC layers, including band applications containing the facility owner. Treat this as a P2 release gate for admin-created dual-role test accounts; do not use one account as both sides of a test until the policy is decided.

### P2 — performer detail/review reads accepted a valid token without checking the viewer account was active

`/api/performers/[id]` and `/api/performers/[id]/reviews` verified the LINE ID token and checked that the target performer was active, but did not verify that the requesting account was still active. A withdrawn account with a still-valid ID token could therefore continue reading profile/review data, unlike the facility detail and performer directory routes.

**v43 correction:** both routes now resolve the viewer through `users.line_user_id` with `account_status='active'`; database lookup errors fail with 500 and missing/inactive viewers are rejected with 403. This does not restrict which active role may view public profiles.

### P2 — public list/read APIs have additional row-cap exposure

- `/api/performers` loads the full active performer list and related completed matches/reviews without explicit pagination.
- `/api/performance-requests/options` loads all open requests to build distinct filter values.
- `/api/performer/matches` loads personal and band history without explicit pagination.

These are scale/data-completeness risks rather than current limited-release security findings. They should be revisited when volume warrants pagination or aggregation RPCs.

## Static verification performed (51 checks)

1. Reopened v42 as the authoritative candidate baseline.
2. Verified migration 004's old blanket `pending`/`processing` failure update.
3. Verified the old claim RPC signature remains argument-compatible while its result shape changes.
4. Verified old complete/retry signatures were previously dropped by migration 004.
5. Verified the deployed-source baseline's worker acknowledgement call shape.
6. Added dual-contract worker acknowledgement behavior.
7. Confirmed no-token mode uses only the legacy acknowledgement argument shape.
8. Confirmed token mode uses only the lease-token acknowledgement argument shape.
9. Added a migration 004 preflight stop for any pending/processing Outbox row.
10. Removed the blanket queue-failure update.
11. Retained Outbox recipient binding and lease-token postflight checks.
12. Updated transitional legacy acknowledgement overloads to clear lease_token and preserve row-state consistency.
13. Kept legacy acknowledgement overloads during the transition window.
14. Added fail-closed handling for a missing/empty token in a hardened claim response.
15. Added migration 017 to retire legacy acknowledgements after deployment.
16. Added migration 017 preflight for lease-token RPCs and zero processing rows.
17. Rechecked recipient UUID binding to exactly one active LINE account.
18. Rechecked immutable Outbox event identity and payload mismatch rejection.
19. Rechecked stale lease fencing on complete/retry RPCs.
20. Rechecked the five-row hard cap in the worker helper.
21. Rechecked all call sites requesting 20/100 rows and confirmed the cap still applies.
22. Rechecked the daily Outbox Cron schedule.
23. Rechecked the daily expiry Cron schedule and its Outbox trigger path.
24. Rechecked the 60-second auto-complete route and sequential RPC loop.
25. Rechecked the auto-complete candidate query has no explicit pagination or row bound.
26. Rechecked performers GET list query has no explicit pagination.
27. Rechecked performance-request filter-options query has no explicit pagination.
28. Rechecked performer match history query has no explicit pagination.
29. Rechecked public announcements and coin-rates endpoints expose only intended public configuration/content fields.
30. Rechecked Stripe Connect onboarding is explicitly disabled for limited release.
31. Rechecked Stripe coin-purchase POST is hard-disabled in application code.
32. Added active-viewer checks to performer detail and review reads.
33. Added a migration 004 fail-closed preflight for duplicate active LINE IDs.
34. Added read-only aggregate SQL for repeatable pre-test/post-test snapshots without LINE IDs or user names.
35. Compared the 31 migration-009 required routine hashes against the uploaded 2026-11-17 function export; all 31 matched after CRLF normalization.
36. Confirmed all 35 SECURITY DEFINER routines in the uploaded function export are covered by migration 003's reviewed allowlist.
37. Tightened migration 004 and 017 preflight to require an enabled Outbox mutation-gate trigger bound to the expected helper.
38. Reconciled event/rental initial-fee charge/refund idempotency across migrations 012/013; request-scoped charge/refund keys preserve once-per-request behavior after full cancellation and re-match.
39. Reconciled completion-fee calculation/negative-balance behavior with the configured-percent policy.
40. Reconciled application-fee timing and idempotency at match establishment, including one fee per band application.
41. Reconciled direct-invitation creation/acceptance and fee idempotency across migrations 011/012.
42. Hardened migration 009 trigger installation to skip inherited partition children and rely on parent trigger propagation.
43. Reconciled all 53 required SECURITY DEFINER signatures in migration 003 against the 11/17 export and candidate migration definitions; zero missing; all four optional Outbox signatures are defined.
44. Verified final ZIP integrity and confirmed no `.env`/credential/secret file paths are included (`.env.example` only).
45. Removed nonexistent `supabase_migrations.schema_migrations` queries from Outbox preflight/runtime evidence and replaced them with live schema-stage markers.
46. Added a manual SQL Editor migration-application ledger to PUBLIC_RELEASE_CHECKLIST because no app-owned migration history table exists.
47. Corrected package-import instructions to identify ZIP root as the app root and nested `music-matching/` as the mirrored copy, avoiding a double-nested project directory.
48. Changed duplicate active LINE ID preflight output to aggregate counts only (no raw LINE IDs) and added service_role RPC execute visibility.
49. Reconciled paid/free lesson fee configuration, reservation, per-matched-learner debit, and insufficient-balance guard.
50. Audited self-application/self-invitation paths for admin-created dual-role accounts; identified missing cross-profile owner equality guards and recorded as P2 pending policy decision.
51. Rechecked root/nested tree parity after all candidate changes.

## Release gates and non-actions

- Migration 004 and new migration 017 remain unexecuted and require target read-only preflight.
- Migration 016 remains an unapplied candidate with unresolved target catalog/prerequisite checks.
- `docs/20261118_PHASE2_V43_RUNTIME_EVIDENCE_CAPTURE.sql` is a read-only before/after snapshot script; run it after the migration chain is in place and before/after each test scenario. `docs/20261118_PHASE2_V43_PRODUCTION_ROLLOUT_GUIDE.md` contains the complete stepwise reflection/test sequence, including the deliberate pause before migration 017.
- No SQL/PostgreSQL validation or execution, live Supabase read, application build, tests, lint, typecheck, or application-local checks were performed. Only static source/document inspection plus archive integrity and mirrored-file parity checks were performed.
- No GitHub commit/push or Vercel deployment was performed.
- No Supabase, GitHub, or Vercel resource was changed.
- Lesson functionality remains enabled; Stripe coin purchase remains disabled for limited release.

**Release status: BLOCKED pending target preflight, coordinated expand/contract worker rollout, migration verification, and controlled LINE tests.**
