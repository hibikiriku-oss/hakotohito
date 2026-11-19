# Phase 2 v38 — cron / Outbox observability / expiry lifecycle audit (2026-11-18)

## Scope and method

Source-only follow-up against the v37 candidate tree. Reviewed the expiry RPC and its application-status trigger, the hardened Outbox schema/worker RPCs, the shared TypeScript drain helper, all drain call sites, and all three cron routes plus `vercel.json`. No database connection or SQL execution, build, test, lint, typecheck, local checks, LINE delivery, or remote mutation was performed.

## Findings (20 checks)

### P1 — corrected in this candidate

1. **Outbox cron masked claim-RPC failures as success.** `drainLineNotificationOutbox` previously returned only zero counters when `claim_line_notification_outbox` failed. The cron route unconditionally returned HTTP 200 with `success: true`, making a broken queue worker indistinguishable from an empty queue. The helper now adds `claimError: true` on claim failure, and the cron route returns `success: false` / HTTP 500 for claim failures or failed lease acknowledgements. The field is additive; existing callers that inspect delivery counters remain compatible.

### P2 — operational / policy follow-up

2. **LINE push and Outbox acknowledgement are necessarily at-least-once.** If LINE accepts a push but the lease-token completion RPC fails or the worker loses its lease, the row can be retried and the recipient may receive a duplicate. The source comments already acknowledge this; no exactly-once guarantee should be advertised.
3. **A 2-minute lease can expire while a request is still in flight under unusual latency.** The LINE client timeout is 10 seconds, normally below the lease, but platform suspension/network stalls can outlive it. A stale worker cannot mutate the row because lease tokens fence acknowledgements; duplicate external delivery remains possible.
4. **Retry backoff is capped at one hour.** Attempts are limited to eight and exponential delay is capped at 3,600 seconds. This is bounded and prevents infinite retries, but permanent failures become dead-lettered without a dedicated operator recovery UI found in this source pass.
5. **Dead-lettered legacy Outbox rows are not automatically replayed.** Migration 004 marks pre-binding pending/processing rows failed because their old LINE IDs cannot be safely rebound after account re-registration. This is privacy-preserving; any recovery must reconstruct recipient identity rather than reset status blindly.
6. **Outbox event identity is account-bound.** Migration 004 resolves exactly one active user for the LINE ID and appends recipient UUID to the event key; duplicate LINE IDs across active accounts fail closed. This is a positive control confirmed in source.
7. **Outbox payload identity is immutable.** The update trigger prevents changing event key, recipient, messages, or creation time after insertion. This protects idempotency identity; worker RPCs only alter delivery metadata.
8. **Worker RPCs require lease tokens.** Completion and retry operations match both row ID and current lease token, preventing stale workers from acknowledging a newer lease.
9. **Worker claim rechecks recipient account state.** Claiming excludes withdrawn, unlinked, and `withdrawn:%` users; the function also marks ineligible queued rows failed. This reduces delivery to former accounts.
10. **The TypeScript helper caps batches at five regardless of caller input.** Several routes pass 20 or 100, but the helper clamps to five. This is safe for request latency but means those callers do not actually drain the requested larger batch.
11. **Cron Outbox schedule remains once daily.** `vercel.json` runs the worker at 02:05 UTC. The v38 fix improves failure visibility but does not change cadence or throughput.
12. **Cron expiry schedule remains once daily.** The expiry endpoint invokes the RPC with 5,000; the RPC clamps to 5,000 and processes due attempts in expiry order. A backlog beyond the cap waits for another scheduled run.
13. **Cron endpoints require exact Bearer secret matching.** All three cron routes reject absent/mismatched `CRON_SECRET`; the service-role key is only read after authorization. No unauthenticated cron execution path was found.
14. **Cron routes use service-role RPC calls rather than direct Outbox table writes.** This is consistent with migration 004 revoking direct service-role table privileges and granting only worker RPC execution.
15. **Expiry notification is tied to the pending→rejected application transition.** Migration 015 only enqueues when the latest attempt for the application is itself expired and past expiry, preventing an older expired attempt from causing a misleading notice after a newer attempt.
16. **Expiry notifications cover individual and band applicants.** Individual/direct-invite notices go to the attempt performer; band notices fan out to active members. Withdrawn/unlinked accounts are excluded before Outbox insertion.
17. **Manual rejection is not misclassified as expiry.** The latest attempt must have status `expired`; a pending→rejected update with a latest attempt in another state does not emit an expiry notice.
18. **Expiry processing counts attempts, not distinct applications.** The RPC returns the number of expired attempt rows. The route labels it `expiredCount`; operational dashboards should interpret it as attempt count, not number of unique applicants.
19. **Expiry worker and notification trigger share the same transaction.** The application rejection and Outbox insert are trigger-driven in the same transaction; a failed enqueue rolls back the status change rather than silently losing the event.
20. **Auto-completion cron is guarded by a second transactional RPC.** The route selects eligible candidates, but `complete_match_with_fee` is the authoritative state/eligibility check. Candidate selection alone is not treated as authorization to complete.

## Recommended next steps

1. Monitor the new `claimError` and HTTP 500 signal; add an operational alert for repeated cron failures and `failedToRecord` counts.
2. Decide the Outbox service-level target (maximum notification delay), then set cron cadence/batch sizing within the actual Vercel plan and LINE rate limits.
3. Define a manual, audited dead-letter recovery procedure that re-resolves current account identity and never replays old LINE IDs blindly.
4. Preserve at-least-once semantics in product/support wording; do not promise exactly-once LINE delivery.
5. Continue the unresolved v37 P1 work: dual-role withdrawal reconciliation and actor-aware counterpart notifications.

## Release gate

**BLOCKED.** This batch fixes one source-level observability defect only. Dual-role withdrawal and notification gaps remain unresolved. SQL was not executed; PostgreSQL validation, Tokyo read-only preflight, LINE real-device checks, build/test/lint/typecheck, and deployment checks remain outstanding. No Supabase, GitHub, or Vercel state was changed.
