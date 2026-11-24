# V48 共通返金RPC・実装契約と安全な切替順序（2026-11-22）

## 位置づけ

この文書は、返金元取引を一意に固定する共通RPCの実装契約と切替順序を定義する設計資料である。実行可能なmigrationではない。実DBの `coin_transactions` 定義・制約・trigger/RLS・既存返金データをV2 preflightで確認するまでは、DDL、backfill、RPC置換を作成・適用しない。

## 今回の追加ソース確認

### 1. 残高更新の実装方式

`supabase/migrations/20261116_009_global_mutation_gate.sql` の `spend_coins` は、先に `pg_advisory_xact_lock(2147483000, 20261116)` を取得し、冪等キーを確認した後、`users` 行を `FOR UPDATE` でロックする。残高不足・予約残高を確認し、`users.coin_balance` を更新してから `coin_transactions` に負数debitを追加する。

`spend_coins_legacy` も同じグローバルロックを取得し、残高更新とdebit INSERTを自前で行う。したがって返金RPCは `spend_coins` を呼んではならない（返金ではなく再度debitになる）。返金専用処理で、元debitから確定した額をユーザー残高へ加算し、同一トランザクションで正数の返金履歴をINSERTする。

### 2. 既存返金writerの弱点

`20261116_013_cancel_reapply_and_direct_fee_refund.sql` の個別キャンセル、直接依頼拒否、退会向け直接依頼拒否、および `20261122_001_application_participant_snapshot_and_trade_claims.sql` の自動却下返金は、返金時に `users.coin_balance` を加算して `admin_adjustment` をINSERTする。冪等キーや説明文による重複防止はあるが、返金行に元debitのIDを保持せず、DB制約で「1つの元debitにつき返金は最大1件」を保証していない。

### 3. 現在のロック順序に合わせる

新RPCは少なくとも以下を守る。

1. `pg_advisory_xact_lock(2147483000, 20261116)` を最初に取得する。
2. 元debitを `coin_transactions` から `FOR UPDATE` で取得する。
3. 元debitの `user_id` を支払者として確定し、`users` 行を `FOR UPDATE` で取得する。
4. 既存返金の有無を `source_transaction_id` で確認する。
5. `users.coin_balance` を元debitの絶対額だけ加算する。
6. 返金履歴を同一トランザクションでINSERTし、source IDの一意制約により二重返金を防ぐ。

全ての呼出元は、既存のグローバル更新ロックを取得したトランザクション内から呼ぶ。個別のadvisory lockを追加する場合も、グローバルロックより先に取得してはならない。DB側のstatement triggerやRLSがどのように設定されているかはV2 preflightの実測結果で再確認する。

## 共通RPCの候補契約

候補名：`public.refund_coin_transaction(p_source_transaction_id, p_reason_code, p_operation_key)`

- callerからpayer、返金額、transaction_type、request/application/match/band IDを受け取らない。全て元debit行から導出する。
- 元取引が存在し、`amount < 0` であることを必須とする。正数・ゼロ・存在しないsourceは返金不可。
- `p_reason_code` は呼出元が自由文を渡す方式にせず、確定済みの理由コードallowlistに制限する。
- 元debitの `user_id`、`transaction_type`、`request_id`、`application_id`、`match_id` 等の参照を返金行へ引き継ぐ。返金額は `-source.amount` とし、現行料金設定から再計算しない。
- sourceの `transaction_type` は明示的allowlistで検証する。ただし「返金可能なfee種別」と「そのライフサイクル状態で返金してよいか」は別判定とし、業務ルール未確定の費目は呼出元から実行しない。
- 返金行の `transaction_type` は、実DBのCHECK制約・集計仕様を確認するまでは新しい `refund` 値を仮定しない。現行互換で `admin_adjustment` を継続する場合も、source IDを必須にして通常の管理者調整と区別できるようにする。
- 返金済みsourceに対する同一リトライは既存返金行を返す。既に返金済みのsourceに別reason/operation keyを指定した場合は、2件目を作らず競合として返す。
- `p_operation_key` は監査・呼出元冪等性用であり、sourceの一意性を代替しない。source IDの一意制約を最終防衛線とする。
- `balance_after` は実際に加算した後の `users.coin_balance` を記録する。

## 必要なDB構造（実DB preflight後に確定）

実DBの列型と制約を確認してから、次の構造を検討する。

- `coin_transactions.source_transaction_id`：同じ `coin_transactions.id` の型。自己参照FKは `ON DELETE RESTRICT` を基本案とする。
- `source_transaction_id IS NOT NULL` の返金行を一件に制限するunique index。
- `source_transaction_id` は返金行だけに設定する。通常のdebit/creditにはNULLを許容する。
- 必要なら `refund_reason_code` 等を追加するが、現行description・transaction_type・管理画面集計との互換性を確認してから決める。
- sourceが同じユーザーの負数debitであること、refundが同一user・正数・同額・同一business referencesであることをRPC内で検証する。DB CHECKだけでは別行との比較ができないため、RPCとunique制約の両方で保証する。

## 既存データbackfill方針

- 既存の正数 `admin_adjustment` を説明文・金額だけでsourceへ紐付けない。
- payer、amount、transaction_type、request/application/match、冪等キー、時刻を照合し、元debit候補が完全一致で一件に確定する場合のみbackfill候補とする。
- 候補が0件または複数件、支払者不一致、金額不一致、参照ID不一致の場合は自動backfillしない。隔離一覧として出力し、人手確認を必要とする。
- 既存返金の重複候補がある状態でunique indexを作成しない。preflightで重複を解消または隔離した後にのみ作成する。

## 呼出元の切替順序

1. **read-only確認**：V2 preflightで実DBのledger列・型・制約・index・trigger/RLS、関連RPC、既存debit/refund候補、snapshot整合を取得する。
2. **source列・制約**：preflight結果に一致する型でsource列/FK/unique indexを追加。既存返金は安全に特定できる行だけbackfill。
3. **共通RPC追加**：source行と支払者のロック、元取引検証、残高加算、返金行追加を原子的に実装。関数権限はservice_role等の必要な内部呼出元だけに限定。
4. **新規writerの切替**：直接依頼拒否・自動却下・退会返金など、返金可否が既に確定しているwriterから一つずつ共通RPCへ移行する。
5. **matchキャンセル**：通常match fee、イベント／レンタルper-match fee、facility reward feeをsource IDで返金する。ただし応募手数料の返金可否とイベント初回料金の返金単位は別途確定後に接続する。
6. **request全体キャンセル／退会**：match単位feeとrequest単位初回feeを別sourceとして処理し、request-wide completed flagを返金元の代用にしない。
7. **lesson**：`lesson_fee_snapshots.coin_transaction_id` をsourceとして扱えるようにし、レッスン成立後キャンセル・退会時の返金方針確定後に接続する。
8. **completion/dispute**：完了済み・紛争中・紛争成立時の返金可否が確定してから接続する。未完了キャンセルのルールを流用しない。
9. **postflight**：sourceごとの返金件数が最大1、payer/amount/type/referenceが一致、二重返金0、未返金候補が明示的に分類済みであることを確認する。

## 業務判断（2026-11-24時点）

以下はユーザー承認済みとして実装条件に固定する。

- `facility_reward_fee`：演奏実施前のキャンセル時は、施設の元支払者へ元徴収額全額を返金する。完了済み取引には適用しない。
- `lesson_match_fee`：レッスン実施前のキャンセル時は、演奏者／講師の元支払者へ元徴収額全額を返金する。完了済み取引には適用しない。
- 返金元は実際の負数debit行IDで固定し、payer・amount・transaction_type・全business referenceを検証する。残高加算と返金ledger INSERTは同一transactionで行い、source IDのDB一意制約で二重返金を防ぐ。
- イベント／レンタル初回料金はrequest単位once-only。キャンセル・返金後に再マッチしても初回料金を再徴収しない。成立ごとの料金は別sourceとして扱う。
- イベント／レンタルの成立時課金と旧完了時課金は二重徴収させない。旧completion fee経路は実DB定義を確認してから無効化・分離する。
- 退会時、演奏者の既成立案件を自動キャンセルしない。相手施設へ通知し、施設側が判断する。施設退会時の成立案件処理は別途既定のキャンセル・返金処理を維持する。
- バンドリーダー退会時はバンドを解散せず、有効メンバーのうち加入日時が最も古いメンバーへリーダー権限を引き継ぐ。
- 応募手数料・紛争成立時・完了後の返金は、上記の承認範囲に含めず、勝手に返金対象へ拡張しない。

## 実装前に残る技術確認

- 本番の完全なRPC定義、アプリmigration ledger、`coin_transactions`制約／trigger／RLS、およびband membershipの加入日時列を取得する。
- 既存返金行のsource候補を照合し、完全一致で一意に確定できない行はbackfillしない。

## 今回の変更範囲

- 追加したのは設計・実装順序文書のみ。
- SQL関数、migration、DBデータ、アプリケーションコードは変更していない。
- 実DBへの接続・SQL実行、build/test/lint/typecheck/ローカルチェック、Push、Deployは未実施。
- 返金仕様の未確定項目と実DB preflight未実施が残るため、V48公開判定はBLOCKEDのままとする。
