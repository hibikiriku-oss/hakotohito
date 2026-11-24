# V48 返金元取引 preflight 実行・結果回収ガイド（2026-11-22）

## 目的と安全条件

対象は本番反映先のSupabaseプロジェクト。目的は、返金元取引をIDで一意に結び付けるmigration/RPCを設計する前に、実際のledger構造・既存課金・返金履歴を読み取り専用で確認すること。

- 実行対象SQL：`docs/20261122_V48_REFUND_SOURCE_PREFLIGHT_READONLY_V2.sql`
- このSQLはSELECTとカタログ参照のみ。DDL、DML、RPC実行、残高更新は含まない。
- **必ず対象プロジェクト名／Project Refを確認してから実行する。** Preview/開発DBと本番DBを取り違えない。
- Supabase DashboardのSQL Editorで実行する。Migration画面や本番migration適用操作は使わない。
- 結果を取得する段階では、SQL本文を編集・追加せず、各SELECTを個別に実行する。複数SELECTを一度に実行した場合に結果タブが最後のSELECTだけになるUI挙動を避ける。
- 実行中にエラーが出た場合、該当SELECTのエラー全文とPostgreSQLエラーコードを記録し、列名やテーブル名を推測で書き換えない。
- 結果にはユーザーUUID、関数定義、残高・取引情報が含まれる。公開チャネルへ貼らず、作業担当者間で安全に共有する。共有時は必要に応じてUUIDを一貫した仮名へ置換するが、同一性比較に必要な範囲では同じ仮名を使う。
- これは照合用の調査であり、返金可否・残高差異・既存返金の正当性を自動判定するものではない。結果を見て自動修復・backfill・返金を実行しない。

## 実行手順

1. Supabase Dashboardで本番プロジェクトを開き、Project Refとプロジェクト名を記録する。
2. SQL Editorを開き、新規queryを作成する。
3. 最初に `20261122_V48_STAGE0_SCHEMA_PRESENCE_READONLY.sql` を**全文まとめて1回だけ**実行する。これはカタログ参照のみで、テーブルデータや個人情報は取得しない。存在しないテーブルや列が表示された場合は、その結果を先に共有し、後続SQLを無理に実行しない。
4. Stage 0で対象テーブル・列が確認できた後、`20261122_V48_REFUND_SOURCE_PREFLIGHT_READONLY_V2.sql` のSELECTを、コメント見出し `[01]`〜`[14]` の順で**1ステートメントずつ**実行する。`[08]`〜`[09]` は `match_fee_snapshots` が存在すると確認できた場合のみ実行する。`[04]`、`[06]`、`[09]`、`[12]` はSELECTが複数あるため、それぞれ別々に実行して結果を保存する。
4. 各結果をCSVで保存できる場合はCSVで保存する。関数定義（[05]）は長文を省略せずテキストで保存する。
5. 各SELECTについて、成功／失敗、行数、実行日時（JST）、結果ファイル名を下記記録表へ記入する。
6. 全結果をまとめて確認するまでは、source列追加、unique index作成、backfill、RPC置換、既存データ修正を行わない。

## 最初に共有してほしい最小結果

作業を段階化するため、最初の返信では次の3点だけでよい。

- 対象プロジェクト名とProject Ref（公開が心配なら末尾数文字を伏せてよい）
- Stage 0の結果全体
- 実行時刻（JST）と、成功／失敗

この結果を確認してから、V2のどのSELECTを実行できるかをこちらで指定する。Stage 0の結果にユーザーUUID・残高・取引明細は含まれない。

## 結果記録表

| SQL区分 | 主な確認対象 | 成功/失敗 | 行数 | 結果ファイル／エラー |
|---|---|---|---:|---|
| 01 | coin_transactions列・型・default | | | |
| 02 | CHECK/UNIQUE/FK制約 | | | |
| 03 | index定義 | | | |
| 04a | trigger定義 | | | |
| 04b | RLS有効化・強制 | | | |
| 05 | 関連RPC定義・owner・SECURITY DEFINER・ACL | | | |
| 06a | V48課金debit集計 | | | |
| 06b | 冪等キー重複 | | | |
| 07 | event/rental per-match debitとmatch/request | | | |
| 08 | performance reward snapshotとdebitの一致 | | | |
| 09a | snapshotとtransactionの欠損 | | | |
| 09b | snapshotのないperformance fee debit | | | |
| 10 | event/rental初回料金の重複・参照 | | | |
| 11 | 返金候補credit一覧 | | | |
| 12a | source_transaction_id利用状況 | | | |
| 12b | source ID重複 | | | |
| 13 | users残高とledger集計差 | | | |
| 14 | attempt/snapshot/ledger参照列の有無 | | | |

## Stage 0結果を受領した後の分岐（2026-11-22追記）

共有された本番Stage 0結果では、`application_attempts`、`match_fee_snapshots`、`lesson_fee_snapshots` が存在しなかった。`lesson_applications` は `lesson_offer_id` / `applicant_performer_id` を持つ。なおStage 0の `offer_id` / `teacher_user_id` はV48.005が `lesson_applications` に要求する列ではなく、Stage 0側の期待列定義が不適切だったため、この2列の欠落自体はV48.005との不整合を意味しない。V48.005は `lesson_applications.lesson_offer_id` / `applicant_performer_id` を参照しており、今回確認された実列と一致する。

この状態ではV2の[08]〜[10]等を実行しない。存在しないsnapshot表を直接参照するSELECTがあり、またV2の返金分析を進める前提が未確認だからである。V48.001/004/005およびV2を本番へ適用・実行しない。

次に実行するのは `docs/20261122_V48_STAGE1_BASELINE_READONLY.sql` の[01]〜[04]だけ。各SELECTを個別に実行する。[05]のmigration history queryは、[02]で実際のschema/tableを確認してから、該当するテーブル名に合わせて実行可否を判断する。Stage 1もカタログ参照のみで、業務データは取得しない。

Stage 1の結果でV47の前提migration適用状況、lesson関連の実列、既存RPCのsignature/security metadataを確認してから、実DBに存在するテーブルだけを参照するStage 2調査SQLを作成する。V48の候補SQLを本番DBの列名へ場当たり的に書き換えて実行しない。

## 結果を受け取った後に行う分析

1. 実DBの列型・既存制約・index・trigger/RLSに合わせ、source IDの追加方法と権限境界を決める。
2. 返金候補creditを、支払者・金額・transaction_type・request/application/match・冪等キー・時刻で元debit候補と照合する。候補が0件または複数件なら自動backfill対象外として隔離する。
3. `match_fee_snapshots.coin_transaction_id` と `lesson_fee_snapshots.coin_transaction_id` の実データ整合を確認する。
4. イベント／レンタル初回料金と成立ごとの料金を別々のsourceとして扱い、初回料金once-onlyを壊さないことを確認する。
5. 応募手数料、演奏報酬手数料、レッスン手数料、イベント初回料金、completion feeについて、未確定の返金業務ルールをユーザー確認なしに実装しない。
6. 分析結果から必要なmigration差分・rollback・postflightを作成し、適用前に別途承認を得る。

## 2026-11-22 Stage 0結果の受領

- 本番Stage 0結果で `application_attempts=false`、`match_fee_snapshots=false`、`lesson_fee_snapshots=false` を確認。
- `lesson_applications` は存在するが、実列は `lesson_offer_id` / `applicant_performer_id`。V48候補の想定列 `offer_id` / `teacher_user_id` とは異なる。
- `applications`、`matches`、`coin_transactions`、`performance_requests`、`users` は確認対象の必須列が存在。
- これはStage 0で確認したテーブル・列の存在状況であり、migration historyや全RPCの実装状態を確定するものではない。
- 上記の不一致により、V48.001/004/005およびV2 preflightの実行を停止。Stage 1のカタログ専用SQLを追加し、実際のlesson schema・migration history table所在・RPC signature/security metadataを先に確認する。

## 今回の作業状態

- 実行ガイドとStage 0のスキーマ存在確認SQLを追加しただけで、Supabase SQL Editorへの接続・SQL実行はしていない。
- DB、migration SQL、アプリケーションソース、残高、取引データは変更していない。
- build/test/lint/typecheck/ローカルチェック、GitHub push、Vercel deploy、LINE実機テストは未実施。
- V48本番反映判定はBLOCKEDのまま。
