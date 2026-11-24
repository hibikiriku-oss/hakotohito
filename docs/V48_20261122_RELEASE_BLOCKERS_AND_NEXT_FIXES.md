# Hakotohito V48 — 本番反映前の必須修正（2026-11-22）

## 判定
本ZIPは統合作業中の候補であり、本番適用可能な完成版ではない。以下の仕様不一致を解消し、対応するソースとSupabase migrationを一体で更新するまで本番適用しない。

## 既にパッケージ内に存在する実装（重複実装しない）
- バンド詳細画面にリーダー向け編集UIがある。
- `src/app/api/bands/[bandId]/route.ts` にLINE IDトークン検証付きPATCHがある。
- `20261122_002_band_profile_edit_rpc.sql` に `update_band_profile` RPCがある。
- `vercel.json` のLINE Outbox Cronは毎分。
- `src/app/api/cron/line-notification-outbox/route.ts` は最大5件×最大8バッチ、45秒上限でdrainする。
- 応募試行とマッチの参加者スナップショットを追加する `20261122_001` がある。

## 2026-11-22 追加作業：成立時手数料率の管理設定
- `20261122_003_match_time_fee_rate_settings.sql` を追加し、`performance_reward_fee_percent` と `lesson_match_fee_percent` を初期値10%で追加。
- 管理者画面・管理者API・公開料金APIに2項目を追加。既存の `application_fee_coins` は変更せず、応募時に保存した金額を成立時に徴収する仕様を維持。
- 既存の `completion_fee_percent` と `paid_lesson_fee_percent` は互換性のため残置。新しい成立時料率へ自動転用しない。
- **注意：この追加は設定値を管理・公開する層のみ。各成立RPCで新設定を読み込み、成立時スナップショットと実徴収に使う処理は未実装。これだけでは課金仕様は完成しない。**

## 本番適用を止める必須不一致

### 1. 応募・直接依頼・マッチングの課金仕様
`20261122_001_application_participant_snapshot_and_trade_claims.sql` 内の `accept_application_with_coins` は、応募成立時に `application_fee` を徴収し、施設から固定 `match_fee` を徴収する旧設計を残している。

確定仕様に合わせて以下を統一する必要がある。
- 応募時は残高確認のみ。徴収・予約・仮押さえをしない。
- 個人応募の成立時は応募者本人が100コインを支払う。
- バンド応募の成立時はバンドリーダーが100コインを支払う。
- 施設からの直接依頼は作成時に徴収せず、成立時に施設が100コインを支払う。
- 施設は成立時に案件全体の謝礼額の10%相当を追加で支払う。料率設定は `performance_reward_fee_percent`（初期値10%）を使用し、成立時点の値をmatchへ保存する。
- 謝礼額、料率、円換算額、コイン換算率、コイン額、支払者、取引ID、成立日時をmatch単位で固定保存する。
- イベント・レンタル初回料金は案件単位で一度だけ。返金・再成立後も再徴収しない。通常成立料金は成立ごと。

現在の `application_attempts.fee_type/fee_amount/payer_user_id` の意味も、旧応募手数料を前提としているため、列の流用だけで新仕様に合わせない。既存履歴との意味の混同を避ける移行設計が必要。

### 2. レッスン課金
`20261119_001_lesson_no_holds_and_registration_approval.sql` は `reserved_coins` を前提とする旧処理を含み、migration末尾で既存 `reserved_coins` を一括0にしている。

確定仕様では、応募時徴収・仮押さえを行わず、成立時に講師がレッスン料金の10%相当を支払う。生徒側は支払わず、完了時手数料も徴収しない。既存予約額を無条件に消去せず、実データの整合を確認してから移行する。

### 3. 退会とバンドリーダー引継ぎ
`20261118_016_integrated_withdrawal_dual_role_lifecycle_notifications.sql` の退会処理は、成立済みマッチを自動キャンセルし、リーダー退会時にバンドを解散する処理を含む。

確定仕様では自動キャンセルせず施設へ通知して判断を委ねる。リーダー退会時は最古の有効メンバーへリーダーを引き継ぎ、施設へ通知する。メンバー変更時の履歴と成立時スナップショットは分離して保持する。

### 4. 参加者クレームとグローバルロック
`20261122_001` は新しいclaimテーブルにも既存のglobal mutation gateトリガーを追加している。これは全テーブル更新を広く直列化する既存設計に依存する。競合防止の目的を保ちつつ、案件単位・参加者単位のロックに置き換えるか、限定公開時の負荷とデッドロックを評価する必要がある。

### 5. 管理者・当事者認証
管理者LINE IDや当事者側を引数で受け取るRPCは、引数の値だけを本人確認として扱わない。LINE IDトークン検証済みのサーバー側認証主体とDB処理を結び付ける。特に管理者コイン付与、紛争処理、Stripe incident管理、紛争同意RPCを対象にする。

## 完成版に必要な納品物
- 課金仕様を一元化したSupabase migrationと、対応するAPI/UI変更
- 退会・リーダー引継ぎ・メンバー変更通知を一元化したmigrationとAPI変更
- participant claimの競合制御・履歴保護migration
- 管理者／当事者認証の修正
- 適用順序、read-only preflight、postflight、ロールバック方針
- 変更一覧と既知の制限

## 実施していないこと
- 本番Supabaseへの適用
- LINE実機テスト
- build / lint / test / typecheck等のローカルチェック
- GitHub push、Vercel deploy

この文書は本番適用の承認を意味しない。上記の必須不一致を解消するまで、候補として保管する。

## 2026-11-22 返金元取引契約の追加
- `docs/20261122_V48_REFUND_SOURCE_LEDGER_CONTRACT.md` にsource transaction IDを唯一の返金根拠とする設計を記録。
- `docs/20261122_V48_REFUND_SOURCE_PREFLIGHT_READONLY.sql` に現行台帳の列・index・未返金候補のread-only確認を追加。
- 現行V48.004のイベント／レンタル成立ごとの `match_fee` debit、および `facility_reward_fee` debitが、個別・全体キャンセルRPCから参照されていないことを明記。
- DB関数の置き換えは未実施。既存返金行を誤って再返金しないため、まず実DBの台帳列・制約・返金履歴をpreflightで確認し、元debitを一意に確定できる移行計画を先に作る。

## 2026-11-22 本番反映ゲート統合

V48.005によりレッスン成立時10%徴収・snapshot・募集作成／編集時の残高hold撤廃の候補は追加済み。ただし、lesson feeのキャンセル／退会返金経路は未接続であり、未完了のまま本番適用しない。

V48.004のevent/rental per-match feeとfacility_reward_feeも既存cancel/withdrawal経路に未接続。返金元transaction IDの一意性、既存返金履歴のbackfill、イベント／レンタル旧completion feeとの二重課金防止、実DB preflightを解消するまで本番反映はBLOCKED。

最新の集約ゲート・候補migration順序・LINE実機データ収集手順は `docs/20261122_V48_DEPLOYMENT_GATE.md` と `docs/20261122_V48_ROLLOUT_RUNBOOK.md` を参照。
