# Hakotohito 先行反映候補 v46 — 2026-11-20

## 基準・位置づけ
- Base: `Hakotohito_20261119_limited_release_phase2_batch_remediation_candidate_v45_3(1).zip`
- 正本: ZIP内 `music-matching/`。
- 本パッケージは先行反映用の候補。Supabase適用・GitHub push・Vercel deployは未実施。
- ローカルチェック／build／lint／test／typecheckは実施しない方針を維持。

## 今回の候補変更
1. `src/lib/admin-auth.ts`
   - LINE IDトークンの本人確認と`ADMIN_LINE_USER_ID`一致に加え、DBの`users`に対応する`active`アカウントが存在することを確認する。
   - DB照会エラーは500、active管理者が存在しない場合は403で拒否する。
2. `supabase/migrations/20261119_001_lesson_no_holds_and_registration_approval.sql`
   - レッスン応募で、同じユーザーが別プロフィールを使って自分の募集に応募する経路を拒否。
   - 応募者アカウントの`active`状態を確認。
   - 募集の`target_levels`と応募者`status_level`を正規化してDB側で照合。
   - 過去日付のレッスンへの応募を拒否。
   - 成立済み応募が1件以上あるレッスン募集の条件編集を拒否。
   - 募集作成・編集時に過去日付を拒否（日本時間）。
3. `PUBLIC_RELEASE_CHECKLIST.md`
   - 今回の候補変更と未適用状態を記録。
4. `docs/20261120_EARLY_RELEASE_READONLY_PREFLIGHT.sql`
   - 本番状態の読み取り専用確認SQLを追加。

## 反映前に必ず解消するブロッカー
- 11/19に共有された5関数定義と、V45 migrationの固定MD5期待値が一致しない。共有定義はV45の置換後関数本文とほぼ同じ内容に見えるため、現行DBが旧定義なのか、置換後定義なのかを本番の`pg_get_functiondef`で確定する。MD5値を推測で置換しない。
- `20261119_001`の適用履歴、対象関数の実定義・所有者・SECURITY DEFINER・ACL、`users_account_status_check`を読み取り専用で照合する。
- イベント／レンタル案件の成立後編集禁止、演奏案件・直接依頼・バンド応募の自己マッチング防止、レッスン取引のキャンセル／完了／紛争／レビュー接続は今回の候補で未解消。これらは先行公開のP1判定を解除できないため、追加修正が必要。
- GitHub `main`との差分・現在のProductionデプロイcommitは未照合。ZIPをそのままmainへ上書きしない。

## 推奨適用順序（まだ実行しない）
1. `20261120_EARLY_RELEASE_READONLY_PREFLIGHT.sql`を本番Supabaseで読み取り専用実行。
2. 5関数の実hashと定義を共有し、migrationのfail-closed条件を正確に調整。
3. 既存migration適用履歴とACLを照合し、V45 migrationの重複適用・関数上書きがないことを確認。
4. SQL migration適用後にpostflightを実行。
5. GitHub差分を照合してからソースをmainへ反映し、Production deploy。
6. LINE実機で登録承認、管理者無効化、レッスン残高・成立時徴収・対象ランク・自己応募・成立後編集を確認。

## 今回の作業状態
- 作業用展開ディレクトリに候補ソース変更を作成。
- 本番DB・GitHub・Vercelは未変更。
- ビルド・テスト・ローカルチェックは未実施。
- 本候補はまだ本番適用可能な完成版ではない。
