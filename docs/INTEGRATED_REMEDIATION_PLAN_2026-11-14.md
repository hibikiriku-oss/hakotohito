# Hakotohito 統合修正計画（2026-11-14）

## 成果物の分離

1. **統合修正版ソース**：API、UI、認証、決済、キャンセル、退会、通知の契約を一貫させたソース一式。
2. **DB適用用SQL**：既存DBとの差分を前提に、適用前確認・適用SQL・適用後確認・ロールバックを分離したSQL一式。

この文書と作業用コピーは候補であり、GitHub・Vercel・Supabaseへ反映済みではない。

## 確定済みの業務仕様

- 案件全体キャンセル：request statusを`closed`にし、同じ案件IDへの新規応募を不可とする。再募集は新規案件ID。
- 個別マッチングキャンセル：関連application statusを`rejected`にし、同じ演奏者はrequestが`open`なら同じ案件へ再応募可能。他の応募者も既存の応募条件を満たせば応募可能。バンド応募についてはTokyo現行関数が再応募行を再利用するが、独立した仕様確認は未取得。
- イベント／レンタル初回料金：同一request IDにつき一度だけ。キャンセル返金後に再成立しても再請求しない。新規request IDは別案件として扱う。
- 直接依頼退会返金：演奏者・施設どちらの退会でも、未成立依頼の実際の徴収額を元の施設ユーザーへ冪等返金する。

## 作業用コピーへ反映した修正候補

### Stripe残高上限超過

`supabase/migrations/20261113_004_stripe_coin_purchase_only.sql`（新規基盤用）
`supabase/migrations/20261114_008_stripe_balance_overflow_paid_review.sql`（既存DB向け差分）

- 残高上限超過を通常失敗にせず、注文を`paid_review`へ遷移。
- `balance_overflow`の事故記録を作成し、購入コインは加算しない。
- 既存の管理者事故一覧・対応履歴UIで確認できるデータ形状に合わせる。

### 全体キャンセル通知対象

- `20261114_007_event_cancel_notification_targets.sql`でDB RPCが実際にキャンセルしたmatch IDを返す。
- APIはRPC成功後にそのIDだけを再取得し、個人・バンドの全参加者を通知対象にする。
- 未承認直接依頼の返金通知は別通知として保持し、同一LINE IDへのマッチング通知によって抑止しない。

### Stripe Webhook排他claim

- 新規候補：`supabase/migrations/20261114_005_stripe_webhook_atomic_claim.sql`
- 新規説明：`docs/20261114_005_STRIPE_WEBHOOK_ATOMIC_CLAIM_ROLLBACK.md`
- Webhook routeはclaim RPCを呼び、処理トークンを持つ実行だけがイベント状態を更新する。
- 既に`processed`／`ignored`のイベントは重複として成功応答。別workerの有効lease中は再処理しない。`failed`または5分を超えたleaseは再claim可能。

### レッスン機能の限定公開停止

- `src/lib/feature-flags.ts`で停止状態を一元化。
- ホーム入口、一覧の募集／応募、詳細の編集／応募を非表示。
- 新規・編集URLへ直接アクセスした場合は停止案内を表示。
- 地図は演奏案件だけ表示。
- API側の変更系503停止は維持。既存の一覧・詳細・応募者一覧の読み取りは残す。
- LINE実機での表示・操作確認は未実施。

## 未解決のDB/API契約

- `withdraw_user_account`定義はソースZIP内にないが、読み取り専用DBエクスポートから回収済み。APIが期待する通知配列の欠落とdual-roleの片側処理を確認し、006候補で対応中。helperのロック順序・返戻値の現行確認が未完了。
- 全体キャンセル通知は007候補でRPC実行IDとバンド参加者配列に基づくよう変更。現行DBとの差分・wrapper契約は未確認。
- 現行DBのStripeテーブルは既に存在するため、004の新規基盤migrationは再適用不可。005／006／007／008も対象DBの現状照合前は適用不可。
- `supabase_admin`等のdefault privileges、実オブジェクト所有者・ACLの差異を現行DBで再確認する。

## 適用順序（承認後に限る）

1. 対象プロジェクトID・環境・regionを確認し、バックアップとmigration履歴を取得。
2. 全関係テーブル、制約、index、function signature/body、owner、RLS、ACL、default ACLをスナップショット。
3. 現行DBとの差分に基づき、004の再実行ではなく必要な差分migrationを選定。
4. 005の前提条件を確認し、適用対象のイベント状態と既存行をバックアップ。
5. 006のhelper戻り値・owner・ACL・ロック順序を確認し、退会の再試行可能なエラー応答を確定。
6. 007の現行内部関数との差分とwrapper契約を確認。
7. 008の現行Stripe購入RPC・事故テーブル・一意制約・ACLを照合。
8. SQL適用承認後に適用し、関数定義・権限・状態遷移をSQLで確認。
9. Stripe test modeで同一イベント並列配信、failed再試行、lease期限切れ、paid／unpaid／overflow／incidentを確認。

## 実施していないこと

- Supabase SQL適用、DBデータ更新・削除、残高調整
- Git commit／push、Vercel deploy
- build、lint、typecheck、test、ローカルチェック
- Stripe実決済、実キャンセル、実退会

これらはユーザーの個別承認や実機確認が必要。ローカルチェックはユーザー指示により実施しない。
