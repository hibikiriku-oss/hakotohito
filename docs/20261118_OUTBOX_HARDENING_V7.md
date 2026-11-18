# 2026-11-18 LINE Outbox hardening follow-up (candidate v7)

## Changes

- Added `recipient_user_id` binding through a `BEFORE INSERT` trigger. Existing trigger/RPC inserts still provide a LINE ID, but the trigger resolves exactly one active account UUID in the same transaction and namespaces the event key with that UUID.
- Exact duplicate event-key/payload replay remains idempotent. Reusing a key with a different account or message payload raises an exception, rolling back the originating transaction.
- Existing unsent rows from the old schema are dead-lettered during migration 004. Their original account identity cannot be proven after possible withdrawal/re-registration, so they are not sent or rebound. Sent rows remain intact as historical evidence.
- Claim returns a fresh lease token. Completion/retry require the exact row ID and lease token; old unfenced acknowledgement RPC signatures are dropped.
- Claims are capped at five rows. Worker sends at most five LINE pushes concurrently; LINE push requests have a 10-second timeout. The lease expires after two minutes.
- Claim-time checks resolve the current LINE ID only through the same `recipient_user_id` and require an active, linked account.
- The migration includes read-only preflight assertions and postflight assertions. A separate read-only diagnostic query file is included for live DB review.

## Important delivery boundary

Lease fencing prevents an expired worker from changing a newer worker's database state. It cannot retract a LINE Push that LINE accepted before the worker lost its lease or before the database acknowledgement completed. A process crash in that narrow interval can still cause a duplicate push after lease recovery. Exactly-once external delivery is not claimed.

## Migration

`supabase/migrations/20261118_004_harden_line_notification_outbox.sql` is a forward migration and has not been executed. Before applying it, compare live function signatures, Outbox rows, constraints, triggers, and migration history using `docs/20261118_OUTBOX_READONLY_PREFLIGHT.sql`.

## Not performed

No database SQL, build, test, lint, typecheck, commit, push, or deployment was performed.


## v8追加監査・修正

- 同じ最終event_keyに対する同時INSERT競合の懸念を再確認。migration014がOutboxテーブルにも共通mutation gate triggerを設置しているため、書き込みは直列化され、この点の追加修正は不要と判断した。
- 退会処理の通知候補から退会対象本人のLINE IDを除外し、退会済みアカウントをactive recipientとして解決できず退会transaction全体が失敗するケースを防いだ。
- 直接依頼承諾時の施設コイン不足通知について、誤って演奏者本人へ送っていた宛先を施設のactive LINEアカウントへ修正（`src/app/api/performer/invitations/[id]/accept/route.ts`）。詳細は`docs/20261118_OUTBOX_V8_FOLLOWUP_AUDIT.md`。
