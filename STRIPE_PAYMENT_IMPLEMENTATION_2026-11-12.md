# Hakotohito Stripe決済基盤（実装案）

## 実装した範囲

- 1コインの販売価格を `coin_rate_settings.coin_purchase_yen_per_coin` で管理（初期値10円）。管理画面「消費コイン設定」から変更可能。
- 演奏者・施設双方が利用できるコイン購入画面 `/coins/purchase`。
- Stripe Checkout SessionでJPY決済を開始。1回315,000円を上限とする。
- 決済成功はWebhook署名検証後にのみ確定。DB関数 `complete_stripe_coin_purchase` が注文・金額・通貨・セッションIDを照合し、冪等キー付きでコインを付与。
- Stripe Connect Expressのアカウント登録導線（`/api/stripe/connect/onboarding`）とコイン購入画面からの登録ボタン。ユーザー種別に応じて演奏者はindividual、施設はcompanyとして作成。
- 管理画面に決済機能別の有効/無効スイッチを追加。初期値はすべて無効。
- 支払い注文・接続アカウント・Webhookイベントを記録するDBテーブルを追加。
- サービス決済用の共通Checkout生成ヘルパーと、完了後にConnectへ送金するヘルパーを追加。サービス側で支払者・受取人・金額・完了条件を検証してから呼び出す。
- サービス決済のWebhookは支払い確定までを処理し、Connect送金はサービスの完了条件を満たした後に明示的に実行する。
- 施設／演奏者の法的な事業形態はStripeのホスト型オンボーディングで確認するため、初回のConnectアカウント作成時には固定しない。

## 重要：サービス料金・謝礼の実送金について

セッション・レッスン・謝礼・イベント・レンタル等の機能スイッチと共通の `payment_orders` 台帳は用意しています。ただし、各サービスのどの時点で課金し、キャンセル時にいつ返金し、完了時にどの受取人へいくら送金するかは、既存の案件・レッスン・マッチング処理との接続が必要です。今回のパッチでは、誤送金を避けるため各サービスのAPI・完了処理への自動接続はまだ有効化していません。共通ヘルパーは用意しましたが、個々のサービスで注文を作成する位置、キャンセル時の返金、完了後の送金額（手数料差引）を確定する必要があります。送金実行時には、受取額とプラットフォーム手数料の内訳を注文台帳に保存します。315,000円上限はStripeサポートから案内されたコイン購入にのみ適用し、将来のサービス料金注文には一律適用しない設計です。

Connectは別決済・送金方式を採用する前提の土台です。コイン購入はプラットフォーム決済、サービス料金はプラットフォームで受領して履行・完了後にTransferする方式を想定します。実際の送金タイミング、手数料負担、返金時のTransfer reversal、チャージバック責任はStripe審査・契約と業務ルールを確定してから接続してください。

## 適用前に必要な作業

1. Supabaseへ `supabase/migrations/20261112_002_stripe_payment_foundation.sql` を適用。
2. Vercel環境変数 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`APP_BASE_URL` を設定。3項目すべてがない場合は決済機能を有効化できない。
3. Stripe Webhookの送信先を `https://<本番ドメイン>/api/stripe/webhook` に設定し、少なくとも `checkout.session.completed`、`checkout.session.async_payment_succeeded`、`account.updated` を購読。
4. Stripe Connectの利用形態・Expressアカウント・必要Capability・対象業種・日本での審査可否をStripe担当者と確定。
5. 特商法表記、利用規約、返金・キャンセルポリシー、事業者情報を公開。
6. Stripeテストモードで購入・Webhook再送・重複イベント・失敗・キャンセルを確認してから、本番モードで有効化。

## 環境変数

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL`（例：`https://hakotohito.example`）

このパッチは作業用ソースへの追加のみです。Supabase・GitHub・Vercelへの適用や決済の有効化は行っていません。ビルド／Lint／テストも実行していません。
