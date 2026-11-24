# V48 返金元取引監査フォローアップ（2026-11-22）

## 今回の静的ソース確認

`20261116_013_cancel_reapply_and_direct_fee_refund.sql` と `20261122_004_performance_reward_fee_at_match.sql` を関数単位で照合した。

1. `cancel_match_with_direct_invite_refund` は最初に `match_id` と施設所有者の残高を前提に `match_fee` debitを検索する。その後、イベント／レンタル分岐では `v_has_match_fee := false` としてこのdebitを返金対象から外し、旧 `rental_match_fee`／`event_participation_fee` だけを探す。V48.004が作る `event_match_transaction_fee:<match_id>` は `transaction_type='match_fee'` なので、この分岐では返金されない。
2. 同関数の通常案件返金も、支払者を `v_facility_user_id` に固定して検索する。V48.004の `facility_reward_fee` は別種別・別キーであり、`match_fee_snapshots.coin_transaction_id` も参照されない。
3. `cancel_event_request_with_refund_internal` は未完了matchごとに旧 `rental_match_fee`／`event_participation_fee` を検索する。新しいper-match `match_fee` debitと `facility_reward_fee` snapshot/debitは検索しない。
4. 全体キャンセルの初回料金は `event_match_refund:<request_id>` で処理されるが、返金可否にrequest内の完了match有無 `v_has_completed_match` を使っている。初回debitのID・初回matchとのsource照合ではない。
5. 現行の返金行は複数箇所で `admin_adjustment` と別のidempotency keyを使う。元debit IDを返金行へ保持する共通FK／unique制約は、V48候補内では確認できない。

## 重要な設計制約

- `facility_reward_fee` の未完了キャンセル時返金は、今回のユーザー確定仕様としてまだ明示されていない。自動返金を追加しない。
- 完了済み・異議申立て成立時の返金も、未完了キャンセルのルールから推測しない。
- 初回イベント／レンタル料金はrequest単位onceであり、match単位料金とは別sourceとして維持する。
- 返金行の payer／amount／request／application／attempt／match／band は元debitから導出し、呼出側引数で指定させない。
- 既存返金行のsource backfillは、候補debitが完全一致で一件に確定しない限り実施しない。descriptionだけの一致は不可。

## 今回追加したもの

`20261122_V48_REFUND_SOURCE_PREFLIGHT_READONLY_V2.sql` を追加。ledger schema・CHECK/UNIQUE制約・index・trigger/RLS・関連RPC定義・V48課金キー・snapshotとdebitの一致・初回料金の重複・既存返金候補・source_transaction_idの有無・残高照合・attempt provenance列を確認するSELECT/catalog専用SQL。

## 実施していないこと

SQL関数の置換、DBスキーマ／データ変更、本番DBへの接続・実行、build/test/lint/typecheck/ローカルチェック、Push、Deployは未実施。実DBの結果を取得していないため、source_transaction_id migrationや既存返金backfillを安全に確定できる状態ではない。

**判定：BLOCKED継続。** 次はこのV2 preflightの実DB結果を確認し、既存台帳の型・制約・返金履歴・attempt参照を確定してから、source-linked refund migrationのDDLと移行対象を設計する。
