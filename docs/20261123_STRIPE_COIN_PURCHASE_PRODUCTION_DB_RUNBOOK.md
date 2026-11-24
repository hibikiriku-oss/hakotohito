# V48 コイン購入再開候補 — 本番DB適用手順（2026-11-23）

## 適用対象と前提

この手順は、既存の本番Stripe基盤を維持したまま、コイン購入再開に必要な差分migrationだけを適用するためのものです。`20261113_004_stripe_coin_purchase_only.sql` は既存テーブルを作成する基盤migrationなので、本番には再適用しません。

事前に確認済みの本番状態（2026-11-23時点）：
- `payment_orders` は0件。未完了注文・Checkout Sessionともに存在しない。
- `stripe_webhook_events` は存在し、`stripe_event_id` の一意制約がある。
- 現行 `processing_status` CHECK は `received / processed / ignored / failed` の4値。
- `processing_token`、`processing_started_at`、`attempt_count`、`claim_stripe_webhook_event` は未導入。
- `stripe_payment_incidents` のイベント順序列・順序RPCは未導入。
- 返金・Dispute系の既存incidentで、Stripeイベント順序情報が欠落した行は0件。
- `acquire_global_mutation_gate_trigger()` と、6テーブルの `trg_global_mutation_gate` は有効。
- `20261123_010` 相当の残高overflow対応とバンド送金RPCのEXECUTE剥奪は個別に本番適用済み。

この確認結果は実行時点で変わる可能性があります。SQL適用直前に、下記の再確認SQLを実行してください。

## 適用順序

1. `supabase/migrations/20261122_003_match_time_fee_rate_settings.sql`
   - `coin_purchase_yen_per_coin` を追加する。
   - 同時に `performance_reward_fee_percent` と `lesson_match_fee_percent` も追加する。V48の管理APIが全レート項目を一括取得・更新するため、この3列は一体で必要。
   - 既存のレート行は消去・再作成しない。新列はDEFAULT 10で追加される。
2. `supabase/migrations/20261114_005_stripe_webhook_atomic_claim.sql`
   - 既存のグローバルロックと同じadvisory lockを先に取得してから変更する。
   - Webhookの処理リース列と `claim_stripe_webhook_event(text,text)` を追加する。
   - 本番で確認済みの既存CHECK定義だけを置き換え、`processing` を許可する。
3. `supabase/migrations/20261118_006_ordered_stripe_payment_incidents.sql`
   - 005と既存の009グローバルロックを前提にする。
   - 返金・Disputeのイベント時刻・イベントIDを保存し、古いイベントによる状態巻き戻りを防ぐ。
   - 既存incidentの順序情報が欠けている場合は、migration自身が停止する。
4. `supabase/migrations/20261123_011_one_pending_coin_purchase_per_user.sql`
   - グローバルadvisory lockを取得し、注文書き込みと競合しない状態で事前重複確認とインデックス作成を行う。
   - ユーザーごとの未完了コイン購入注文を1件に制限する部分ユニークインデックスを追加する。
   - 事前に重複が見つかれば停止する。

`20261116_009_global_mutation_gate.sql` と `20261123_010_coin_purchase_overflow_and_disable_band_transfers.sql` は再適用しません。

## 適用直前の読み取り専用チェック

```sql
-- A. レート列がまだ存在しないこと（既に存在する場合は migration 003 を再実行しない）
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'coin_rate_settings'
  AND column_name IN (
    'coin_purchase_yen_per_coin',
    'performance_reward_fee_percent',
    'lesson_match_fee_percent'
  )
ORDER BY column_name;

-- B. Webhook lease列・claim RPCが未導入であること（005の前提）
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'stripe_webhook_events'
  AND column_name IN ('processing_token','processing_started_at','attempt_count');
SELECT to_regprocedure('public.claim_stripe_webhook_event(text,text)') AS claim_rpc;

-- C. 005が想定する既存status CHECKと一意index
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.stripe_webhook_events'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%processing_status%';
SELECT indexrelid::regclass AS index_name, pg_get_indexdef(indexrelid)
FROM pg_index
WHERE indrelid = 'public.stripe_webhook_events'::regclass
  AND indisunique AND indisvalid;

-- D. 006が必要とする既存incidentの未解決順序情報がないこと
SELECT COUNT(*) AS incidents_missing_event_order
FROM public.stripe_payment_incidents
WHERE (incident_type LIKE 'refund:%'
    OR incident_type LIKE 'dispute:%'
    OR incident_type LIKE 'charge_refunded:%')
  AND (NULLIF(btrim(details ->> 'stripe_event_id'), '') IS NULL
    OR COALESCE(details ->> 'stripe_event_created', '') !~ '^[0-9]+$');

-- E. 011の前提：重複pending注文がないこと（payer_user_idは基盤schema上NOT NULL）
SELECT payer_user_id, COUNT(*) AS pending_count
FROM public.payment_orders
WHERE payment_type = 'coin_purchase' AND status = 'pending'
GROUP BY payer_user_id
HAVING COUNT(*) > 1;
SELECT COUNT(*) AS total_payment_orders FROM public.payment_orders;

-- F. 009の既存グローバルロックトリガーが有効であること
SELECT c.relname AS table_name, t.tgname, t.tgenabled,
       t.tgfoid::regprocedure AS trigger_function
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'payment_orders','users','stripe_webhook_events',
    'stripe_payment_incidents','stripe_payment_incident_actions','coin_transactions'
  )
  AND t.tgname = 'trg_global_mutation_gate'
  AND NOT t.tgisinternal
ORDER BY c.relname;
```

適用直前チェックの判断：
- A〜Cで対象列やRPCが既に存在する場合、該当migrationをそのまま流さず、実定義を照合する。
- Dが0以外なら006を実行しない。該当incidentを根拠あるStripeイベント時刻で照合・整理する必要がある。
- Eで行が返る場合は011を実行しない。既存pending注文のStripe Session状態を確認してから整理する。
- Fは6テーブルそれぞれに有効なトリガーが1つずつ必要。

## 適用後チェック

```sql
-- 003
SELECT id, coin_purchase_yen_per_coin,
       performance_reward_fee_percent, lesson_match_fee_percent
FROM public.coin_rate_settings WHERE id = 1;

-- 005
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='stripe_webhook_events'
  AND column_name IN ('processing_token','processing_started_at','attempt_count')
ORDER BY column_name;
SELECT to_regprocedure('public.claim_stripe_webhook_event(text,text)') AS claim_rpc;
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid='public.stripe_webhook_events'::regclass
  AND conname='stripe_webhook_events_processing_status_check';

-- 006
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='stripe_payment_incidents'
  AND column_name IN ('stripe_event_created','stripe_event_id')
ORDER BY column_name;
SELECT to_regprocedure('public.record_stripe_payment_incident_ordered(uuid,text,text,uuid,bigint,text,text,bigint,text,text,text,text)') AS ordered_incident_rpc;
SELECT to_regprocedure('public.guard_stripe_payment_incident_event_ordering()') AS ordering_guard;

-- 011
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public'
  AND indexname='payment_orders_one_pending_coin_purchase_per_user_idx';
SELECT payer_user_id, COUNT(*)
FROM public.payment_orders
WHERE payment_type='coin_purchase' AND status='pending'
GROUP BY payer_user_id HAVING COUNT(*) > 1;
```

## コード反映・有効化の順序

1. 上記4 migrationを順番に適用し、各適用後チェックを確認する。
2. V48候補ソースをVercelへ反映する。migration未適用の状態でWebhookコードだけ先行反映しない。
3. Stripeテストモードで、Checkout作成・再読み込み時のSession再利用・期限切れSession・Webhook重複配信・決済完了後のコイン付与・残高overflow時のpaid_reviewを確認する。
4. Stripe DashboardのWebhook送信先と購読イベント、Vercel環境変数を確認する。
5. テストモードの一連の確認後に限り、本番の `payment_feature_settings.coin_purchase_enabled` を有効化する。

## 実施禁止・未実施事項

- この文書の作成時点で、Supabaseへのmigration適用、Git Push、Vercel Deploy、Stripe本番購入機能の有効化は行っていない。
- `20261113_004_stripe_coin_purchase_only.sql` および superseded migrationは本番に再適用しない。
- Connect onboarding、マーケットプレイス決済、ユーザー間送金はこの購入再開の対象外であり、有効化しない。
- ビルド、Lint、テスト、ローカルチェックは実施していない。
