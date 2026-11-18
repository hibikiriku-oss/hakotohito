# Candidate v6 change ledger — 2026-11-18

Baseline: `Hakotohito_20261118_limited_release_phase2_privacy_acl_candidate_v5.zip`.

Changes in v6:
- Corrected `20261118_003_lock_down_security_definer_rpc_acl.sql` to include four existing SECURITY DEFINER entries observed in the supplied 2026-11-17 database export: `configured_coin_fee`, `configured_lesson_fee`, `set_initial_coin_balance`, and the legacy `cancel_event_request_with_refund` wrapper.
- Kept `set_initial_coin_balance()` and all seven Outbox trigger functions off direct `service_role` EXECUTE because they are invoked by installed triggers. Kept the legacy `cancel_event_request_with_refund()` wrapper granted to `service_role` during the compatibility window; it must only be revoked after the old deployment is drained.
- Narrowed the facility application-accept API request lookup to the three fields it uses; added an active-account predicate to favorites authentication.
- Added `docs/20261118_PHASE2_ACL_ALLOWLIST_AUDIT.md` and updated the Phase 2 audit note.

Validation performed: ZIP extraction/integrity, root/mirror file-set and byte comparison, and static comparison of the ACL allowlist against the supplied database function export. No build, test, lint, typecheck, SQL execution, database write, Git commit/push, or deployment was performed.

This is an unapplied candidate, not a production-ready approval.

Known blocker retained in this audit candidate (not represented as fixed): the current Outbox implementation stores only `recipient_line_user_id`, does not bind a queued row to a stable `recipient_user_id`, does not use a lease token for claim/finish, and does not verify exact recipient/payload on duplicate event keys. These issues require a coordinated SQL + TypeScript Outbox redesign before limited release.


## v8追加修正（2026-11-18）

- 同一event_keyへの同時INSERT競合の懸念は、migration014でOutboxテーブルにも共通mutation gate triggerが設置され、書き込みが直列化されることを再確認したため、修正不要と判断（追加ロックなし）。
- `20261116_021_withdrawal_notification_outbox.sql` で、退会対象本人のLINE IDと一致する通知候補を3種類（進行中match、施設退会時のpending direct invite、演奏者退会時のrefund通知）から除外。退会後の自己通知登録が受信者解決エラーとなり、退会全体をロールバックする可能性を排除。
- 本番DB適用、SQL実行、build/test/lint/typecheckは未実施。
