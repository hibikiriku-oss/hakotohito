# V48 返金ライフサイクル照合表（2026-11-22）

## 対象と前提

V48候補の以下の関数定義を静的に照合した。実DBの適用状態・実データは未確認であり、この文書は本番DBの現状を断定するものではない。

- `cancel_match_with_direct_invite_refund(uuid, uuid)` — `20261116_013_cancel_reapply_and_direct_fee_refund.sql`
- `cancel_event_request_with_refund_internal(uuid, uuid, boolean)` — 同migration
- `reject_direct_invitation_with_refund(uuid, uuid)` / `reject_direct_invitation_with_refund_for_withdrawal(uuid, uuid)` — 同migration
- `accept_application_with_coins(uuid, uuid, uuid)` — `20261122_001` と `20261122_004`
- `charge_event_match_transaction_fee_at_match(uuid)` / `charge_performance_reward_fee_at_match(uuid)` — `20261122_004`
- `complete_match_with_fee(uuid, text)` — `20261122_004`
- `withdraw_user_account(text)` — 後続のwithdrawal migration群

## 課金元と返金経路の照合

| 課金元 | 課金時点・キー | 個別match cancel | request全体cancel | direct invite reject / auto-reject | withdrawal | 判定 |
|---|---|---|---|---|---|---|
| 応募手数料 | 成立時 `application_match_fee:<attempt_id>` | 個別cancel関数内に明示的な返金writerを確認できない | event/rentalの全体cancel内に応募手数料返金writerを確認できない | 該当なし | match cancel経由。応募手数料返金は未確認 | 未接続／仕様確認 |
| 通常match fee | 成立時 `match_fee_attempt:<attempt_id>`（通常performance） | `match_fee` debitをmatch_id＋施設payerで検索し、`match_fee_refund:<match_id>` で返金 | event/rental専用関数のため対象外 | 該当なし | match cancel経由 | 既存返金あり。ただし元debit ID参照・source unique制約なし |
| イベント／レンタル初回料金 | 初回成立時 `event_match_fee:<request_id>` | match単位cancelからは返金しない | `event_match_refund:<request_id>` で返金。request内のcompleted match有無をgateに利用 | 該当なし | `allow_closed`経由。completed match有無による扱いに依存 | request単位onceは保持されるが、source match/debit単位の判定でない |
| イベント／レンタル成立ごとの通常料金 | 各成立時 `event_match_transaction_fee:<match_id>`、`transaction_type='match_fee'` | イベント分岐で `v_has_match_fee=false` とするため対象外 | 旧 `rental_match_fee` / `event_participation_fee` のみ検索するため対象外 | 該当なし | 全体cancel経由でも対象外 | **未返金** |
| 演奏報酬手数料 | 成立時 `performance_reward_fee_match:<match_id>`、`facility_reward_fee`。snapshotにtransaction ID保存 | snapshot/debitを参照しない | snapshot/debitを参照しない | 該当なし | cancel経由でも未接続 | **未返金。返金方針自体も要確定** |
| 直接依頼送信料 | 旧 `direct_invite_fee:<request>:<performer>`／attempt単位キー | 既存返金処理あり | 既存返金処理あり | reject/withdrawal rejectに既存返金処理あり | 退会処理に既存返金経路あり | 返金writerは存在。ただしsource transaction IDでの一意な連結なし |
| レッスン成立時手数料 | `lesson_match_fee:<lesson_application_id>` | lesson cancel RPCとの接続未確認 | 該当なし | 該当なし | lesson withdrawal/cancelとの接続未確認 | **未統合** |

## 追加で確認した課金・完了処理

1. `20261122_001` の応募採用RPCは、応募試行に保存された `fee_amount` を `application_match_fee:<attempt_id>` で成立時徴収する。
2. 同RPCはイベント／レンタルの初回料金を `event_match_fee:<request_id>` でrequestにつき一度徴収する。返金後も元debitが台帳に残る限り、このキーの存在判定で再徴収を防ぐ構造。
3. `20261122_004` はイベント／レンタルの各matchについて別の `event_match_transaction_fee:<match_id>` を追加徴収する。初回料金とは別課金である。
4. `20261122_004` は演奏案件の `facility_reward_fee` を成立時徴収し、`match_fee_snapshots.coin_transaction_id` に元debit IDを保存する。現行cancel RPCはそのIDを参照しない。
5. `complete_match_with_fee` は演奏案件snapshotがある場合に旧完了手数料を抑止する。一方、イベント／レンタルの `rental_match_fee`／`event_participation_fee` 完了時処理は残る。これらが成立時の固定料金と別サービス料として併存するのか、どちらかへ置換するのかは業務仕様の最終確認が必要。ソースだけから二重課金と断定しない。
6. `match_fee_snapshots` は `match_id` に紐づくが `application_attempt_id` を持たない。応募行再利用後の履歴・payer provenanceを厳密に保持するには、attempt IDとの結び付けが必要。

## 実装前に必要な決定・停止条件

- `facility_reward_fee`：未完了キャンセル時に返金するか、完了済み・dispute成立時に返金するかをそれぞれ確定する。未確定のまま自動返金しない。
- `application_fee`：個別キャンセル・全体キャンセル・退会キャンセルで返金するかを確定する。既存方針との整合を確認する。
- event/rental completion fee：成立ごとの固定料金と完了時の参加費／レンタル料手数料の適用範囲・率・課金時点を確定する。
- lesson fee：レッスン取消・講師退会・受講者退会・講師都合キャンセルそれぞれの返金条件を確定する。
- 既存返金行：候補元debitのpayer・amount・transaction_type・request/application/match/attempt/band・idempotency keyが一意に一致しないものはbackfillしない。
- `source_transaction_id` の追加前に、V2 preflightで実DBの列型・constraint・index・trigger・RLS・全writerを確認する。append-only triggerや既存unique制約との競合があればmigrationを停止する。

## 実施していないこと

この監査は静的ソースレビューのみ。DBへの接続・SQL実行・DDL/DML、RPC差し替え、build/test/lint/typecheck/ローカルチェック、Push、Deployは行っていない。

**判定：BLOCKED。** 返金writerの存在だけではsource-levelの返金完全性を保証できない。source transaction IDの一意制約と全writer cutoverが完了するまで公開不可。
