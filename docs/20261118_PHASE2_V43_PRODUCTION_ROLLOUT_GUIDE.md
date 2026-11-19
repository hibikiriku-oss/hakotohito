# v43 本番反映ガイド（2026-11-18）

## 0. このガイドの前提

- 対象は本番Tokyo Supabase / `hakotohito` Vercel project / 正しいGitHub repository・production branchであることを、操作前に画面で確認する。
- v43 ZIPは候補パッケージであり、SQL実行・PostgreSQL検証・build/test/lint/typecheckは未実施。適用可否は各preflight結果で判断する。
- 旧データのバックアップと復元可能性を確認してから開始する。
- 実ユーザーへのLINE通知を避け、テストアカウント同士だけで試験する。
- 途中でpreflight exception、SQL error、予期しない行数、LINE通知先の不一致があれば、その場で停止して結果を共有する。続けて次のmigrationを流さない。

## 1. パッケージの取り込み

ZIP直下（`package.json`、`src/`、`supabase/`がある階層）がアプリケーションルート。ZIP内の`music-matching/`サブフォルダーはそのミラーコピーで、311組の対応ファイルはバイト単位で同期済み。既存の`C:\Users\user\Desktop\music-matching`へ取り込む場合は、いったん一時フォルダーへ展開し、ZIP直下から`music-matching/`サブフォルダーを除いた内容だけをコピーするか、`music-matching/`内の内容だけをコピーする。ZIP全体を既存リポジトリ直下へ直接展開すると二重階層ができるため避ける。

変更対象は次の通り。

- LINE Outbox workerの旧/新RPC両対応と、lease token欠落時のfail-closed処理
- 演奏者詳細・レビューAPIの閲覧者active確認
- Outbox migration 004のfail-closed preflightと旧RPC一時維持
- post-deploy migration 017（旧RPC削除）
- 監査報告、release checklist、Outbox rollout runbook、read-only evidence SQL

ローカルチェックは実施しない。コミット・Pushは別途明示的に承認を受けてから行う。

## 2. DB反映前

1. Supabaseの対象プロジェクト名・Regionを確認する。
2. DBバックアップと復元手順/復元ポイントを確認する。
3. SQL Editorで既存の関数・テーブル・列・トリガーを読み取り確認する。Hakotohito独自の`supabase_migrations.schema_migrations`は存在しないため、Supabase内部履歴をアプリmigration履歴として扱わない。各SQLファイルの適用成功・時刻を`PUBLIC_RELEASE_CHECKLIST.md`へ手動記録し、機能マーカーでも重複適用を防ぐ。
4. アップロード済み2026-11-17関数エクスポートとmigration 009の必須31関数は静的hash 31/31一致済み。ただし、実DBのlive catalogは必ずmigration自身のpreflightで再確認する。
5. `docs/20261118_SECURITY_DEFINER_ACL_VERIFY.sql` と関連read-only preflightを確認する。

## 3. SQL適用順序

**適用履歴の扱い：** Hakotohito独自のSupabase migration ledgerは確認されておらず、`supabase_migrations.schema_migrations`は存在しない。`auth.schema_migrations`、`realtime.schema_migrations`、`storage.migrations`はSupabase内部用で、アプリmigration履歴として使わない。各SQLファイルの成功をこのチェックリストへ手動記録し、再実行は機能マーカーと既存オブジェクトを確認して判断する。

各SQLファイルはSupabase SQL Editorへ全文を貼り付け、1本ずつ1バッチで実行する。ファイル末尾の`COMMIT;`まで実行され、成功表示になったことを確認してから、ファイル名・時刻・結果を`PUBLIC_RELEASE_CHECKLIST.md`へ記録する。

1. 最初に`20261116_009_global_mutation_gate.sql`を単独実行する。このmigrationは既存31関数の定義hashをpreflightする。例外が出た場合は停止し、期待hashを書き換えず、エラー全文を共有する。成功後に`20261116_010`から`20261116_023`までを番号順に1本ずつ適用する。
2. `20261118_001` から `20261118_003` までを番号順に適用する。
3. `docs/20261118_OUTBOX_READONLY_PREFLIGHT.sql` を実行する。
4. Outbox `pending=0`、`processing=0`、重複active LINE ID=0、global mutation gate triggerが有効で正しい関数を参照していることを確認する。1つでも不一致なら停止する。
5. `20261118_004_harden_line_notification_outbox.sql` を適用する。migration自身もpending/processing行、重複active LINE ID、gate triggerの不備を検出するとrollbackする。
6. `20261118_005` から `20261118_016` までを番号順に適用する。`20261118_015` は004の後、016は015の後。各migrationのpreflight失敗時は停止する。
7. ここでは **`20261118_017` を適用しない**。旧worker RPCを一時的に残しておく。

## 4. アプリ反映と旧RPC廃止

1. SQL 001–016が完了したことを確認する。
2. v43アプリを正しいGitHub production branch/Vercel projectへ反映する。Preview deploymentをProductionと取り違えない。
3. Vercel deploymentがReadyになったことを確認し、旧deploymentの処理中リクエスト/インスタンスがdrainするまで待つ。
4. Outboxの`processing`行が0であることを確認する。
5. その後に限り `20261118_017_retire_legacy_outbox_acknowledgement_rpcs.sql` を適用する。017はlease-token RPCの存在、claim結果にlease_tokenが含まれること、gate triggerが有効であること、processing行が0であることをpreflightする。
6. **017をVercel反映前に実行しない。** SQL Editorで017のSQLファイルだけを、Vercel反映・旧インスタンスdrain・processingゼロ確認後に別バッチで実行する。

## 5. テスト前後のSQL証跡

`docs/20261118_PHASE2_V43_RUNTIME_EVIDENCE_CAPTURE.sql` は読み取り専用の集計SQL。SQL 001–016適用後、LINE実機テスト前に1回実行して結果を保存し、各テスト後にも同じSQLを実行する。LINE ID・氏名は出力しない。アプリ画面・Vercelログ・Supabaseログと時刻を合わせる。

## 6. 推奨するテスト順

テストアカウント同士で、各操作の前後に残高・応募状態・attempt・match・Outboxの差分を取得する。

1. ログイン/ユーザー情報取得。退会済みアカウントではプロフィール詳細・レビューAPIが403になること。
2. 通常応募作成時に応募料が引かれず、施設承認・マッチング成立と同じトランザクションで1回だけ徴収されること。
3. バンド応募も応募1件につき1回だけ徴収され、メンバー人数分に増えないこと。
4. 直接依頼作成時は徴収せず、演奏者承諾・マッチング成立時だけ直接依頼料が徴収されること。残高不足時はマッチングも課金も成立しないこと。
5. イベント/レンタル初回成立料は案件につき1回。完了済みマッチングがない全体キャンセルで返金された後、同じ案件を再開・再マッチしても再徴収されないこと。
6. 完了報告で設定率（現行1%）の手数料が計算され、残高不足でも完了し、残高がマイナスになり得ること。
7. レッスン機能が有効であること。有料レッスンは成立した受講者1人ごとにレッスン料の1%（切り上げ）、無料レッスンは設定済み固定手数料が成立時に徴収されること。予約残高と成立後残高も照合する。
8. LINE通知が正しいテスト相手だけに届き、Outboxが`sent`へ遷移すること。失敗時はretry/backoff/failedの記録が整合すること。
9. 退会テストは他の実ユーザーに通知されないテストデータのみで実施し、両ロール・通常応募・直接依頼・レッスン・バンド通知の対象と返金を照合する。
10. 一般ユーザーが既存アカウントの`user_type`を切り替えたり、公開POST APIで副ロールのプロフィールを自己作成できないこと。兼任設定は管理者だけが行えること。
11. **自己マッチングは未解決のP2。** 管理者作成の兼任アカウントで、自分の施設案件への応募・自分の演奏者プロフィールへの直接依頼を実行しない。自己マッチングを禁止する方針を確認してから、API/DB RPC両側の拒否修正とテストを行う。

## 7. 停止条件

- バックアップ/復元可能性が不明
- 対象プロジェクト不一致、または機能マーカーが想定と不一致
- migration preflight exception、SQL error、PostgREST schema cache error
- Outboxのpending/processing行やactive LINE ID重複が残る
- VercelがReadyでない、旧workerが処理中、または017前にprocessing行が残る
- LINE通知先・金額・コイン残高・応募/マッチング状態のいずれかが想定と異なる
- 兼任アカウントが同一ユーザーの施設・演奏者プロフィール間で自己応募/自己直接依頼を成立させた（P2方針未決定）

停止した場合は、エラー全文（秘密情報を伏せる）、操作したmigration名、操作時刻、直前/直後のread-only SQL出力を共有し、復旧判断が済むまで次の操作を行わない。
