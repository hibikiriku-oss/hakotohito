# V48 返金元取引契約（2026-11-22）

## 目的

キャンセル時の返金を「案件種別」「現在の応募行」「施設ユーザーID」から推測せず、成立時に実際に発生した課金取引を唯一の返金元として扱う。今回の文書は修正設計とリリースゲートであり、DB関数を置き換えたものではない。

## 課金種別と返金単位

| 課金 | 課金キー | 返金単位 | 現行キャンセル関数の状態 |
|---|---|---|---|
| イベント・レンタル初回料金 | `event_match_fee:<request_id>` | requestにつき一度 | 全体キャンセルで返金する旧処理あり。完了matchのrequest-wide判定に依存 |
| イベント・レンタル成立ごとの通常料金 | `event_match_transaction_fee:<match_id>` | matchごと | 個別・全体キャンセルのどちらも未接続 |
| 演奏案件成立時報酬手数料 | `performance_reward_fee_match:<match_id>` | matchごと | 個別・全体キャンセルのどちらも未接続 |
| 直接依頼送信手数料（旧方式） | `direct_invite_fee:<request_id>:<performer_id>` | 実際の課金行／応募試行 | 既存返金あり。ただし旧・新方式が混在 |
| レッスン成立時手数料 | `lesson_match_fee:<lesson_application_id>` | lesson_applicationごと | lessonキャンセル／返金仕様とRPCが未統合 |

## 返金の必須契約

1. 返金元は `coin_transactions.id` で一意に固定する。現行の `coin_transactions` にsource transaction FKがない場合、追加migrationで `source_transaction_id` を追加し、同じ元取引に対する返金をDB unique制約で一度に制限する。
2. 返金行は元取引と同じ `user_id`（支払者）、逆符号の同額、同じrequest/application/match/bandの参照を持つ。金額を現在の設定から再計算しない。
3. source debitの `transaction_type` と `idempotency_key` を検証する。キーだけ、または `match_id` だけの一致では返金しない。
4. 返金処理は元debitの行ロック、支払者残高の行ロック、refund insert、残高更新を同一transactionで行う。既に同じsourceに返金済みなら同じ結果を返す。異なるpayloadの再試行はエラーにする。
5. 初回料金とmatchごとの料金は別sourceである。request単位の初回料金をmatchごとに返金したり、match単位料金をrequest全体の一括返金キーでまとめたりしない。
6. 完了済みmatchの有無をrequest全体のフラグで初回料金返金の根拠にしない。初回料金のsource debitと、初回に紐づくmatch/attemptを記録し、当該sourceに対する返金可否を個別判定する。
7. 完了後の返金可否、異議申立て成立時の返金可否は別途確定した業務ルールを適用する。未完了キャンセルの返金処理から推測しない。

## 現行ソースで確認した不整合

- `20261122_004_performance_reward_fee_at_match.sql` の `charge_event_match_transaction_fee_at_match` はイベント・レンタル各matchについて `match_fee` debitを作る。しかし `20261116_013_cancel_reapply_and_direct_fee_refund.sql` の個別キャンセルはイベント種別の場合 `v_has_match_fee := false` とし、`rental_match_fee` / `event_participation_fee` だけを検索するため、新しい `match_fee` debitを返金しない。
- 同じ全体キャンセルRPCも `rental_match_fee` / `event_participation_fee` のみをmatch単位返金し、新しい `event_match_transaction_fee:<match_id>` debitを参照しない。
- `charge_performance_reward_fee_at_match` は `facility_reward_fee` をmatch単位で徴収し `match_fee_snapshots.coin_transaction_id` に保存するが、個別・全体キャンセルRPCはsnapshotもsource debitも参照しない。
- 初回料金 `event_match_fee:<request_id>` は全体キャンセルで旧来の `v_has_completed_match`（request内の完了match有無）に基づき返金を抑止する。これは初回debit自体とのsource照合ではなく、複数matchがある場合に誤判定し得る。
- `complete_match_with_fee` は `performance_reward` snapshotが存在する場合、旧完了手数料を抑止する。一方、イベント・レンタルの `rental_match_fee` / `event_participation_fee` 完了手数料経路は残っている。成立時match feeとの重複・課金対象を確定し、旧処理を無効化または明確に分離する必要がある。
- 現行返金は多くの箇所で `admin_adjustment` と独自idempotency keyを使い、元debit IDへのFK/unique制約がない。支払者・金額・参照IDを複合条件で検索する方式では、重複debitや履歴再利用時に曖昧さが残る。

## 次の実装順序

1. 実DBの `coin_transactions` 全列、unique index、既存課金キー、全返金writerをread-onlyで照合する。
2. `source_transaction_id` と返金一意制約を追加するmigrationを設計する。既存返金は、元debit候補が完全一致で一件に確定するものだけbackfillし、それ以外は自動推定せず隔離する。
3. `refund_coin_transaction(source_transaction_id, reason, operation_key)` 共通内部関数を作り、支払者・額・種別・全business referenceを元debitから導出する。callerからpayer/amountを受け取らない。
4. 個別キャンセル、全体キャンセル、退会キャンセル、直接依頼拒否をこの内部関数へ接続する。
5. completion/disputeの返金ポリシーを確定してから接続する。
6. preflightで未返金候補・重複返金・支払者不一致・金額不一致がゼロまたは明示的隔離済みであることを確認し、postflightでsourceごとの返金一意性を確認する。

## 変更していないこと

この文書作成時点で、SQL関数・DBデータ・本番環境は変更していない。build/test/lint/typecheck/ローカルチェック、DB適用、Push、Deployも実施していない。
