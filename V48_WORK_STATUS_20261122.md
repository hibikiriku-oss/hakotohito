# Hakotohito V48 作業状況（2026-11-22）

V47.1をベースにした統合作業中の候補。バンド編集、Outbox複数バッチ、応募参加者スナップショットの実装は含む。

ただし、課金仕様、レッスン成立課金、退会・リーダー引継ぎ、管理者／当事者認証に重大な旧仕様が残るため、本番適用不可。詳細は `docs/V48_20261122_RELEASE_BLOCKERS_AND_NEXT_FIXES.md` を参照。

本番DB変更、GitHub push、Vercel deploy、LINE実機テスト、ローカルチェックは未実施。

## 2026-11-22 課金統合の追加作業（V48.003 / V48.004候補）

- [x] 管理者設定に演奏案件の成立時報酬手数料率（初期値10%）とレッスン成立時講師手数料率（初期値10%）を独立追加。旧完了手数料率1%・旧有料レッスン料率1%は読み替えず保持。
- [x] 管理者API・公開料金API・管理者画面に上記2設定を追加。
- [x] 応募手数料 `application_fee_coins` は既存どおり応募時に金額を保存し、成立時にその保存額を徴収する仕様を維持（初期値10コイン）。
- [x] 成立時の演奏報酬手数料用に、支払者・報酬額・手数料率・円換算額・換算レート・コイン額・取引IDを保存する `match_fee_snapshots` を追加。
- [x] 通常応募・バンド応募・直接依頼の成立RPCをラップし、施設負担の演奏報酬10%相当を成立トランザクション内で徴収する候補を追加。残高不足時は成立全体をrollback。
- [x] イベント・レンタルの成立取引ごとの通常100コインを、案件単位の初回100コインとは別の冪等キーで徴収する候補を追加。初回料金の既存冪等キーは維持。
- [x] 演奏報酬の成立時スナップショットがある場合、完了時の旧1%手数料を二重徴収しない候補を追加。
- [ ] レッスン成立時10%の円／コイン換算徴収・専用スナップショットへの置換は未実装。
- [x] レッスン募集作成・編集時の残高条件を撤廃。既存reserved_coinsは一括クリアせず保持（成立時の新規徴収は維持）。
- [ ] イベント・レンタル完了時は旧completion_fee_percentによる参加費／レンタル料手数料が残る。成立時10%方式との適用範囲・二重徴収防止の仕様確定と修正が未完了。
- [ ] 本番DBの現行関数定義・transaction_type制約・migration適用履歴とのread-only preflight未実施。SQL未実行、DB変更なし。
- [ ] build／lint／test／typecheck／ローカルチェック未実施（ユーザー方針により実施しない）。

**V48.003/004状態：** 課金統合の中間候補。レッスン成立課金とイベント／レンタル完了課金の整合が未完了のため、本番適用可能な完成版ではない。既存のV48候補ZIPを更新する作業コピーに追加した段階。

## 2026-11-22 追加確認（イベント／レンタル・既存予約残高）

- V48.004の`complete_match_with_fee`は、演奏案件の新成立時スナップショットがある場合だけ旧完了手数料を抑止する。イベント／レンタルは従来の`completion_fee_percent`による完了時手数料計算が残っている。参加費・レンタル料に対する旧手数料を継続するか、新しい成立時課金へ移すかは現時点の確定仕様だけでは断定できないため、削除・読み替えは保留。
- V48.005で募集編集時や定員到達時に`reserved_coins = 0`へ更新していた箇所を除去。新規募集は初期値0のまま、既存予約残高はこのmigrationで暗黙に消さない。
- これらは静的なソース確認とテキスト修正のみ。ビルド・ローカルチェック・DB適用は未実施。

## 2026-11-22 返金元取引統一設計
- 返金を元課金取引IDで一意に追跡する契約書 `docs/20261122_V48_REFUND_SOURCE_LEDGER_CONTRACT.md` を追加。
- `coin_transactions` の列・index・返金候補を確認するread-only SQL `docs/20261122_V48_REFUND_SOURCE_PREFLIGHT_READONLY.sql` を追加。
- 個別／全体キャンセルでイベント・レンタル成立ごとの `match_fee` と演奏報酬 `facility_reward_fee` が返金対象に接続されていない点、初回料金返金のrequest-wide完了判定、イベント・レンタル旧完了手数料の重複可能性を記録。
- 共通返金RPCや本体SQLはまだ実装していない。実DBの列・制約・既存返金履歴を確認せずにsource FKを追加・backfillすると誤返金の危険があるため、先にread-only preflightを用意した。
- build/test/lint/typecheck/ローカルチェック、DB適用、Push、Deployは未実施。

## 2026-11-22 返金ライフサイクル横断照合
- 応募手数料、通常match fee、イベント／レンタル初回料金、イベント／レンタル成立ごとの料金、演奏報酬手数料、直接依頼料、レッスン料を、個別cancel・request全体cancel・direct invite reject・auto-reject・withdrawalの各経路と照合。
- 応募手数料は成立時に `application_match_fee:<attempt_id>` で徴収されるが、既存cancel RPCに明示的な返金writerがない点を記録。
- イベント／レンタル初回料金 `event_match_fee:<request_id>` と成立ごとの料金 `event_match_transaction_fee:<match_id>` は別課金。後者は既存の個別・全体cancelで返金対象外。
- 演奏報酬 `facility_reward_fee` は `match_fee_snapshots.coin_transaction_id` に元取引IDを保存するが、cancel RPCが未参照。
- 直接依頼料はreject/withdrawal等に返金writerがある一方、返金行は元debit IDを保持せず、source-level unique保証もない。
- `match_fee_snapshots` にapplication_attempt_idがなく、再利用可能なapplication relationとの履歴結合に追加設計が必要。
- 横断表 `docs/20261122_V48_REFUND_LIFECYCLE_MATRIX.md` を追加。返金仕様が未確定の費目は推測で返金実装しない。
- 実DB preflight未実行のためsource-linked refund DDL・backfill・RPC差替えは未実施。公開判定BLOCKED。


## 2026-11-22 共通返金RPCの実装契約整理
- `spend_coins` と `spend_coins_legacy` を追加確認。グローバル更新ロックを最初に取得し、支払者の `users` 行を `FOR UPDATE` でロック、残高更新とledger INSERTを同一トランザクションで実行する構造を確認。
- 返金処理で `spend_coins` を呼ぶと再度debitになるため、元debitの `amount`・`user_id`・business referencesから返金値を導出する専用RPCが必要と整理。
- 既存のキャンセル／拒否／自動却下返金writerは残高加算と `admin_adjustment` INSERTを個別実装し、source debit IDを返金行に保持しない点を確認。
- 共通RPCのロック順序、source ID一意制約、元debit検証、既存返金backfillの停止条件、呼出元移行順序、業務判断待ち項目を `docs/20261122_V48_REFUND_COMMON_RPC_IMPLEMENTATION_PLAN.md` に記録。
- 実DB `coin_transactions` の正確な型・制約・trigger/RLSは未取得。V2 read-only preflight結果が得られるまでmigration/DDL/backfill/RPC置換は行わない。
- SQL・DBデータ・アプリケーションコードは変更していない。build/test/lint/typecheck/ローカルチェック、Push、Deployも未実施。公開判定BLOCKED。

## 2026-11-22 返金writer全件インベントリ

- `docs/20261122_V48_REFUND_WRITER_INVENTORY.md` を追加。migration内の返金writerを契機別に整理し、直接依頼自動却下・辞退・退会、個別matchキャンセル、イベント／レンタル全体キャンセルの返金経路を列挙。
- V48.004の `event_match_transaction_fee` と `facility_reward_fee`、V48.005の `lesson_match_fee` は課金元snapshotを持つ一方、既存cancel/withdrawal返金経路に接続されていない点を明示。
- 応募手数料、facility reward fee、lesson fee、イベント初回fee、completion feeは業務ルール未確定のため返金実装を保留。
- 管理者コイン付与・Stripe返金はコイン台帳のfee返金と区別。
- 今回は静的ソース調査と文書更新のみ。実DB照合・SQL実行・コード変更・build/test/lint/typecheck/ローカルチェック・Push・Deployは未実施。公開判定BLOCKEDを維持。

## 2026-11-22 本番反映優先方針に基づく整理

ユーザーの最新方針により、次の最優先は本番反映とLINE実機確認によるSupabaseデータ収集である。広範な静的監査を追加し続けず、本番安全性に直結する阻害要因を解消してから段階反映する。

- README.txt / README.md のV47.1 src-only説明を修正し、本ZIPがsrc・Supabase migrations・docs等を含む統合候補であることを明示。
- V48.001〜005のmigration候補順序をrunbookとmanifestに統一。
- V48.004のイベント／レンタルper-match fee・facility_reward_fee、およびV48.005 lesson_match_feeが既存cancel/withdrawal返金経路に未接続であることを本番適用阻害要因として集約。
- 実DB preflight、source transaction IDに基づく返金統合、イベント／レンタル旧completion feeとの二重課金解消が完了するまで本番適用しない。
- 新設 `docs/20261122_V48_DEPLOYMENT_GATE.md` を本番反映の単一ゲートとして参照する。

今回の作業は文書整合性の修正のみ。ソースコード・migration SQLロジック、Supabase、GitHub、Vercelは変更していない。build／lint／test／typecheck／ローカルチェックも未実施。


## 2026-11-22 返金元取引preflightの実行手順
- `docs/20261122_V48_REFUND_PREFLIGHT_EXECUTION_GUIDE.md` を追加。対象本番Project Refの確認、Supabase SQL EditorでのSELECT単位実行、全結果の保存、エラー記録、機微データの安全な共有、結果記録表を定義。
- 既存のV2 SQLは変更していない。複数SELECTを一括実行した場合の結果取りこぼしを避けるため、各SELECTを個別に実行する運用とした。
- SQL実行・DB変更・アプリソース変更・build/test/lint/typecheck/ローカルチェック・Push・Deployは未実施。公開判定BLOCKEDを維持。


## 2026-11-22 本番Stage 0結果反映

- ユーザー共有の本番Stage 0結果で `application_attempts` / `match_fee_snapshots` / `lesson_fee_snapshots` が存在しないことを確認。
- `lesson_applications` は `lesson_offer_id` / `applicant_performer_id` を持つ。Stage 0で不足と表示された `offer_id` / `teacher_user_id` はV48.005が要求する列ではなく、Stage 0の期待列定義の誤り（false positive）と確認。V48.005が参照するlesson_applications列は今回確認された実列と一致。
- V48.001/004/005とV2 preflightは本番実行禁止を維持。V2には存在しないsnapshot表を直接参照するSELECTが含まれるため、現状では実行しない。
- 次の調査として、業務データを取得しないカタログ専用 `docs/20261122_V48_STAGE1_BASELINE_READONLY.sql` を追加。実lesson schema、migration history table所在、関連RPC signature/security metadataを確認する。
- DB、migration、アプリソースロジックは変更なし。build/test/lint/typecheck/ローカルチェック、Push、Deployは未実施。
- 本番反映判定はBLOCKED。
