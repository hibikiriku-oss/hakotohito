# Hakotohito 統合修正・監査台帳（2026-11-14）

## 目的・運用ルール

この台帳を今回以降の統合修正の正本とし、既存監査を最初から繰り返さない。各項目は「確認済み事実」「未確定事項」「実装条件」「適用判定」を分離する。新しい証拠が出た場合は該当項目だけを更新し、既存の確認済み事実は再監査対象に戻さない。

**変更境界：** 本パッケージ内の候補ソース・SQL・文書のみ。実DB、実リポジトリ、GitHub、Vercelは変更しない。build／lint／test／typecheck／ローカルチェックも実施しない。

## 1. 現在の適用判定

| Migration | 対象 | 判定 | 適用を止めている条件 |
|---|---|---|---|
| 004 | Stripe coin purchase基盤 | 現行DB差分不明のため保留 | 既存Stripeテーブル／RPCがあるDBへの新規基盤migrationとしての再適用禁止。現行定義・履歴とのdiffが必要 |
| 005 | Stripe webhook atomic claim | BLOCKED | claim tokenがWebhookイベント行の状態だけをfenceし、order／Payment Intent／incident等の業務副作用をfenceしない。既存CHECKがあれば安全側preflightで停止 |
| 006 | dual-role退会・未承認直接依頼返金 | BLOCKED | user／match先行ロックと既存cancel helperのrequest先行ロックが循環。通知outbox未統合。退会の複数domain横断gateが未設計 |
| 007 | event cancel notification targets | BLOCKED | 通知対象のDB確定結果との原子的一致、永続outbox／再送、共通ロック契約が未完了 |
| 008 | Stripe balance overflow paid_review | BLOCKED | 005のfencingと注文／incidentの原子処理が先行条件。事故再オープン・残高更新との整合も未確定 |

## 2. 監査で確認済みの事実（再調査不要。新証拠がある場合のみ更新）

### 2.1 ロック順序・競合

- `complete_match_with_fee`はmatch→request順、キャンセル系はrequest→match順。両方の行ロックを保持する同時実行で循環が成立し得る。
- 006候補の`withdraw_user_account`はuser／profile／matchを先にロックしてから既存キャンセルRPCへ進む。通常キャンセルとのmatch→request／request→match循環が成立し得る。
- `apply_to_performance_request_as_band`はuser行をロック後に`spend_coins`のidempotency advisory lockへ進む経路があり、idempotency→userの経路と逆転。
- `reject_direct_invitation_with_refund`および退会用helperはuser行をapplication／返金keyより先にロックする。
- `cancel_match_with_direct_invite_refund`と`cancel_event_request_with_refund_internal`はmatch／applicationより先に施設userをロックする。
- `respond_to_band_invitation`はuser→band、`transfer_band_coins`等はband→userの順序を持つ。
- `apply_to_lesson_offer`／`update_lesson_offer_with_levels`はoffer→teacher user。退会はuser→offer更新を行う。
- よってrequest単独gateや各関数先頭への単純gate追加では全体解決にならない。

### 2.2 APIのDB直接更新

- 施設／演奏者の完了報告APIは`matches`を直接更新する。
- performance request編集／削除APIは`performance_requests`を直接更新／削除する。
- Stripe Webhookはpayment order更新、incident upsert等を複数の直接DB要求に分けている。
- Stripe購入開始処理はStripe外部APIとDB保存をまたぐため、長時間DB transaction化せず状態遷移をCAS/RPC化する必要がある。
- profile更新は複数PostgREST要求に分かれ、退会との競合・片側だけ成功の可能性がある。

### 2.3 Trigger／Cron／外部実行

- 提供済みschema dump内で確認したtriggerは`trg_prevent_disputed_match_cancellation`と`users_initial_coin_balance`。
- `vercel.json`のCronは`/api/cron/auto-complete`。状態更新は`complete_match_with_fee` RPCに委譲。
- 提出ソースにSupabase Edge Functionsは含まれず、dumpにpg_cron job定義はない。不存在とは断定しない。対象環境からの追加証拠待ち。

### 2.4 005／006／007の安全側変更

- 005は`processing_status`を含む既存CHECK制約を一括DROPしない。既存CHECKが存在すればpreflightで停止する。未知／NULL statusも停止する。
- 006／007のSECURITY DEFINER候補は`search_path = pg_catalog, public, pg_temp`へ変更済み。ただしowner、EXECUTE ACL、public CREATE権限、非修飾参照の確認は未完了。

## 3. 統合実装の順序（依存関係）

### Phase A：完全な書込経路の証拠固定

1. DBから全mutation routine定義、owner、EXECUTE ACL、trigger、default privilegesを取得。
2. Edge Functions、pg_cron、Vercel Cron、外部scheduler、service_role直SQLの実行経路を取得。
3. APIの直接insert/update/upsert/deleteを、対象aggregateと呼出RPCに対応付ける。
4. 既存Stripe schema／migration履歴／CHECK制約／status実データを照合する。

**完了条件：** 書込経路ごとに入口、内部helper、対象aggregate、idempotency key、行ロック、通知副作用が特定され、未確認経路が明記されている。

### Phase B：共通排他契約

1. account、performance request、band、lesson offer、payment order等のaggregate gateを設計する。
2. gateのドメイン順位とIDソート規則を定義し、複数aggregate処理は全gate取得後に対象集合を再検証する。
3. 行ロック階層とテーブル順位／主キー順を定義する。
4. wrapper operation key、coin/refund key、band transfer key、Stripe event tokenの順序と責務を定義する。
5. public RPCはgate取得を担い、内部helperはgate取得済み契約とする。内部helperから下位処理後にgateを後取りしない。
6. API直接更新は同じ契約を通るRPC/CASへ移行する。

**禁止：** 全経路を切り替える前にgateだけを部分導入すること。退会だけ先行修正すること。単にuser行ロックを外して競合検証を省くこと。

### Phase C：通知Outbox

- outbox行は業務状態変更／返金台帳と同一DB transactionで作成する。
- 一意キーは少なくとも`event_type + aggregate_id + recipient_id`を含める。同一aggregate・同一recipientに複数通知種別があるケースはevent_typeで分離。
- workerは`FOR UPDATE SKIP LOCKED`等でclaimし、attempt_count／next_attempt_at／last_error／sent_atを管理。
- LINE送信成功後にsentへ更新する。送信成功直後のworker crashでは重複送信し得るため、at-least-onceを前提に通知ID・重複許容方針を決める。
- 退会前に取得したLINE宛先IDをoutboxに保持する場合、権限・暗号化／マスキング・保存期間・削除方針を明記。

**完了条件：** 退会／個別キャンセル／全体キャンセル／完了／直接依頼返金の通知が、DBで確定した実際の状態変更と一致し、失敗時に再送できる。

### Phase D：Stripe fencing

- claim tokenを業務RPCへ渡す。
- 業務RPC内でWebhook event rowをロックし、token一致を検証してからorder／incident／ledgerを同一transactionで更新する。
- 外部Stripe API取得後はDB副作用直前にtokenを再検証する。
- order単位の排他順を全Webhook／購入開始／管理者事故処理で共有する。
- stale workerはtoken不一致で業務副作用を実行できないことを受入条件とする。

### Phase E：統合検証・適用準備

- migration preflight／postflightを対象DBの現行定義に合わせて生成する。
- rollback条件と復旧手順を明記する。
- 同時実行シナリオ（完了対キャンセル、退会対band transfer、退会対lesson application、Webhook stale worker対新worker等）をテストDBで検証。
- 006／007／005／008の依存順・実行順を確定する。

## 4. 再監査を避けるための更新ルール

- 既知所見は上記2章を参照し、同じ関数本文を再度一から監査しない。
- 新しいDB export／APIソースが提供されたら、差分ファイル・関数・書込経路のみ再確認する。
- 修正後は「変更した行」「変更理由」「既存契約への影響」「対応する既知所見ID」「残る未確認事項」を記録する。
- migrationを安全に部分適用できない場合は、コードを無理に変更せず、preflightでfail-closedとし、適用条件を記録する。

## 5. 次回作業の優先順位

1. 現行DBからの追加証拠SQL（mutation routine／owner／ACL／trigger／pg_cron）を、テスト環境で安全に取得するための最小クエリ単位に整理する。
2. Stripe 005の現行CHECK／status互換性を確認する証拠項目を固定する。
3. API直接更新のRPC移行インターフェースを一覧化する。
4. Phase B〜Dの契約が固まるまで、危険な横断migrationの実装を保留する。

**総合判定：BLOCKED。** 本台帳は統合実装の作業基準であり、SQL適用・本番公開・Push・Deployの承認ではない。

## 2026-11-15 追加証拠・修正

### 新しい確認済み事実

- Tokyo DBの読み取り専用snapshot（2026-11-15 10:00 JST）：public routine 37件、SECURITY DEFINER 35件、routine ownerは全件postgres、public trigger 2件、default privileges 24項目、Stripe constraints 24項目。
- `cron.job` relationは取得結果上false。これだけでpg_cron extension・外部schedulerの不存在は断定しない。
- `stripe_webhook_events_processing_status_check`は`received / processed / ignored / failed`のみ許可。候補005の`processing`追加とは不整合であり、fail-closed preflightで停止する対象。
- `apply_to_performance_request`は既存applicationが`rejected`なら`is_reapply=true`として`pending`へ戻す。`apply_to_performance_request_as_band`も既存応募行を再利用する。
- 現行`cancel_match_with_direct_invite_refund`はmatchをcancelするが、対象applicationを`rejected`へ戻す処理がない。`20261112_001_known_audit_fixes.sql`候補にはその更新が含まれる。

### 追加修正

- `src/app/api/performers/route.ts`が`user_id`をレスポンスから除外し、施設側検索画面のお気に入り登録が`undefined`を送信する不整合を修正。
- LINE ID tokenで認証した呼出ユーザーの`user_type`を確認し、`user_type === 'facility'`の場合だけ演奏者一覧レスポンスに`user_id`を含める。施設以外の呼出しには内部IDを返さない。
- 個別キャンセル後の再応募仕様を訂正。ユーザーが事前に確定した仕様は、applicationを`rejected`へ戻し、同一演奏者がrequestが`open`なら再応募可能。2026-11-14候補の再応募禁止記述はユーザーによる変更確認が取れていないため採用しない。バンド再応募の独立仕様は未確認であり、禁止条件を追加しない。

### 適用判定・制約

- お気に入り修正は作業用パッケージのみ。LINE実機再確認は未実施。
- applicationを`rejected`へ戻すDB差分は必要だが、共通ロック順序・API直接更新・Outboxの統合と同時に対象DB差分を作る。単独でmigrationを適用しない。
- 既知のロック循環、通知Outbox不足、API直接更新、Stripe業務副作用fencingは未解決。公開判定はBLOCKED。
- DB、実リポジトリ、GitHub、Vercelは未変更。build／lint／test／typecheck／ローカルチェックは未実施。
