# 追加証拠の取得手順（読み取り専用）

## 目的

今回のソースZIPとDBダンプだけでは、Supabase Edge Functions、`pg_cron`、外部scheduler、運用スクリプトの全実行経路を確定できない。次の証拠を追加取得し、DB/RPC/APIを迂回する書き込み経路がないか確認する。

## 取得前の注意

- 最初はテスト環境（東京）を選択し、画面上のプロジェクト名・regionを確認する。production（Mumbai）には切り替えない。
- `20261114_readonly_execution_path_evidence.sql` はSELECTのみ。SQL Editorで各Qを個別実行し、結果をCSVまたはテキストで保存する。
- Q0のdatabase/current_role/captured_atを必ず添付する。異なるプロジェクトの結果を混ぜない。
- Q5/Q6がrelation-not-foundまたはpermission deniedになった場合、エラー全文も保存する。エラーだけでpg_cronの不存在とは断定しない。
- 関数定義やcron commandにAPI key、token、URL credential等が含まれていないか確認し、共有前に値を伏せる。関数名・引数・ロック取得順・SQL構造は残す。
- この作業ではSQL適用、DDL/DML、関数呼び出し、デプロイ、設定変更を行わない。

## Supabase Dashboardで取得するもの

1. **Edge Functions**：対象プロジェクトのFunctions一覧（名前、region、verify JWT設定、最終更新日時）。各functionのソース一式も取得する。特に `supabase/functions/` に対応するローカルソースがある場合は、そのフォルダ全体を提出する。
2. **Database > Extensions**：`pg_cron`、`pg_net`等の有効状態。SQL Q1の拡張一覧と照合する。
3. **Database > Triggers / Functions**：SQL Q2〜Q4の結果と照合する。Dashboard表示だけでなくSQL結果を優先する。
4. **Logs**：必要な場合に限り、Edge Function／Cronの直近実行ログを取得する。ログ内のユーザー情報・token・個人情報は伏せる。

## Supabase CLIを使う場合

CLIを使う場合も、最初はログイン済みの正しいテストproject refを確認する。Functions一覧・ソース取得のコマンドは、使用中のSupabase CLIバージョンの `supabase functions --help` に表示された読み取り系コマンドだけを使う。`deploy`、`delete`、`secrets set/unset`、migration apply等の変更コマンドは実行しない。CLIバージョンと一覧結果を保存する。

## Vercel側で取得するもの

- Project Settings > Cron Jobsの登録一覧（path、schedule、environment、last/next runが表示される場合はそれも）。
- Git repositoryの `vercel.json` と、Cronが呼ぶrouteのソース。
- Cron以外の外部scheduler（GitHub Actions、Make、Zapier等）を使っている場合は、名前・schedule・呼び出し先pathだけを一覧化する。Authorization headerやsecret値は提出しない。

## 返してほしいファイル

- SQL Q0〜Q10の結果（Q5/Q6はエラーでも可）
- Edge Functions一覧と、存在するfunctionのソース
- Vercel Cron Jobs一覧
- GitHub Actions等の外部scheduler一覧（存在する場合）

これらが揃うまでは「全実行経路の棚卸し完了」と判定しない。productionへの読み取り取得も、対象環境と取得内容を別途確認してから行う。
