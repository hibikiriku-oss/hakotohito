# V48 返金writer全件インベントリ（2026-11-22）

## 目的・調査範囲

V48候補ツリー内のSupabase migrationを静的検索し、`users.coin_balance` の加算と `coin_transactions` への正数履歴INSERTを行う返金writerを整理した。実DBの現行定義を取得したものではなく、migration適用順を前提にしたソース上の調査である。migration履歴に同一RPCの旧定義・再定義があるため、同じ機能の重複記載は「旧定義／後続定義」として区別する。

## 現行候補で把握できた返金writer

| 機能・呼出契機 | ソース位置 | 対象debit | 現在の返金記録 | 共通RPC移行上の論点 |
|---|---|---|---|---|
| 採用時に他の未承認直接依頼を自動却下 | `20261122_001_application_participant_snapshot_and_trade_claims.sql` の `accept_application_with_coins`（約849行） | `direct_invite_fee`。request/application/performerと冪等キーで検索 | `admin_adjustment`、`direct_invite_refund:<application_id>` | 元debitのIDを取得しているが返金行にsource IDを保存しない。共通RPCへ移行しやすい候補 |
| 個別マッチング取消：直接依頼送信料 | `20261116_013_cancel_reapply_and_direct_fee_refund.sql` の `cancel_match_with_direct_invite_refund`（約300行） | 直接依頼debit | `admin_adjustment`、match単位のrefund key | 元debit IDが返金処理に渡されず、支払者・金額を別途組み立てる。イベント／レンタル分岐との整理が必要 |
| 個別マッチング取消：通常成立手数料 | 同上（約340行） | 施設負担 `match_fee` | `admin_adjustment`、`match_fee_refund:<match_id>` 等 | match単位の返金writerあり。ただしsource debitとの一意な関連付けなし |
| 個別マッチング取消：イベント／レンタル参加・レンタル料金 | 同上（約390行） | 旧 `event_participation_fee` / `rental_match_fee` | `admin_adjustment`、match単位refund key | V48.004の新 `event_match_transaction_fee:<match_id>`（transaction_type=`match_fee`）を検索していない。新料金の返金漏れ候補 |
| 直接依頼の辞退 | 同上の `reject_direct_invitation_with_refund`（約702行） | 施設負担 `direct_invite_fee` | `admin_adjustment`、`direct_invite_refund:<application_id>` | 元debitを特定して金額を取得するがsource IDを保持しない |
| 退会に伴う直接依頼拒否 | 同上の `reject_direct_invitation_with_refund_for_withdrawal`（約917行） | 施設負担 `direct_invite_fee` | `admin_adjustment`、直接依頼退会返金key | 上記と同じ。withdrawalからの呼出し順・二重呼出しも共通RPC切替時に確認 |
| イベント／レンタル案件全体キャンセル：成立済みmatchのfee | 同上の `cancel_event_request_with_refund_internal`（約1135行） | 旧イベント／レンタルmatch fee | `admin_adjustment`、match単位refund key | V48.004の新per-match `match_fee` と `facility_reward_fee` を未参照 |
| イベント／レンタル案件全体キャンセル：成立済み直接依頼料 | 同上（約1250行・1370行） | `direct_invite_fee` | `admin_adjustment`、application/match単位key | 返金元IDなし。複数経路で同じdebitに対する重複防止を共有していない |
| イベント／レンタル案件全体キャンセル：未使用の初回料金 | 同上（約1450行） | `event_match_fee:<request_id>` | `admin_adjustment`、`event_match_refund:<request_id>` | once-only課金の履歴を残す設計。返金後も再徴収しない仕様と矛盾しないよう、初回debitの状態管理が必要 |

## 返金ではないが、共通台帳設計に含める課金writer

- `20261122_004_performance_reward_fee_at_match.sql`：`charge_performance_reward_fee_at_match` が施設負担 `facility_reward_fee` を課金し、`match_fee_snapshots.coin_transaction_id` に元debit IDを保存する。現行cancel RPCはこのsnapshotを返金に利用していない。
- `20261122_004_performance_reward_fee_at_match.sql`：`charge_event_match_transaction_fee_at_match` がイベント／レンタルのmatchごとに `match_fee` を課金する。既存の個別・全体cancel writerがこの新しいidempotency keyを探していない。
- `20261122_005_lesson_match_fee_snapshots_and_no_holds.sql`：`apply_to_lesson_offer` が `lesson_match_fee` を課金し、`lesson_fee_snapshots.coin_transaction_id` に元debit IDを保存する。レッスン取消・退会の返金writerは本候補ツリーで確認できていない。
- `20261122_001_application_participant_snapshot_and_trade_claims.sql`：採用時の演奏者／バンドリーダー負担 `application_match_fee` は応募attemptの保存額を課金する。cancel RPCの明示的返金writerは確認できていない。
- `20261122_004_performance_reward_fee_at_match.sql` の `complete_match_with_fee` は完了時feeの課金writerであり返金writerではない。performance reward snapshotがある場合の旧completion fee抑止、イベント／レンタル旧completion feeとの重複可能性は別途業務仕様確認が必要。

## 返金に見えても共通返金RPCへ流してはいけない処理

- `admin_grant_coins` 等の管理者による通常コイン付与は、source debitに対する返金ではない。正数 `admin_adjustment` というtransaction_typeだけで返金扱いしてはならない。
- Stripe決済の返金・dispute incident（`20261118_006_ordered_stripe_payment_incidents.sql` 等）は、決済プロバイダ側の入金／返金管理であり、コイン台帳上のfee debit返金とは別系統。対象ユーザーのコインを自動加算する根拠にしない。
- 旧migration `20261116_009_global_mutation_gate.sql` 内にも、後続migrationで再定義されるキャンセル・退会関数のコピーが存在する。移行対象はmigration履歴内の全コピーではなく、実DBの現行 `pg_get_functiondef` と適用順で確定する。

## 優先順位（仕様確定後）

1. **比較的明確な既存返金**：直接依頼の自動却下、直接依頼の辞退、退会時の未成立直接依頼返金。まずsource IDの取得・保存と共通RPC化を行う。
2. **既存返金だが新課金との不整合あり**：通常match fee、イベント／レンタルの旧match fee、直接依頼料。新V48課金キーと旧fee typeを区別してsource単位に統合する。
3. **業務判断待ち**：応募手数料、facility reward fee、lesson fee、イベント／レンタル初回fee、完了fee／紛争時の扱い。返金writerを追加しない。
4. **退会・全体キャンセルの横断整合**：個別cancelと同一sourceが重複処理されないこと、request単位初回feeとmatch単位feeを混ぜないことを検証する。

## 追加の安全条件

- 共通RPC自体が最初に既存global mutation gate `pg_advisory_xact_lock(2147483000, 20261116)` を取得する。呼出元が先に別のadvisory lockやユーザー行ロックを取得していると、ロック順序逆転の可能性があるため、全呼出元の順序を確認する。
- source debitを `FOR UPDATE` でロックし、同一ユーザーの `users` 行をロックしてから残高を加算する。返金行はsource IDのunique制約で一件に制限する。
- 返金RPCのallowlistはfee種別だけでなく、呼出理由・対象状態・キャンセル経路も含める。理由コードだけ渡せばどのdebitでも返金できる設計にはしない。
- `balance_after` と残高を更新するtrigger/RLSの実DB設定はpreflightで確認する。source FK／unique indexの追加前に既存データの曖昧・重複候補を解消する。

## 実施状況

- 実施：migrationソースの静的検索、返金writer・課金writer・非返金の正数調整の分類。
- 未実施：実DBの関数定義確認、read-only preflight実行、DDL作成・適用、返金RPC実装、既存データbackfill、build/test/lint/typecheck/ローカルチェック、Push、Deploy。
- 公開判定：BLOCKED。返金可否の業務判断と実DB preflightが未完了。
