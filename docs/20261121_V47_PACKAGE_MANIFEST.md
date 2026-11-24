# Hakotohito V47 — 再応募・マッチング試行履歴整合候補（2026-11-21）

## 基準
- Base: V46 draft (`Hakotohito_20261120_early_release_candidate_v46_draft.zip`)
- 正本: `music-matching/`
- 本パッケージは候補。Supabase本番適用、GitHub Push、Vercel Production deployは未実施。
- ローカルチェック／build／lint／test／typecheckは実施しない。

## V47の修正
1. `supabase/migrations/20261121_001_application_attempt_match_history.sql`
   - `matches.application_id` の全体一意制約／全体一意indexのみを除去し、同じ応募行から複数回の歴史的matchを保持可能にする。
   - 部分一意index（例：active matchだけを制限するもの）は保持。
   - `application_attempts.match_id` をマッチング単位の正確な履歴リンクとして使用。
   - `complete_match_with_fee` は `applications.status='accepted'` に依存せず、対象matchに一致する `status='matched'` のattemptを要求する。
   - `matches.application_id` は過去履歴の再利用を許可する一方、`status='active'` のmatchは応募ごとに1件だけとなる部分一意indexを追加。
   - activeかつ完了手数料対象のmatchに対応するattemptがない場合はmigrationを停止。
2. `supabase/migrations/20261121_002_application_attempt_message_snapshots.sql`
   - 応募試行ごとに応募メッセージを保存する列とINSERTトリガーを追加。個人応募・バンド応募・直接依頼の各RPCはapplication更新後にattemptをINSERTするため、共通トリガーで当該試行の文面を保存。
   - 過去に複数回応募した行は古いメッセージを復元できないため、誤って現在の文面を過去履歴に流用せず `message_snapshot_available=false` とする。
3. `src/app/api/facility/matches/[id]/route.ts`
   - 応募文面を現在のapplications行から取得せず、`match_id` に一致するapplication_attemptsのスナップショットから取得。
2. `docs/20261121_V47_APPLICATION_ATTEMPT_MATCH_PREFLIGHT.sql`
   - 読み取り専用。適用前にunique定義・active matchのattempt対応を確認。
3. `docs/20261121_V47_APPLICATION_ATTEMPT_MATCH_POSTFLIGHT.sql`
   - 適用後の読み取り専用確認。
4. `PUBLIC_RELEASE_CHECKLIST.md`
   - 再応募・完了処理の整合課題とV47候補の未適用状態を追記。

## 適用前停止条件
- preflightのactive fee-eligible match missing-attempt結果が1件以上なら適用禁止。データ修復を先行。
- 現行DBのunique制約・index一覧をpreflightで確認し、V47が削除対象とするのは`matches.application_id`単独の全体一意のみ。部分一意indexは保持。
- 既存DBのmigration履歴・関数定義・ACL・所有者を照合する。過去migrationを再実行しない。
- V47 migrationはトランザクション内で実行し、失敗時は全体rollback。

## 未完了・未実施
- 本番Supabase適用、postflight実行、GitHub差分照合、Push、Vercel deploy、LINE実機検証は未実施。
- build／lint／test／typecheck等のローカルチェックは未実施。
- `register_completion_dispute`、`agree_completion_dispute`、`manage_completion_dispute_case`、`create_review_with_reward`を照合。いずれも`match_id`単位で処理し、`applications.status`を参照しないため、今回の再応募修正による履歴混同は見当たらず、V47では定義を変更しない。レビュー報酬の冪等キーも`match_id + reviewer_id`単位。

## メッセージ履歴の制約
- 新規試行はINSERT時にapplications.messageをスナップショット保存する。
- 過去の複数試行分のメッセージは、元データが上書き済みのため復元できない。該当試行は履歴なしとして返し、現在の応募文面を代用しない。
- APIはattempt取得エラー時に500を返す。履歴取得失敗を空の応募文面として正常扱いしない。
