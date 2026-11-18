# 限定公開中のStripeコイン購入停止

## 方針
限定公開中はStripeによるコイン購入を完全に停止する。DBの `payment_feature_settings.coin_purchase_enabled` の値やStripe環境変数の有無に依存せず、アプリケーションAPIで停止を強制する。

## 修正
- `src/app/api/stripe/coin-purchase/route.ts`
  - 設定取得APIは常に `enabled: false` を返す。
  - 購入開始APIは認証後にHTTP 403を返し、購入注文作成・Stripe Checkout Session作成へ進まない。
- `src/app/api/admin/payment-settings/route.ts`
  - 管理画面の設定取得APIは常に `coin_purchase_enabled: false` を返す。
  - `coin_purchase_enabled: true` の更新要求をHTTP 403で拒否する。
  - falseへの更新は許可する。

## 留意点
- 既存の未決済注文やStripe Webhookの処理はこの変更では削除・停止していない。既に支払いが成立した注文の整合性を壊さないため、Webhook受信・既存注文の処理経路は維持する。
- `supabase/migrations/20261118_001_disable_coin_purchase_for_limited_release.sql` でDB設定もfalseへ更新する。SQLは `id=1` の設定行が存在し、falseになったことを確認してからcommitする。
- 既に作成済みのStripe Checkout SessionはこのSQLだけでは無効化されない。限定公開前に未決済の既存Sessionが残っていないことをStripe Dashboardで確認し、必要ならStripe側で期限切れ・キャンセルにする。Webhookは既に成立した支払いを失わせないため維持する。
- この変更は作業コピーへのソース・SQL修正のみ。Supabaseへの適用、build、test、lint、typecheck、commit、push、deployは実施していない。

## LINE認証エラーのログ最小化
- `src/lib/line-auth.ts` でLINE検証APIのエラー本文をログに出さず、HTTP statusのみ記録する。例外もメッセージ本文ではなく例外名のみ記録する。
