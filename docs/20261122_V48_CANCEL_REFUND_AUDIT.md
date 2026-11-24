# V48 キャンセル・返金経路監査（2026-11-22）

## 判定

**BLOCKED。** 既存のキャンセルRPCをそのままV48の新しい成立時課金へ接続して本番適用してはならない。今回の作業は静的ソース確認のみ。SQL実行、DB変更、build/test/lint/typecheck、ローカルチェックは行っていない。

## 確認した実装

- `20261122_001_application_participant_snapshot_and_trade_claims.sql`
  - イベント・レンタル初回料金は `event_match_fee:<request_id>` でrequest単位に徴収。
  - 同じキーのdebit行が残る限り、返金後の再成立でも初回料金は再徴収されない。この点は「初回料金once」と整合。
- `20261122_004_performance_reward_fee_at_match.sql`
  - `charge_event_match_transaction_fee_at_match` は `event_match_transaction_fee:<match_id>` で成立取引ごとの料金を追加徴収。
  - `accept_application_with_coins` と `accept_direct_invitation_atomic` の両方から呼ばれる。
  - 演奏案件の施設報酬手数料は成立時に `facility_reward_fee` として徴収し、`match_fee_snapshots` に保存。
  - `complete_match_with_fee` は `performance_reward` snapshotがある演奏案件について旧完了手数料を抑止するが、イベント／レンタルの旧完了手数料処理は残す。
- `20261116_013_cancel_reapply_and_direct_fee_refund.sql`
  - 個別キャンセルはmatchに結びついた直接依頼手数料を旧来のtransaction type/keyから探索して返金する。
  - 全体キャンセルは未完了matchを順にキャンセルし、イベント／レンタルの参加費・レンタル料手数料、直接依頼料、request単位初回match feeを別々に処理する旧ロジックを持つ。

## 重大な不整合・不足

1. **イベント／レンタルの成立取引ごとの100コインが個別キャンセル時に返金されない可能性。** V48.004の新しいdebitは `transaction_type='match_fee'`、key=`event_match_transaction_fee:<match_id>`。しかし個別キャンセルRPCのイベント分岐は `event_participation_fee`／`rental_match_fee` を検索し、`match_fee` を返金対象にしていない。request単位の初回料金とも別物なので、初回返金処理では補えない。
2. **全体キャンセルでV48.004の per-match `match_fee` が返金対象に含まれる保証がない。** 既存処理はイベント／レンタル分岐で通常match fee返金を無効化し、旧fee typeを検索する。新しいkey/typeとの対応がない。
3. **演奏報酬の成立時10% `facility_reward_fee` のキャンセル返金が見当たらない。** V48.004で成立時に課金するが、既存キャンセルRPCは直接依頼料・match fee・旧完了feeを主に扱い、新snapshotの `coin_transaction_id`／payer／amountを参照した返金処理がない。
4. **全体キャンセルの初回料金返金判定がrequest全体の完了済みmatch有無に依存。** これは旧ロジックのまま。初回料金の支払元・元debit・初回matchを明示して管理する専用source recordがなく、request内の別matchの完了状態で判定する。
5. **完了時イベント／レンタル手数料の設定・snapshotがV48新設定へ統合されていない。** `complete_match_with_fee` は `coin_rate_settings.completion_fee_percent` を参照し、`match_fee_snapshots` や成立時の `performance_reward_fee_percent`／`lesson_match_fee_percent` と独立している。旧1%処理が残るため、現行の意図と二重課金・率の取り違えが起きないか決定が必要。
6. **返金のsource transaction照合が不十分。** 旧処理はtransaction_type、user_id、request/application/match、idempotency key等を複数の分岐で検索するが、V48の新fee snapshotを一元的な元取引として照合していない。payer・金額・source transaction IDの完全一致と一回限り制約が必要。

## 修正設計（次の実装対象）

- `fee_charge_records` 等の統一台帳または既存snapshot拡張で、fee kind、request、application attempt、match、payer、debit transaction ID、amount、rate、currency conversion、charged timestampを不変保存する。
- event/rental initial feeはrequest単位の一意レコード、event/rental per-match feeとperformance reward feeはmatch単位の一意レコードとして分離する。
- refundはsource debit IDを必須参照し、payer・amount・type・business referenceを完全照合。source debitごとにrefundは最大1回。返金後の再成立でinitial feeを再徴収しない。
- cancellation RPCは初回料金・per-match fee・performance reward fee・direct invite feeを種類別に扱い、完了済みmatchやdispute状態に応じた確定ポリシーを明示する。
- completion feeは成立時snapshotに一本化するか、event/rentalについて完了時課金を維持するかを仕様決定してから移行する。二重経路を残したまま公開しない。
- 個別キャンセル／全体キャンセル／退会キャンセル／自動満員取消／再成立について、source debit→refund→retryのDBテストケースを用意する。

## 未実施

- 本番DBの関数定義・transaction ledger・snapshotデータのread-only照合
- migrationの追加・適用
- PostgreSQLでの構文／実行検証
- build、test、lint、typecheck、ローカルチェック
- Git push、Vercel deploy

## 2026-11-22 追加照合：返金RPCの具体的な分岐不整合

### A. 個別キャンセル `cancel_match_with_direct_invite_refund`

対象: `supabase/migrations/20261116_013_cancel_reapply_and_direct_fee_refund.sql`

- `v_match_fee_refund_amount` は `coin_transactions.match_id = v_match.id` かつ `transaction_type='match_fee'` から取得している。
- しかし `v_event` がtrueの分岐で `v_has_match_fee := false` に固定され、通常成立手数料返金ブロック（`IF NOT v_event AND v_has_match_fee`）から除外される。
- V48.004のイベント／レンタル成立取引課金はまさに `transaction_type='match_fee'`、key=`event_match_transaction_fee:<match_id>` であるため、個別キャンセル時にこのdebitが返金されない。
- さらに旧 `event_participation_fee`／`rental_match_fee` の返金ブロックは新しいdebit type/keyを参照しない。

### B. 全体キャンセル `cancel_event_request_with_refund_internal`

対象: 同 migration 内の同名関数。

- 未完了matchをループするが、イベント／レンタルの旧fee type（`event_participation_fee`／`rental_match_fee`）と直接依頼料を返金する構成。
- V48.004の `event_match_transaction_fee:<match_id>`（type=`match_fee`）をmatchごとに検索・返金する処理が存在しない。
- request単位初回料金は旧key `event_match_fee:<request_id>` で別に返金する。これはper-match debitとは別の料金であり、per-match返金の代替にはならない。

### C. 演奏報酬成立時手数料

対象: `20261122_004_performance_reward_fee_at_match.sql` と上記cancel RPC。

- `charge_performance_reward_fee_at_match` は `facility_reward_fee` debitと `match_fee_snapshots.coin_transaction_id` を作る。
- 個別・全体キャンセルRPCには、このsnapshotを起点に元debit ID、payer、amountを照合して返金する処理がない。
- 現時点で「未完了キャンセル時は10%を返金する／しない」の確定仕様がこのV48候補のDB契約から読み取れないため、返金を推測実装してはならない。

### D. 修正時の必須契約

1. イベント／レンタルの `match_fee` はmatch単位の元debitを特定し、`user_id`（施設owner）、`request_id`、`match_id`、transaction type、idempotency key、負額を照合して返金する。
2. request初回 `event_match_fee:<request_id>` は別管理を維持し、per-match feeと相殺・代用しない。
3. `facility_reward_fee` はユーザーが未完了キャンセル時の返金方針を確定するまで、返金コードを追加しない。
4. 返金処理はsource transaction IDを記録し、同じsource debitへのrefund unique制約を設ける。idempotency keyの存在確認だけでなく、既存refund行のpayer・amount・request・matchがsource debitと一致することを検証する。
5. 旧 `event_participation_fee`／`rental_match_fee` debitの互換返金は残し、新旧両方のdebitが同一matchに存在する場合に二重返金しないよう、source debitごとに独立して判定する。

**今回の判断:** 具体的な返金漏れをソース上で確定したが、refund policy未確定領域と元取引履歴の実DB照合なしに関数を差し替えるのは危険なため、SQL関数の変更は行わずBLOCKEDを維持する。
