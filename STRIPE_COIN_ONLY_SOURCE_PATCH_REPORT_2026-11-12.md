# Stripeコイン購入専用ソース修正レポート

基準：`Hakotohito_限定公開_第1修正バッチ_20261112.zip`
基準SHA-256：`a08cdcdeab85c5b830b4a094cfa00d9bd99869ebb08955e533c1d9acb7ced4f6`

## 変更ファイル

- `src/app/api/stripe/coin-purchase/route.ts`
  - Connect設定を購入APIから除外。
  - 購入要求IDによるDB一意化を前提にした再送処理。
  - Stripe idempotency keyを注文IDに固定し、Session作成後のDB保存失敗時も再試行で同じSessionを回収。
  - 利用条件同意・規約バージョンのサーバー検証と注文metadata保存。
  - レート・金額・上限の整数検証。
- `src/app/api/stripe/webhook/route.ts`
  - `payment_type` の既定値を廃止し、`coin_purchase` の明示一致を必須化。
  - サービス決済RPC・Connect更新をWebhookから除外。
  - Payment Intent IDを、実際にpaidとなったSessionで必須化。
  - `checkout.session.completed` が `unpaid` の場合は決済待ちとしてイベントを正常記録し、注文をpendingのまま維持。後続の `checkout.session.async_payment_succeeded` でpaidを確認してから付与。
  - `payment_type` が `coin_purchase` 以外のCheckoutイベントは注文・残高に触れず `ignored` として正常応答。
  - Checkout以外のConnect／サービス決済／返金／送金イベントも実行せず `ignored` として記録。
  - Webhookイベント状態のDB更新結果を確認。
- `src/app/api/stripe/connect/onboarding/route.ts`
  - Connect onboardingをサーバー側で常時403拒否。
- `src/app/api/admin/payment-settings/route.ts`
  - 管理者APIをコイン購入スイッチだけに限定。
  - その他のStripe機能フラグは保存時にfalse固定。
- `src/components/AdminPaymentSettingsPanel.tsx`
  - 管理者UIをコイン購入設定だけに変更。
- `src/app/coins/purchase/page.tsx`
  - Connect導線を除去。
  - 利用条件表示と同意チェックを追加。
  - 購入要求IDを維持して再送。
- `src/app/api/stripe/coin-purchase/status/route.ts`（新規）
  - LINE認証ユーザー本人のCheckout Sessionに紐づく注文状態だけを返す。
- `src/app/coins/purchase/complete/page.tsx`
  - 残高APIやURLだけで成功扱いせず、注文状態が `paid` の場合だけ完了表示。
- `supabase/migrations/20261112_003_stripe_coin_purchase_hardening.sql`（新規）
  - request_key / checkout URL列・一意制約。
  - コイン購入RPCのPayment Intent・金額・数量・レート・Session照合を強化。
- `PUBLIC_RELEASE_CHECKLIST.md`
  - 今回のソース変更状況を追記。

## 未完了・公開阻害事項

1. このパッチはソースとSQLの作成のみ。SQLは未適用。
2. ライブDBのmigration履歴、列、制約、既存関数、`coin_transactions` の冪等制約との照合が必要。
3. Stripeテストモードで正常購入、二重要求、Webhook再送、DB一時障害、未払い完了イベント、Session不一致を検証する必要がある。
4. 返金・チャージバック・不正利用イベントの専用事故記録処理は未実装。Webhookではコイン購入以外のイベントを `ignored` にするため、事故イベントを監視・処理する別途対応が必要。
5. 退会処理と決済中・決済済み注文の競合ポリシーは未確定。
6. 購入画面の利用条件は仮表示。正式な利用規約・特定商取引法表示ページのURL、事業者情報、法的レビューが必要。
7. 換金不可だけで資金決済法の適用外とは判断できない。自家型／第三者型、第三者提供サービス、バンド内移動の法的確認が必要。
8. `stripe-marketplace.ts` とサービス決済ページは削除していない。今回のStripe API構成にはサービス決済Checkout APIが存在しないことを確認したが、将来の再利用を防ぐため別途監査が必要。
9. build／lint／test／ローカルチェックは未実施（ユーザー指示により実施しない）。
10. GitHub／Supabase／Vercelへの変更は未実施。

**このパッケージは未検証の修正候補であり、本番適用・公開に使用しないこと。**


## 第2修正バッチ（Webhookイベント処理）

- `checkout.session.completed` の `payment_status=unpaid` をエラー再送扱いにせず、Webhookイベントを `processed` として記録し、注文は `pending` のまま維持する。後続の非同期決済成功イベントでのみコイン付与RPCを呼ぶ。
- `checkout.session.async_payment_succeeded` は `payment_status=paid` とPayment Intent IDを確認できない限りコイン付与しない。
- `payment_type` が `coin_purchase` 以外のCheckoutイベント（completed／async success／expired／async failed）は `ignored` として記録し、注文・残高を変更しない。
- 上記以外のイベントも `ignored` として正常応答し、Stripeの不要な再送ループを避ける。
- 本修正はWebhook routeと本レポートのみ。DB／GitHub／Vercelは変更していない。

## 第3修正バッチ（返金・紛争事故記録／管理者対応／DB契約統合、2026-11-13）

### 追加・変更内容

- `src/app/api/stripe/webhook/route.ts`
  - `charge.refunded`、`refund.created`、`refund.updated`、`refund.failed` を対象に返金事故を記録。
  - `charge.dispute.created`、`updated`、`closed`、`funds_withdrawn`、`funds_reinstated` を対象に紛争事故を記録。
  - Payment Intentのmetadataにある注文IDを取得し、Checkout完了イベントより先に返金・紛争イベントが到着した場合も対象注文を特定。
  - Payment Intentを注文に紐付け、同一Refund／Dispute IDのイベント再送・更新は同じ事故行へupsert。
  - 既に付与したコインの自動減算・Stripe返金実行は行わない。
- `src/app/coins/purchase/complete/page.tsx`
  - `paid_review` を明示し、支払確認済み・コイン付与保留・重複購入を避ける案内を表示。
- `src/app/api/admin/stripe-incidents/route.ts`（新規）
  - 管理者認証付きで返金・紛争・要確認記録と対応履歴を取得。
- `src/app/api/admin/stripe-incidents/[id]/route.ts`（新規）
  - 管理者認証後にDB RPCで確認中／対応済み／対象外と対応記録を保存。
- `src/components/AdminPaymentSettingsPanel.tsx`
  - 決済設定タブに事故一覧・状態フィルター・対応履歴・対応記録UIを追加。
- `supabase/migrations/20261113_004_stripe_coin_purchase_only.sql`（新規）
  - 第2版の002／003を置き換えるコイン購入専用DB基盤。
  - 返金・紛争インシデントの対応履歴テーブルと管理者RPCを追加。
  - Checkout完了より先に返金・紛争が記録されている場合、コインを自動付与せず `paid_review` に保留。
  - 退会済みユーザーの決済も `paid_review` に保留。
- `20261112_002_stripe_payment_foundation.sql` と `20261112_003_stripe_coin_purchase_hardening.sql` は `docs/superseded_stripe_migrations/` に退避。Supabase CLIが古いConnect／サービス決済基盤を先に実行しないよう `supabase/migrations/` から除外。
- `PUBLIC_RELEASE_CHECKLIST.md` に第3バッチの履歴と未完了確認を追記。

### 依然として未完了

1. Stripe Dashboardで本ソースが扱うWebhookイベントを購読設定する。
2. Stripeテストモードで同期・非同期決済、Webhook再送・順序逆転、複数／部分返金、紛争、退会後決済、管理者対応を検証する。
3. Supabaseへ004を適用する前にバックアップと最新スキーマ差分確認を行い、適用後に権限・関数・制約を確認する。
4. 購入画面の正式な利用規約・特商法表示URLと法的レビューを確定する。
5. 返金・チャージバック後の残高調整は自動化せず、Stripe・法令・個別状況を確認して管理者が判断する。

**第3バッチもソース／SQL成果物の作成のみ。ビルド、Lint、テスト、ローカルチェック、Supabase適用、GitHub Push、Vercel Deployは未実施。現時点で本番利用可能とは判断しない。**
