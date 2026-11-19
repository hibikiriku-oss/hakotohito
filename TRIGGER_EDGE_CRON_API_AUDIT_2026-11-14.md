# Trigger・Edge Function・Cron・API更新監査（2026-11-14）

## 調査資料
- 作業用ソース：`Hakotohito_統合修正候補_20261114_API直接更新監査追補.zip` 相当の展開物
- DB証拠：`evidence/schema(2).sql`
- Vercel設定：`vercel.json`

## Trigger
1. `trg_prevent_disputed_match_cancellation`：matchesのstatus/performance_status更新前に、異議申立て中のキャンセルを拒否。別テーブル更新なし。
2. `users_initial_coin_balance`：users INSERT前にline_registration_historyをINSERT ON CONFLICT DO NOTHING。既存hash時は同履歴をUPDATEし、初期coin_balanceを0にする。

このダンプ内では上記2件のみ。

## Cron
`vercel.json` に `/api/cron/auto-complete` 毎日 `0 0 * * *`。routeは候補matchを読み取り、`complete_match_with_fee` RPCで状態変更する。直接UPDATEはなし。RPC側のlock-order問題が残るため公開阻害。

## 未確認
- 作業用ZIPに`supabase/functions/`／Deno Edge Functionsなし。存在有無は未確認。
- DB dumpにpg_cron job情報なし。jobの有無は未確認。
- 外部scheduler、service_role直SQL、手動運用スクリプトは未確認。

## API直接更新の重要対象
- facility/performer match complete routes：matches完了報告日時を直接UPDATE。完了RPCとは別transaction。
- stripe/webhook：payment_ordersとstripe_payment_incidentsを複数のPostgREST要求で更新。event claim tokenは業務副作用全体をfenceしていない。
- stripe/coin-purchaseおよびstripe-marketplace helper：payment_ordersを直接INSERT/UPDATE。外部Stripe API呼出しはtransaction外に置き、状態遷移をDB RPC/CASで保護する。
- auto-complete cron：RPC経由のため直接更新迂回には該当しない。

## 結論
確認できたtrigger／Cronに独立した隠れた状態更新処理は見つからなかった。ただし資料不足のため全経路網羅とは言えない。Supabase Functions一覧、pg_cron.job、trigger catalog、routine定義、service_role権限の追加取得が必要。

SQL実行・DB接続・ローカルチェック・build／lint／test・Supabase適用・Git操作・Vercel操作は未実施。
