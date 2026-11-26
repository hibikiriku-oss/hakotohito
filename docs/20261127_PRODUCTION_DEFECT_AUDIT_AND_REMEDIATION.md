# 2026-11-27 本番不具合監査・修正候補

## 対象と基準

- 対象ソース：ユーザー提供 `music-matching.zip`
- ZIP内Git HEAD：`main` / `4da7f84a0dfd5de233168229ebc02265a79da79c`
- ZIP内作業ツリー：既存の未コミット変更が24ファイルに存在。これらを破棄せず、今回の候補パッケージにも保持する。
- Vercel本番の実際のデプロイcommitは、この監査環境からは照合できていない。
- 本文中の本番DB構造・対象案件件数は、ユーザーが提示したSupabase read-only結果に基づく。今回、Supabaseへの接続・SQL実行はしていない。

## 優先度1：イベント全体キャンセルのRPC欠落

### 確認事実
- UI：`src/app/facility/requests/[id]/page.tsx`
- API：`src/app/api/facility/requests/[id]/cancel/route.ts`
- APIは `cancel_event_request_with_notification_outbox(uuid,uuid,uuid)` を呼び出す。
- ユーザー提供の本番DB関数一覧には `cancel_event_request_with_refund_internal(uuid,uuid,boolean)` のみ存在し、APIが呼ぶOutbox wrapperは存在しない。
- `20261116_020_event_cancellation_notification_outbox.sql` は、内部キャンセル関数とOutboxを前提にwrapperを定義する候補migration。
- 対象のfestival案件は `status='open'`。申込期限切れ自体は内部関数の `status='closed'` 拒否条件ではない。内部関数はclosed状態または完了済みマッチングを通常キャンセルで拒否する。

### 原因
本番DBにAPIが呼び出すwrapper RPCが存在しないこと。PostgREST schema cacheだけの問題ではない。

### 候補修正
- `supabase/migrations/20261127_001_restore_event_cancellation_notification_outbox_rpc.sql`
- 既存内部キャンセル・返金RPCを呼び、同一transaction内でOutbox通知を登録する。
- 施設所有者・active accountをDB側でも検証。
- global mutation gateを先に取得し、案件行をロックしてから内部RPCへ進む。
- service_roleのみ実行可能にし、PostgREST schema reloadを通知する。

## 優先度2：施設案件の削除RPCが既知FKを未監査扱いする

### 確認事実
- 画面：`src/app/facility/requests/page.tsx`
- API：`src/app/api/performance-requests/[id]/route.ts` のDELETE
- DB RPC：`delete_open_performance_request_atomic(uuid,uuid,text)`
- APIはLINE ID tokenを検証し、`user_type='facility'` のactiveユーザーと施設プロフィールを取得する。RPCでも施設所有者・active account・LINE IDを検証する。
- 演奏者側の案件削除機能ではない。施設案件を演奏者が削除できるAPI経路は確認されていない。
- `20261118_008_atomic_performance_request_delete.sql` のFK allowlistは `applications`、`matches`、`application_attempts` の3テーブルだけ。
- ユーザー提供の本番DB FK一覧には7件あり、追加4件は次のとおり。
  - `application_band_trade_history`（RESTRICT）
  - `application_participant_claims`（RESTRICT）
  - `coin_transactions`（SET NULL）
  - `match_fee_snapshots`（RESTRICT）
- これら追加履歴テーブルは後続migration `20261122_001` / `20261122_004` で追加されているため、古い削除RPCのallowlistが追随していない。
- 対象案件データの提示結果では `カラオケ` と `テスト005` は7種類の関連行が0件。`テスト003`、`テスト004`、`ライブテスト用01` は履歴あり。

### 原因
実データの有無を調べる前に、既知のFKが3件以外にあることだけで `unreviewed_dependency` を返す設計になっている。

### 候補修正
- `supabase/migrations/20261127_002_fix_performance_request_delete_dependencies.sql`
- 7件のFK名・参照列・ON DELETE動作・validated状態を固定して検証し、未知のFKや親DELETE triggerがあればfail closed。
- 7つの関連テーブルすべてで対象request_idの行数を確認し、1件でも履歴があれば物理削除を拒否。
- 履歴がないopen案件のみ同一transaction内で削除。
- `match_fee_snapshots` は `20261122_004` で後から作成され、同migration内にglobal mutation gate triggerがないため、共通gate triggerを補完する。
- 既存のFK ON DELETE RESTRICT / SET NULL / CASCADEは変更しない。

## 優先度3：演奏案件の削除ボタン

- 施設の「自分の依頼一覧」から演奏案件も同じDELETE API/RPCへ送る。
- 画面の `canDelete` / `handleDelete` はopenまたは期限切れ（DB statusはopen）の案件を対象にしている。
- 演奏案件専用の別RPCは存在せず、共通削除RPCの依存関係チェックが拒否原因となる構造。
- 優先度2の修正で同じ経路を直す。演奏者に施設案件削除権限を追加しない。

## 優先度4：レッスン募集の楽器・ジャンル選択肢

- プロフィール新規登録 `src/app/performer/page.tsx` とレッスン募集登録 `src/app/performer/lesson/new/page.tsx` の選択肢が異なっていた。
- プロフィール登録の10楽器・10ジャンルへレッスン募集登録を統一。
- 併せて `src/app/performer/lesson/[id]/edit/page.tsx` も同じ選択肢へ統一し、既存の選択肢外の値は「その他」欄へ復元して保持する。

## 優先度5：施設演奏案件オファー編集UI

- 新規登録 `src/app/facility/request/page.tsx` は楽器・ジャンルをチェックボックスで複数選択し、その他の値も入力できる。
- 編集 `src/app/facility/requests/[id]/edit/page.tsx` は自由入力のカンマ区切りテキストだった。
- 編集画面を新規登録と同じカード型チェックボックス・その他入力に統一。
- 既存データのうち標準選択肢外の楽器・ジャンルは「その他」欄に復元し、保存時も保持。
- 「募集対象ランク」も新規登録と同じ説明付きカード、選択状態、選択中表示に統一。既存のtarget_levels未設定時は従来どおり全ランクを選択する。

## パッケージ変更一覧

### SQL
- `supabase/migrations/20261127_001_restore_event_cancellation_notification_outbox_rpc.sql`
- `supabase/migrations/20261127_002_fix_performance_request_delete_dependencies.sql`

### ソース
- `src/app/api/performance-requests/[id]/route.ts`
- `src/app/facility/requests/page.tsx`
- `src/app/facility/requests/[id]/edit/page.tsx`
- `src/app/performer/lesson/new/page.tsx`
- `src/app/performer/lesson/[id]/edit/page.tsx`

## 本番適用前の停止条件

read-only SQL：`docs/20261127_PRODUCTION_DEFECT_PREFLIGHT_READONLY.sql`。適用後確認：`docs/20261127_PRODUCTION_DEFECT_POSTFLIGHT_READONLY.sql`。

1. Supabase read-only preflightで、内部キャンセルRPC、Outboxテーブル／列、global gate trigger、7件のFK名・delete action・validated状態を再確認する。
2. `20261127_001` は `20261116_013` とOutbox `20261116_014` 以降の実オブジェクトが存在することを確認してから適用する。
3. `20261127_002` は7件のFKが期待どおりで、対象テーブルのglobal gateが有効であることを確認してから適用する。
4. SQL適用後にRPC signature・ACL・trigger・Outbox schemaをpostflight確認する。
5. その後にVercelへソースを反映し、LINE実機でキャンセル・削除・フォーム表示を確認する。

## 未実施・未確認

- Supabase SQL実行・DB変更：未実施
- GitHub commit/push：未実施
- Vercel deploy：未実施
- build / lint / test / typecheck / ローカルチェック：未実施（既定のユーザー指示に従い実行しない）
- Vercel本番の実デプロイcommit：未照合
- 今回の候補migrationの本番適用可否：read-only preflight待ち

**現時点の判定：ソース・SQL候補パッケージへの修正織り込みまで。Supabase preflightと本番適用前確認が終わるまで本番反映完了とは扱わない。**
