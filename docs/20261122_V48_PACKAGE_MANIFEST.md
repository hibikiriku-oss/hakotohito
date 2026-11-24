# Hakotohito V48 — 2026-11-22 integration candidate

## 基準と位置付け
- Base repository: `Hakotohito_20261121_V47_reapplication_match_history_candidate_audit3.zip`
- Source overlay: `Hakotohito_V47_1_SRC_fix01_fix02.zip`
- 正本ディレクトリ: `music-matching/`
- V48は11月21日までに確定した仕様を反映する統合候補。Supabase本番適用、GitHub Push、Vercel Production deployは未実施。
- ユーザー指定によりbuild／lint／test／typecheck／ローカルチェックは実施しない。

## 今回V48へ実装した内容

### 1. LINE通知Outboxの複数バッチ処理
- `src/lib/line-notification-outbox.ts`
  - 1バッチ最大5件を維持。
  - Cron実行時は最大8バッチ、最大45秒の時間予算内で連続claim/drain。
  - 通常APIからの即時drainは既定1バッチのまま。
  - claim失敗、lease token欠落、ack/retry記録失敗を成功扱いしない。
  - ログへLINE ID・本文・provider raw responseを出さない。
- `src/app/api/cron/line-notification-outbox/route.ts`
  - 8バッチ・45秒の上限を指定。
- `vercel.json`
  - Outbox Cronを毎分実行（`* * * * *`）へ変更。

### 2. 応募時点のバンド参加者スナップショットと再取引防止
- `supabase/migrations/20261122_001_application_participant_snapshot_and_trade_claims.sql`
  - 新規応募試行のINSERT時に、個人応募・直接依頼は本人、バンド応募はその時点の有効メンバー全員を保存。
  - バンド名・紹介文・リーダーも応募試行へ保存。
  - 応募試行の参加者スナップショットを変更不可にする。
  - 同一案件の参加者claimを永続化し、個人応募・直接依頼・別バンド応募間の重複をDBで拒否。
  - 同一案件・同一バンドの再応募も履歴テーブルで拒否。
  - 過去の個人応募は正確なperformer_idだけをbackfill。
  - 過去のバンド応募は当時のメンバーを復元できないため、現在のband_membersから推測しない。参加者スナップショットなしとして隔離し、成立処理を拒否。
  - マッチングINSERT時に応募試行の保存済みスナップショットをmatchesへ反映。現時点のband_membersを採用時に再読込しない。
  - 既存matchesの参加者スナップショットは不変化。

### 3. バンド名・紹介文編集
- `src/app/api/bands/[bandId]/route.ts`
  - PATCHを追加。LINE ID token検証、active account、リーダー所属を確認。
  - DB RPC経由で更新。
- `src/app/performer/bands/[bandId]/page.tsx`
  - リーダーに編集UIを追加。
- `supabase/migrations/20261122_002_band_profile_edit_rpc.sql`
  - band行ロックとactive leader確認を同一transactionで行うRPC。
  - DB側でリーダー権限を再検証。

## 適用順序（候補順序。現時点では実行禁止）

1. 対象本番DBのバックアップ／復元可能性を確認。
2. 実DBのmigration適用状態を取得し、V47依存migrationのうち未適用分だけを照合・適用する。過去migrationを一括再実行しない。
3. V48.001 `20261122_001_application_participant_snapshot_and_trade_claims.sql`
4. V48.002 `20261122_002_band_profile_edit_rpc.sql`
5. V48.003 `20261122_003_match_time_fee_rate_settings.sql`
6. V48.004 `20261122_004_performance_reward_fee_at_match.sql`
7. V48.005 `20261122_005_lesson_match_fee_snapshots_and_no_holds.sql`
8. 対応するread-only postflightを実行し、実DB catalog・データ・RPC・権限の結果を照合。
9. DBとソースの互換性を確認してからアプリソースを反映し、Vercel Readyを確認。
10. LINE実機で課金・応募・採用・バンド編集・Outbox配信を確認。

**重要：上記は依存関係を明示するための候補順序であり、現時点での適用承認ではない。V48.004/005の新課金とキャンセル・返金ライフサイクルの未接続、実DB preflight未実施が解消するまで、001〜005を含めV48一式を本番適用しない。** 詳細は `docs/20261122_V48_DEPLOYMENT_GATE.md` と `docs/20261122_V48_ROLLOUT_RUNBOOK.md`。

## 適用前の停止条件
- V47の`application_attempts`／Outbox等の依存migrationが未適用なら停止。
- migration 001で既存pending band attemptはスナップショット不明として隔離される。該当件数をpreflightで確認し、利用者への再操作案内を準備する。
- `application_attempts`／`matches`のglobal mutation gate triggerが無効・欠落している場合は停止。
- 既存の同一案件・同一参加者の履歴がclaim一意制約に抵触する場合は、データ保全方針を決めるまで停止。
- 実DBの関数定義・列型・制約・index・trigger・RLS・grantsが候補SQLの前提と一致しない場合は停止。
- 返金元debitを一意に特定できない場合、source-link DDL／backfill／返金RPC切替を行わない。
- 既存`reserved_coins`を一括更新・削除しない。

## 本番反映を止めている事項
- V48.001/002：実DB preflight・適用履歴との照合が未実施。
- V48.003：設定値追加は候補に含むが、実DB適用・権限確認が未実施。
- V48.004：演奏報酬手数料とイベント／レンタルper-match feeの課金候補は含むが、個別・全体キャンセル／退会時の返金経路に未接続。
- V48.005：レッスン成立時10%課金・専用snapshot・募集時残高hold撤廃の候補は含むが、キャンセル／退会返金経路に未接続。
- イベント／レンタル完了時の旧completion feeと成立時feeの適用範囲・二重課金防止が未確定。
- 返金writerがsource transaction IDを一貫して保持せず、既存返金の一意backfillに必要な実DB evidenceが未取得。
- 退会・リーダー引継ぎ・メンバー変更通知・Outbox lifecycle・SECURITY DEFINER actor/admin確認など、release scopeとして明示的に完了確認すべき領域が残る。

## V48.005 追記（レッスン成立課金）

- `20261122_005_lesson_match_fee_snapshots_and_no_holds.sql` を追加。
- レッスン成立時に講師から `lesson_match_fee_percent`（初期値10%）を徴収し、成立時点のレッスン料金・料率・円換算額・コイン換算レート・徴収額・支払者・取引IDを専用 `lesson_fee_snapshots` に保存する。
- 応募成立時の手数料は `CEIL(レッスン料金×料率)` 円を `coin_purchase_yen_per_coin` でコイン換算し、端数は切り上げる。料率0%の場合は徴収取引を作らず、0コインのスナップショットを保存する。
- レッスン募集作成・編集時の講師残高ロック・定員分残高条件を撤廃。成立時の残高確認・徴収は維持。
- `lesson_applications` は `matches` を作成しないため、演奏案件用 `match_fee_snapshots` とは別テーブルを使用。
- 既存の `reserved_coins` データを一括更新・削除しない。
- この追加migrationは静的なソース編集のみ。ビルド、ローカルチェック、DB適用は未実施。実DBの関数定義・制約・権限と照合するまで本番適用不可。

## V48 キャンセル・返金監査追記（2026-11-22）

静的確認で以下を検出したため、V48の公開判定は引き続きBLOCKED。
- イベント／レンタルのper-match成立料金（`event_match_transaction_fee:<match_id>`）が既存個別／全体キャンセルRPCの返金対象に接続されていない。
- 演奏案件の成立時 `facility_reward_fee` も既存キャンセルRPCがsnapshot／元debitを参照していない。
- 全体キャンセルのrequest初回料金返金判定は旧来のrequest全体完了match判定に依存し、source debit／初回matchの不変記録がない。
- `complete_match_with_fee` にはイベント／レンタル旧完了時手数料が残り、新しい成立時feeとの二重経路を仕様確定・統合する必要がある。
- 返金はsource transaction ID・payer・amount・type・request/application/attempt/matchの完全照合を行う統一方式になっていない。

詳細・次の修正設計は `docs/20261122_V48_CANCEL_REFUND_AUDIT.md`。本追記は静的ソース監査のみで、SQL実行・DB変更・build/test/lint/typecheck/ローカルチェック・Push・Deployは未実施。

## V48 返金元取引契約・追加preflight（2026-11-22）
- `docs/20261122_V48_REFUND_SOURCE_LEDGER_CONTRACT.md` を追加。課金ごとの返金単位、現行未接続箇所、source transaction基準の統一契約と実装順序を明文化。
- `docs/20261122_V48_REFUND_SOURCE_PREFLIGHT_READONLY.sql` を追加。`coin_transactions` の列・index・制約、イベント成立料金／演奏報酬手数料の返金候補、初回料金の重複、返金候補重複をread-onlyで確認する。
- 重要：この段階では返金RPCやDBスキーマを変更していない。preflightの候補抽出は説明文・キーに依存するため、返金済み／未返金の最終判定にはsource transaction IDの完全照合が必要。

## 2026-11-22 返金元取引監査フォローアップ
- `docs/20261122_V48_REFUND_SOURCE_AUDIT_FOLLOWUP.md` を追加。個別／全体キャンセル関数とV48.004成立時課金関数の実際の条件分岐を照合し、未接続箇所を具体化。
- `docs/20261122_V48_REFUND_SOURCE_PREFLIGHT_READONLY_V2.sql` を追加。ledgerの制約・index・trigger/RLS・RPC定義・課金キー・snapshot/debit整合・返金候補・attempt provenanceを確認するread-only SQL。
- source refundのDDL／backfill／RPC接続は未実装。実DBの列・制約・既存返金履歴を取得していないため、誤返金防止の停止条件を維持。
- build/test/lint/typecheck/ローカルチェック、DB適用、Push、Deployは未実施。公開判定BLOCKED。


## 2026-11-24統合パッケージ更新

- V12候補と`origin/main`（`1258308fbb7aaaca8d140e061032c36fb139464d`）を共通基準にして、ユーザー提供の10ファイルのローカル差分を3-way照合。V12候補にはローカル差分の内容が既に含まれていた。演奏者ホームのプロフィール実在確認ガードはV48側を維持。
- 本番DBの2026-11-24受領結果を`docs/20261124_PRODUCTION_DB_EVIDENCE_AND_PACKAGE_STATUS.md`へ記録。
- **公開判定BLOCKEDを維持。** source-linked refundの共通実装、キャンセル／退会経路統合、イベント／レンタル完了fee整合、現行本番関数本文とmigration履歴の確認が残る。
- DB変更・Push・Deploy・ローカルチェックは未実施。

## 2026-11-24 承認済みライフサイクル仕様・本番RPC証跡取得の追記

- `docs/20261124_PRODUCTION_DB_EVIDENCE_AND_PACKAGE_STATUS.md` に、2026-11-24受領の本番catalog結果と確定済み返金・退会仕様を記録。
- `docs/20261124_PRODUCTION_RPC_AND_MIGRATION_LEDGER_PREFLIGHT.sql` を追加。現行本番の完全な関数定義、アプリmigration ledger候補、`coin_transactions`制約／index／trigger／RLS、V48関連列・テーブルをread-onlyで取得する。
- `facility_reward_fee` と `lesson_match_fee` は実施前キャンセル時に元支払者へ元debit全額返金、完了後は返金しない。
- イベント／レンタル初回料金はrequest単位once-only。返金後の再マッチでも再徴収せず、per-match feeと分離する。旧完了時feeとの二重徴収を禁止。
- 演奏者退会時は既成立案件を自動キャンセルせず施設へ通知。バンドリーダー退会時は最古の有効メンバーへ引継ぎ。
- これらは業務仕様・preflight・チェックリストへ反映済み。source-linked refund RPC、cancel/withdrawal関数の実装置換はまだ未完了。現行本番関数本文とmigration ledgerのread-only結果を取得後、実DBに合うmigrationとして実装する。
- 公開判定BLOCKED。DB変更、Push、Deploy、LINE実機テスト、build／lint／test／typecheck／ローカルチェックは未実施。
