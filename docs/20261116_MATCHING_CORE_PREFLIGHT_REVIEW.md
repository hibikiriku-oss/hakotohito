# Matching core migration preflight review — 2026-11-16

## 確認できたこと

- 009の関数定義ハッシュ31件は、受領したTokyo Productionの37関数エクスポートと照合し、全31件一致。
- 010は既存 `coin_transactions` を `application_id` で照合して、旧課金済み試行の `fee_due` を判定する。
- テスト用データの削除・クリア以前に実施した監査結果は、未公開の開発途中データ・LINEテスト由来の残骸を含むため、今回の本番状態判定には使用しない（ユーザー指示）。
- 今回、削除・クリア後の現行DBに対して実行した照会 `transaction_type IN ('direct_invite_fee','application_fee') AND amount < 0 AND application_id IS NULL` は `Success. No rows returned`。
- よって、過去監査で見つかったNULL履歴を根拠とする二重徴収懸念は、現行DBに対する適用阻止理由から除外する。今回の照会条件に一致する旧課金行は0件。

## 今回の追加レビュー・修正

- 009のgate cutover前に、既存publicテーブルを安定順で`SHARE ROW EXCLUSIVE`ロックするbarrierを追加。既存DMLが完了するまでgate設置を待ち、設置途中に書き込みがすり抜ける窓を閉じる。読み取りは許可する。
- 010〜013はトランザクション開始直後に共通transaction advisory lockを取得するよう変更。010のbackfill、011〜013の関数置換・更新を通常のアプリ更新処理と直列化する。
- これらはSQL候補の静的修正であり、DB適用やローカル実行検証は行っていない。

## 今回の修正

- 010にfail-closed条件は残している。今回の取得結果では条件に一致する行が0件のため、この条件は現行データにより阻止されない見込み。
- ただし、実際の適用時にもpreflightが再評価する。

## 未完了・適用禁止事項

- 今回の照会条件に一致する旧NULL application_idの課金履歴は0件。過去の監査結果はユーザー指示により以後の判断根拠から除外する。
- ただし、010〜013の適用可否は、他の未完了項目（API業務処理全体の原子性、通知Outbox等）のレビュー完了後に判断する。
- 複数Supabase要求をまたぐAPI業務処理全体のトランザクション化は未完了。009のstatement gateだけでは保証しない。
- transactional notification outboxと再送workerは未実装。DB更新後のLINE通知失敗・プロセス停止による通知欠落が残る。
- SQL適用、GitHub push、Vercel deployは未実施。ローカルbuild/lint/test等も実施していない。
