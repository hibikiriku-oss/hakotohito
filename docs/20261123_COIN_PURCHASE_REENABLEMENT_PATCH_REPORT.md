# V48 コイン購入再開準備・バンド送金停止パッチ（2026-11-23）

## このパッチで変更した内容

- `src/app/api/stripe/coin-purchase/route.ts`
  - DBの`coin_purchase_enabled`を実際に参照。
  - LINE IDトークン認証、購入条件同意・規約バージョン、整数レート、315,000円上限をサーバー側で検証。
  - `(payer_user_id, request_key)`の注文冪等性と、注文ID単位のStripe Idempotency-Keyを使用。
  - Checkout Session metadataに`payment_type=coin_purchase`と`payment_order_id`を設定し、Webhookの参照契約に一致。
  - Session URL保存に失敗しても同じ注文IDのStripe idempotency keyで再試行可能。
- `src/app/api/admin/payment-settings/route.ts`
  - 実在する`payment_feature_settings`のコイン購入列だけを取得・更新。
  - 購入有効化時はStripe環境変数の存在を確認。
  - Connect／サービス決済のフラグは変更対象に含めない。
- バンド送金画面・APIを停止し、バンド詳細画面の送金導線を除去。
- 新規migrationで、グローバルadvisory lockを先に取得する順序を維持しながら、残高上限超過を`paid_review`＋冪等incidentへ変更。
- 同migrationで`transfer_band_coins`の実行権限を`service_role`を含めて剥奪。関数・過去の取引履歴は削除しない。

## 重要な未完了事項

- このパッチは候補ソースとmigrationの追加のみ。Supabase適用、GitHub Push、Vercel Deploy、Stripe本番有効化は未実施。
- ビルド／Lint／テスト／ローカルチェックはユーザー方針により未実施。
- Checkout APIとDBの実接続は未検証。Stripeテストモードで正常決済、同一request keyの同時要求、Checkout作成後のDB保存失敗、Webhook再送、非同期決済、返金・紛争、`paid_review`を検証する必要がある。
- `payment_feature_settings`のDB migration適用状態、Stripe関連テーブル・関数・ACLの実DB状態を照合してから新migrationを適用すること。
- Stripe本番キー／Webhook設定とStripe Dashboard側Webhookイベント購読の確認が必要。
- 購入したコインの法的性質（資金決済法等）と利用条件は、専門家・所管窓口による確認が必要。法的適合性を保証するものではない。
- Connect、マーケットプレイス決済、ユーザー間送金は引き続き無効。バンド送金はAPI・UI・DB権限の3層で停止する設計。


## 2026-11-23 追加静的確認・SQL修正

- 差分migration内で既存の `claim_stripe_webhook_event(text,text)` を重複 `CREATE FUNCTION` していた箇所を削除。既存のWebhook lease/claim関数は先行migrationの定義を維持する。
- 今回変更対象ではない `manage_stripe_payment_incident` の再定義も削除。先行migrationのグローバルロック・権限設定を維持する。
- `complete_stripe_coin_purchase` の関数定義終端にSQL文区切りを追加。
- 残高上限処理と `transfer_band_coins` の権限剥奪のみをこの差分migrationに残した。

- 演奏者ホームのバンド機能説明から、停止中のコイン送金を案内する文言を除去。


## 2026-11-23 本番DB照合後のWebhook migration 005修正

- 本番 `stripe_webhook_events` の既存CHECK制約は `stripe_webhook_events_processing_status_check` の1件で、許可値は `received / processed / ignored / failed`。
- 3テーブル（`payment_orders`、`stripe_payment_incidents`、`stripe_webhook_events`）すべてで `trg_global_mutation_gate` が有効であることを確認。
- 既存の返金・紛争・charge_refundedインシデントのうち、StripeイベントIDまたは作成時刻が欠ける行は0件。
- migration 005は、上記の既知の旧CHECK定義と完全一致する場合に限り、その制約をトランザクション内で置き換えて `processing` を追加するよう修正。制約名・定義・件数が異なる場合は例外で停止し、未知の制約は削除しない。
- 既存Webhookイベント件数は0件との確認結果。今回の修正は候補ZIP内のみで、本番DBには未適用。


## 2026-11-23 migration 005構文修正（v4）

- v3の候補で、DOブロックのBEGIN後にDECLAREを置いていた構文上の誤りを修正。制約確認用変数をDOブロック先頭のDECLAREへ移動し、処理を同一ブロック内で実行する形に統一。
- これは候補ZIP内の修正のみ。SQL実行・本番DB変更・ローカルチェックは未実施。
- 追加確認事項：migration 20261118_009_stripe_global_lock_order.sqlは6テーブル（payment_orders、users、stripe_webhook_events、stripe_payment_incidents、stripe_payment_incident_actions、coin_transactions）のグローバルゲートトリガーを要求する。現時点で本番確認済みなのはpayment_orders、stripe_payment_incidents、stripe_webhook_eventsの3テーブルのみ。残り3テーブルの有効性確認が必要。


## 2026-11-23 追加確認：購入レート設定とWebhook RPC所有者

- V48の購入API・料金管理APIは `coin_rate_settings.coin_purchase_yen_per_coin` を参照する。
- 本番DBで共有された `coin_rate_settings` の列一覧には当該列がなく、購入有効化前に `20261122_003_match_time_fee_rate_settings.sql` の適用状態を確認する必要がある。同migrationは `performance_reward_fee_percent` と `lesson_match_fee_percent` も追加するため、現行V48料金管理APIの列契約にも関係する。
- 004 Stripe基盤migrationは既存Stripeテーブルが存在する本番DBへ適用しない。既存基盤に対する差分migration 005/006/009および既存のレートmigrationを分けて扱う。
- migration 005で作成する `claim_stripe_webhook_event(text,text)` の所有者を `postgres` に明示し、migration 009の所有者/security-definer preflightと整合させた。
- 変更は候補ZIP内のみ。本番DBへの適用・Stripe購入有効化は未実施。


## 2026-11-23 購入再開候補 v6：未完了注文の再開・多重注文防止

- `src/lib/stripe.ts` にCheckout Session取得用のStripe GET関数を追加。
- コイン購入APIは、ユーザー単位で既存の未完了注文を先に検索し、同一注文のCheckout SessionをStripe APIで再取得して状態を確認する。
- Sessionが `open` の場合は保存済み注文のURLを再利用し、`complete` または状態不明の場合は新規決済を作らず確認待ちにする。`expired` の場合だけ注文を `cancelled` にして、新しい注文を作成できる。
- 既存注文の金額・コイン数・購入レートを現在の管理レートから再計算しない。Stripe Checkoutの金額は必ず注文行に保存された `amount_jpy` を使用する。
- migration 011でユーザーごとの未完了コイン購入注文を1件に制限する部分ユニークインデックスを追加。既存重複があれば適用を停止する。
- WebhookはSession IDが未保存の場合の回復を維持し、成功時の付与は既存のDB RPCに委ねる。
- これは候補ZIP内の変更のみ。migration 011を含むSQLは本番未適用。Stripeテストモード実決済・Webhook順序・同時リクエスト・DB障害時の再試行は未検証。ビルド／Lint／テスト／ローカルチェックは未実施。

- 購入画面は既存Checkout Sessionの再開時に、保存済みのコイン数・金額・当時のレートを確認ダイアログに表示し、利用者の明示確認後にStripeへ遷移する。
- 既存pending注文にStripe Session IDがまだ保存されていない場合も、注文行の確定済み金額・コイン数でSessionを作成し、再開確認ダイアログを表示する。入力フォームの現在値で既存注文を書き換えない。


## 2026-11-23 購入再開候補 v10：Stripe冪等キー保持期間を超えるSession再作成の抑止

- Stripe Checkout Sessionの作成後、DBへのSession ID保存だけが失敗した場合、注文ID単位のStripe Idempotency-Keyで同じSessionを回復する。
- ただしStripeの冪等キー保持は永久ではないため、Session IDが未保存の既存注文について、注文作成から20時間以上経過している場合はStripeへの再作成要求を送らず、管理者確認へ誘導する。
- 20時間未満の回復では従来どおり同一注文IDのIdempotency-Keyを使用する。Session IDが保存済みの場合はStripeから実際のSession状態を取得して判定する。
- これにより、DB保存失敗後に長期間経過してStripe側の冪等キーが失効し、別Sessionが作られる可能性を抑止する。
- 候補ZIP内の変更のみ。本番DB変更、Push、Deploy、Stripe購入有効化は未実施。ビルド／Lint／テスト／ローカルチェックも未実施。

## Production DB runbook update (2026-11-23)
A read-only production DB application runbook is included at `docs/20261123_STRIPE_COIN_PURCHASE_PRODUCTION_DB_RUNBOOK.md`. It specifies the differential migration order 003 → 005 → 006 → 011, records 009 and 010 as already applied separately, and documents pre/postflight SQL. No production migration, deployment, push, or feature enablement was performed.
