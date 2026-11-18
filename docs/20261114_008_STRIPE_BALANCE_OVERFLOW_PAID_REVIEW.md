# 2026-11-14 Stripe残高上限超過の要確認化

## 状態

`supabase/migrations/20261114_008_stripe_balance_overflow_paid_review.sql`は既存DB向けの差分候補。未適用。

## 修正内容

Stripe支払確認後に`users.coin_balance + payment_orders.coin_amount`がPostgreSQL integer上限を超える場合、通常失敗を返して注文を`pending`のまま残さない。

- 注文を`paid_review`へ変更し、Payment Intentとpaid_atを保存。
- `stripe_payment_incidents`に`balance_overflow`を冪等記録。
- コイン残高・coin_transactionsは変更しない。
- RPCは`success=true`、`reviewRequired=true`、`status=paid_review`を返すためWebhookイベントは正常処理として記録され、管理者事故一覧で確認できる。

## 適用前提

1. 2026-11-14 DB snapshotの対象プロジェクトID・環境を確認。
2. 現行`complete_stripe_coin_purchase`の完全定義・owner・ACL・search_pathを再取得し、この候補との差分を確認。
3. `stripe_payment_incidents`の一意制約`(payment_order_id, incident_type)`、必要列、RLS、service_role権限を確認。
4. 004の新規基盤migrationを再適用せず、この差分だけを適用するか判断する。
5. SQL適用承認後にのみ実行する。

## ロールバック

適用前の関数定義は2026-11-14読み取り専用DBエクスポートから`complete_stripe_coin_purchase`の現行定義として保存する。対象DBが同一であることを確認し、owner・ACL・search_pathを復元してから置換前関数を戻す。
