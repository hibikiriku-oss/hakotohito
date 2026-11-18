# Hakotohito 統合修正候補・最終照合状況（2026-11-14）

## 判定

**srcとSQLの修正候補は一つの作業用コピーへ集約済み。ただし公開用の最終修正パッケージとしては未完成。**

## 集約対象

- 基準：`Hakotohito_Stripeコイン購入専用_統合ソース修正版_第4版_20261113.zip`
- 反映候補：`Hakotohito_統合修正候補_20261114_読み取り専用証拠収集セット.zip`
- 基準ソース165ファイルは全て候補コピーに存在。変更済みパス12件、追加パス17件を静的比較で確認。
- ソース候補：Webhook claim、レッスンUI停止、退会API応答、全体キャンセル通知対象、release checklist等。
- SQL候補：004 Stripe基盤（新規DB向け）、005 webhook claim、006 dual-role退会・直接依頼返金、007全体キャンセル通知対象、008残高overflow paid_review。

## 最終化を止めている必須修正

1. **横断ロック順序**：request／match／application／band／lesson offer／payment order／user／idempotency keyの順序が統一されていない。退会・キャンセル・完了・応募・band送金・lesson予約・Stripe注文更新・API直接更新をまとめて修正する必要がある。006には具体的なmatch→request循環が残る。
2. **通知outbox**：退会・全体キャンセルの通知をDB transaction内に永続化し、再送workerで扱う契約がない。現状のAPI送信はDB成功後に失敗しても再送できず、返金通知の重複競合もある。
3. **Stripe副作用fencing**：005はWebhookイベント行の状態更新だけをprocessing tokenでfenceする。注文更新、Payment Intent紐付け、incident upsert、コイン付与までtoken確認と注文行ロックを同一DB transactionで行う必要がある。
4. **DB適合性**：004を既存Stripe DBへ再適用しない。005〜008は対象DBの現行関数・列・制約・owner・ACL・migration履歴との最終差分が必要。
5. **実行経路証拠**：Edge Functions、pg_cron、外部scheduler、service_role直接SQLは未確認。全経路網羅済みとは言えない。

## 業務仕様の確定値

- 個別キャンセル：関連applicationを`rejected`。同一演奏者はrequestが`open`なら再応募可能。バンド応募は現行DB関数が再応募行を再利用するが、別途の業務仕様確認は未取得。
- 全体キャンセル：requestを`closed`。再募集は新request ID。
- イベント／レンタル初回料金：同じrequest IDにつき一度だけ。返金後に同一requestが再成立しても再請求しない。
- 退会時の未成立直接依頼：実際に引き落とした金額を元の施設ユーザーへ冪等返金。

## SQL候補の扱い

| SQL | 扱い | 理由 |
|---|---|---|
| 004 | 新規基盤用のみ | Stripeテーブルが既にある対象DBへ再適用不可 |
| 005 | 保留 | event state fencingだけでは業務副作用のlease喪失を防げない |
| 006 | 適用不可 | 退会と通常キャンセルのロック循環、通知の一時データ／重複競合 |
| 007 | 適用不可 | 通知outboxがなく送信失敗時に再送不能 |
| 008 | 差分照合待ち | 現行購入RPC・incident table・constraint・ACLとの完全照合が必要 |

## 実施していない操作

Supabase SQL実行・DB変更・残高調整・Git commit／push・Vercel deploy・build／lint／typecheck／test／ローカルチェックは未実施。

## 最短公開に向けた次の実装順

1. 公開対象機能を固定し、Stripeコイン購入・レッスン等の未確認機能は停止状態を維持。
2. まずmatching coreの共通gateと行ロック順序を、全関係RPC/API経路で一括設計・実装。関数の先頭にgateを足すだけの部分対応はしない。
3. 返金／キャンセル通知outboxとworkerを追加し、006／007のAPI応答依存を廃止。
4. Stripeを公開する場合はWebhook業務副作用RPCをtoken-fencedに統合し、005／008を対象DB向け差分として確定。Stripe test modeの検証が終わるまで購入を有効化しない。
5. DB preflight・適用・postflightは対象環境を特定して個別承認後に実施。
6. ユーザー指示どおりローカルチェックは実行しない。LINE実機・Stripe test mode・本番前の管理者確認等は別途必要。


## 2026-11-14 追加反映後の状態

- 005のCHECK一括DROPをfail-closed preflightへ変更し、未知status値も停止条件に追加。
- 006／007 SECURITY DEFINER関数のsearch_pathを`pg_catalog, public, pg_temp`へ統一。
- これらは候補SQLの安全側修正であり、DB実行検証・適用済みではない。ロック循環・通知outbox・Stripe副作用fencing・現行DB差分は未解決。
- **公開・DB適用判定：BLOCKEDのまま。**
