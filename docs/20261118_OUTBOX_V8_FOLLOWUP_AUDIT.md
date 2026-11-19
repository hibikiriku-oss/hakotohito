# LINE Notification Outbox Follow-up Audit — v8 candidate

Date: 2026-11-18  
Baseline: v7 candidate ZIP  
Scope: migrations 014–023, migration 004, Outbox worker, cron route, withdrawal route, and manual insufficient-coin notification call sites.

## Findings fixed in v8

### 1. Withdrawal could fail when the withdrawing account appeared in its own notification recipients

`withdraw_user_account(text)` builds notification arrays before anonymizing the withdrawing user. In unusual dual-profile/self-reference cases, one of those arrays could contain the withdrawing user's old LINE ID. The wrapper then inserted the notification after the account had been changed to `withdrawn`, while migration 004's recipient-binding trigger only accepts exactly one active account. That would raise an exception and roll back the entire withdrawal transaction.

Fix: migration 021 wrapper now skips any notification whose LINE ID equals `p_line_user_id` in all three loops: cancelled-match notice, pending direct-invite cancellation notice, and direct-invite refund notice. Counterparty notifications remain eligible.

### 2. Direct-invitation acceptance coin-shortage notice had the wrong recipient

`src/app/api/performer/invitations/[id]/accept/route.ts` handles `accept_direct_invitation_atomic` errors. The matching-fee migration confirms that the failure in this flow is facility coin insufficiency. The previous code sent a facility-shortage message to `user.line_user_id`, which is the performer currently accepting the invitation.

Fix: the request now retrieves the related facility's user account, verifies `account_status='active'`, and enqueues the notice to that facility LINE account. The performer still receives the API error response; the payer facility receives the actionable push notice.

## Rechecked; no change required

The potential same-event-key concurrency issue was rechecked against migration 014. That migration explicitly installs `trg_global_mutation_gate` on `line_notification_outbox`, because the table is created after migration 009's initial public-table sweep. The statement-level trigger acquires the transaction-scoped global mutation lock before Outbox writes, so concurrent event-key checks/inserts are serialized in this candidate migration sequence. No additional per-key advisory lock was added.

## Event-key inventory reviewed

- Match established: match UUID + recipient LINE ID.
- Application attempt: attempt UUID + recipient role (`performer` / `facility`).
- Lesson application: lesson application UUID + owner role.
- Lesson offer update: offer UUID + transaction ID + recipient LINE ID.
- Match cancellation: match UUID + actor user UUID + recipient LINE ID.
- Match completion: match UUID + recipient LINE ID.
- Direct invitation rejection: application UUID + facility LINE ID.
- Event cancellation: request UUID + match UUID + recipient LINE ID; direct invite cancellation uses application UUID + recipient LINE ID.
- Withdrawal: match/application UUID + recipient LINE ID, separated by notification type.
- Band invitation: invitation UUID + recipient user UUID; response additionally includes status.
- Completion report: match UUID + direction.
- Manual insufficient-coin notices: application UUID plus payer role for general applications; direct invitation application UUID.

Migration 004 appends the stable `recipient_user_id` UUID to every event key. Existing-row payload checks compare the resolved recipient UUID and JSON messages. The table-level global mutation gate serializes these writes in the intended migration sequence.

## Remaining operational blockers

- Migration 004 marks all legacy `pending` and `processing` Outbox rows as `failed`, because their original account identity cannot be proven safely. Before applying it, inspect live counts with `docs/20261118_OUTBOX_READONLY_PREFLIGHT.sql` and decide whether dropping those unsent notifications is acceptable.
- Run the read-only preflight against the target database. In particular, active LINE IDs must be unique; the duplicate-active-ID query should return zero rows.
- The SQL migrations have not been executed against PostgreSQL. No live schema, grants, trigger state, or data have been verified.
- LINE delivery remains at-least-once, not exactly-once: if LINE accepts a push and the worker loses its lease before recording completion, a later retry may duplicate the external push.
- Five concurrent sends, the 10-second LINE timeout, two-minute lease, and Cron 60-second limit still require controlled real-device/operational verification, including LINE rate limits.
- Verify recipient and message behavior for withdrawal, direct-invitation rejection/acceptance, insufficient coins, cancellation, completion, lessons, bands, and retry/dead-letter behavior on a test environment before limited release.

## Execution status

Candidate source/docs only. No production or Tokyo Supabase changes, no SQL application, no Git commit/Push, no Vercel deployment, and no build/lint/test/typecheck/local checks were performed.


## v9追加確認

Migration 004は`claim_line_notification_outbox(integer)`の引数signatureを維持したまま戻り値列に`lease_token`を追加する。PostgRESTのschema cacheが古いまま残る可能性を避けるため、migration末尾（COMMIT直前）に`NOTIFY pgrst, 'reload schema'`を追加した。通知はトランザクションcommit後に配信される。これはSQL実行環境で未検証のため、適用後にRPCが新しい戻り値列を返すことを確認する。
