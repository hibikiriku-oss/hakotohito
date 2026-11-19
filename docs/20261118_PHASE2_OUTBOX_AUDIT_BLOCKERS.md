> **Status update:** The three blockers below were addressed in candidate v7 by `20261118_004_harden_line_notification_outbox.sql` and the updated worker. This file is retained as the historical v5/v6 audit finding; v7 still requires static review and live read-only preflight before any SQL is considered.

# 2026-11-18 transactional LINE Outbox audit — release blockers

Status: confirmed by static inspection of candidate v5/v6 source and migrations. Not fixed in v6; this document records the next required coordinated remediation.

## P0 — recipient identity is not bound to the account

`line_notification_outbox` stores `recipient_line_user_id text NOT NULL` but no stable `recipient_user_id`. Trigger functions snapshot the LINE ID at enqueue time, and `drainLineNotificationOutbox()` sends the stored LINE ID directly. `withdraw_user_account_with_notification_outbox()` anonymizes the account's LINE ID, but queued rows for that account are not invalidated or bound to the original user UUID.

Consequences:
- A queued notification can still be sent to a user after withdrawal.
- If the same LINE account registers again and the LINE ID is assigned to a new `users` row, an old queued notification can be delivered to the re-registered account because the Outbox row cannot distinguish the old account from the new account.

Required design:
- Add stable `recipient_user_id` to Outbox rows and have every trigger/RPC enqueue that UUID.
- Resolve the current LINE ID at claim/send time only by joining the same `users.id` with `account_status='active'` and a non-empty, non-withdrawn LINE ID.
- Mark unresolved/withdrawn recipient rows dead without sending; never rebind a queued event to a different account merely because the LINE ID matches.
- Backfill old pending rows only when an unambiguous active user mapping exists; otherwise dead-letter them. Preserve already-sent rows as historical evidence.

## P0 — claim/finish lacks lease fencing

`claim_line_notification_outbox()` changes rows to `processing` and sets `locked_at`, but returns no unique lease token. `complete_line_notification_outbox(p_id)` and `retry_line_notification_outbox(p_id, ...)` update by row ID/status only. A worker whose lease expired can finish or retry a row after another worker has reclaimed it. Two workers can also send the same notification if the first external LINE request runs longer than the five-minute lock timeout.

Required design:
- Add a fresh `lease_token` UUID for every claim.
- Return the token from claim and require exact `id + lease_token + status='processing'` for finish/retry.
- Keep bounded attempts and dead-letter semantics; a stale worker must not mutate the new lease.
- Recognize that lease fencing prevents stale DB acknowledgements but cannot retract a LINE Push already accepted by LINE. Document the in-flight send boundary.

## P1 — duplicate event key does not verify payload equality

`enqueue_line_notification()` uses `ON CONFLICT (event_key) DO NOTHING` and returns only whether a row was inserted. It does not load and compare the existing row's recipient account, recipient LINE identity, or message payload. A key collision/reuse with different content can be reported by the caller as queued even though the old payload remains.

Required design:
- On conflict, load the existing event row and compare stable recipient UUID plus canonical message payload.
- Return an explicit replay result only for an exact match; raise/return conflict for any mismatch.
- Ensure all business event keys are deterministic and include the correct event/attempt identity.

## Scope of required coordinated changes

The redesign must update migration 014 and every later trigger/RPC that inserts Outbox rows (015–023), the claim/finish/retry SQL functions, `src/lib/line-notification-outbox.ts`, and all call sites that enqueue a notification. Do not patch only the worker or only the base table. The migration must be additive/forward-safe against any existing Outbox rows and must include a read-only preflight and postflight.

No SQL was executed and no production data was changed. No build, test, lint, typecheck, Git commit/push, or deployment was performed.
