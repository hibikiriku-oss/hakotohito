# 2026-11-24 本番DB証跡・統合パッケージ状態

## 1. 統合元とローカル変更

- V48候補: `Hakotohito_V48_20261123_coin_purchase_resumption_candidate_v12.zip`
- 基準Production commit: `1258308fbb7aaaca8d140e061032c36fb139464d`
- ローカル差分: `hakotohito-local-changes.patch`（10ファイル）
- V48候補とローカル差分を共通基準commitから3-way比較した。ローカル差分の内容はV12候補側に既に含まれており、`src/app/performer/home/page.tsx` のプロフィール実在確認ガードは候補側の追加安全確認を維持した。競合マーカーは残していない。
- 本パッケージ作成ではユーザーのローカル作業ツリー、GitHub、Supabase、Vercelを変更していない。

## 2. 2026-11-24に受領した本番DB結果

### テーブル・列

- `coin_transactions`: `id uuid`、`user_id uuid`、`amount integer`、`transaction_type text`、`idempotency_key text NOT NULL`、`request_id` / `match_id` / `application_id` 等。提示された列一覧に `source_transaction_id` は存在しない。
- `lesson_applications`: `lesson_offer_id`、`applicant_performer_id`、`status`、`matched_at` 等。
- `application_attempts`: publicに存在。
- `application_band_trade_history`、`application_participant_claims`、`match_fee_snapshots`、`lesson_fee_snapshots`: publicに存在しない。
- `schema_migrations`: `auth` と `realtime` schemaに存在。publicのアプリmigration履歴テーブルの存在は確認されていない。これら2つをアプリmigration履歴とみなさない。

### coin_transactions index

- `coin_transactions_idempotency_key_key`: `UNIQUE (idempotency_key)`
- `coin_transactions_pkey`: `UNIQUE (id)`
- `coin_transactions_match_id_idx`、`coin_transactions_request_id_idx`、`coin_transactions_user_created_at_idx`、`coin_transactions_band_id_idx`
- source transaction IDを保存・一意化する列／indexは提示結果にない。

### 関数・権限

すべてownerは`postgres`、`SECURITY DEFINER=true`、volatility=`volatile`。

- `apply_to_lesson_offer(uuid,uuid,text)`: postgres / service_role execute
- `cancel_event_request_with_refund_internal(uuid,uuid,boolean)`: postgresのみexecute
- `cancel_match_with_direct_invite_refund(uuid,uuid)`: postgres / service_role execute
- `complete_match_with_fee(uuid,text)`: postgres / service_role execute
- `spend_coins(uuid,integer,text,text,text,uuid,uuid,uuid)`: postgres / service_role execute
- `spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)`: postgres / service_role execute
- `withdraw_user_account(text)`: postgres / service_role execute
- `create_lesson_offer(...)`、`update_lesson_offer_with_levels(...)`: postgres / service_role execute

受領したのは関数signature・owner・security metadata・ACL一覧であり、現行本番関数の完全な定義本文ではない。過去の定義本文を現在の本番定義として扱わない。

## 3. 返金仕様（ユーザー承認済み）

- `facility_reward_fee`: 演奏実施前キャンセル時、施設の元支払者へ元徴収額全額を返金。
- `lesson_match_fee`: レッスン実施前キャンセル時、演奏者／講師の元支払者へ元徴収額全額を返金。
- 完了済み取引にはこのキャンセル返金を適用しない。
- 元debit ID・支払者・金額・取引種別・業務参照を検証し、返金登録と残高更新を原子的に行い、同一sourceへの二重返金をDBで拒否する。
- イベント／レンタル初回料金は案件単位once-onlyを維持し、成立ごとの料金と混同しない。

## 4. 追加で固定したユーザー承認済み仕様（2026-11-24）

- `facility_reward_fee` は演奏実施前キャンセル時に施設の元支払者へ全額返金。完了後は返金しない。
- `lesson_match_fee` はレッスン実施前キャンセル時に演奏者／講師の元支払者へ全額返金。完了後は返金しない。
- 返金は元debit IDにsource-linkし、payer・金額・種別・業務参照を照合。残高更新とledger INSERTを原子的に実行し、sourceごとの一意制約で二重返金を防ぐ。
- イベント／レンタル初回料金はrequest単位once-onlyを維持し、返金後の再マッチでも再徴収しない。成立ごとの料金は別sourceとする。
- イベント／レンタルの成立時feeと旧完了時feeの二重徴収を禁止する。
- 演奏者退会時に既成立案件を自動キャンセルせず、相手施設へ通知して判断を委ねる。
- バンドリーダー退会時は解散せず、加入日時が最も古い有効メンバーへリーダーを引き継ぐ。
- 応募手数料、完了後、紛争成立時の返金は未承認範囲として自動拡張しない。

## 5. リリース判定

**BLOCKED — このZIPをそのまま本番DBへ適用したり、対応アプリを本番deployしてはならない。**

理由:

1. 本番DBにV48 migrationが作るsnapshot／claim関連テーブルが存在しない。適用履歴も未確認。
2. source transaction ID列・一意制約・共通返金RPCが本番DBに存在する証拠がない。
3. 承認済みの`facility_reward_fee`／`lesson_match_fee`返金が、個別キャンセル・案件全体キャンセル・退会経路へ統合された完成migrationが候補にない。
4. イベント／レンタルの成立ごと料金、初回once-only料金、旧完了時feeの重複防止が未完了。
5. 関数の完全な本番定義本文とアプリmigration適用履歴が未取得。
6. 特商法表示の正式事業者情報・法的確認が未完了。Stripeコイン購入は無効のまま維持する。

## 6. 反映前に必要な作業

1. `docs/20261124_PRODUCTION_RPC_AND_MIGRATION_LEDGER_PREFLIGHT.sql` を本番でread-only実行し、現行関数定義・アプリmigration ledger・制約／trigger／RLSを取得。候補migrationの前提との差分を確定。
2. source-linked refund schema/RPCと、個別・全体キャンセル・退会の全writerを一つの整合したmigrationで実装。
3. `complete_match_with_fee`のイベント／レンタル旧feeとの二重徴収を解消。
4. 退会時に既成立案件を自動キャンセルしないこと、バンドリーダー退会時に最古の有効メンバーへ引き継ぐことを既存候補SQLと照合・修正。
5. migration適用順・rollback・postflight・チェックリストを確定。
6. 明示承認後にSupabase適用、対応ソースdeploy、LINE実機確認。

## 7. 未実施事項

ローカルbuild／lint／test／typecheck／その他ローカルチェック、Supabase SQL実行・変更、GitHub push、Vercel deploy、LINE実機テストは実施していない。


## 8. 2026-11-24最終修正パッケージ反映

上記の本番DB証跡と2026-11-23に追加受領した完全関数定義を使い、次の修正をソース・migration候補へ統合した。

- `20261124_001_v48_source_linked_refunds_and_fee_lifecycle.sql` を追加。`coin_transactions.source_transaction_id` と一意index、元取引行ロック・支払者／金額／種別／参照一致確認・残高更新・返金INSERTを同一transactionで行う`refund_coin_transaction`を定義。
- 個別キャンセル／案件全体キャンセルに、V48イベント成立料・施設報酬手数料等のsource debit返金を接続。旧返金キーの既存行は内容が一致する場合だけsource IDをリンクし、二重加算しない。直接依頼拒否・退会時の未成立直接依頼返金writerも共通RPCへ変更。
- イベント・レンタルの成立時取引料が徴収済みの場合、同じマッチングの旧完了時手数料を抑止。
- レッスン成立手数料について、`lesson_fee_snapshots.coin_transaction_id`を返金元として扱うキャンセルRPCと認証済みAPIを追加。
- 退会処理は施設退会時のみ成立済みマッチングをキャンセル。演奏者退会時は成立済み案件を維持し、施設へ通知。
- バンドリーダー退会時は`joined_at`が最も古い有効メンバーへ引き継ぎ、適格な後継者がいない場合だけ解散。

この修正はアップロード済みソース・DB関数定義を使ったパッケージ内の実装であり、本番DBへSQLを実行した事実を示すものではない。migration ledgerの実適用状況、過去返金データの完全照合、Supabase適用後のpostflight、GitHub Push、Vercel Deploy、LINE実機確認は未実施。したがって、本番反映の完了・本番検証済みとは扱わない。
