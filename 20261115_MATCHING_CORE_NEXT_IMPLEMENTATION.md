# Hakotohito matching core 次段階実装台帳（2026-11-15）

## 目的

Tokyo本番へ切り替えた現状から、最短で安全に公開できる機能範囲を固める。既知の監査結果を繰り返さず、matching coreの修正を一括設計する。

## 公開対象の優先順位

### P0：公開前に必須

1. LINE ID token認証とユーザー種別・所有権確認
2. プロフィール・募集一覧・募集詳細
3. 応募・採用・直接依頼
4. 個別キャンセル・全体キャンセル
5. 完了報告・完了確定・異議申立て
6. コイン徴収・返金・台帳整合
7. LINE通知（失敗時の永続再送を含む）
8. 退会処理（未承認直接依頼返金、band等の関連状態を含む）

### 公開時は停止を維持

- レッスン：既存feature flag/API停止を維持。今回のP0修正に混ぜない。
- Stripeコイン購入：`coin_purchase_enabled=false`を維持。005〜008のfencing／現行DB差分が解決するまで有効化しない。

## 既知所見を踏まえた今回のソース追加監査

### 1. 完了報告API

対象：
- `src/app/api/facility/matches/[id]/complete/route.ts`
- `src/app/api/performer/matches/[id]/complete/route.ts`

現状、両APIは`matches`を直接UPDATEして各側の完了報告日時を記録している。DBの完了・キャンセルRPCが利用するロック規約を迂回する。両APIを同じDB RPCへ集約し、`actor_side`だけを引数にする。RPC内で認証済みユーザーとmatch参加者の対応、request gate、performance_date、status、dispute状態、報告の初回登録を一つのtransactionで判定する。通知イベントも同じtransactionでOutboxへ記録する。

### 2. 募集編集・削除API

対象：`src/app/api/performance-requests/[id]/route.ts`

現状、PATCHは`performance_requests`を直接UPDATE。DELETEは応募件数・match件数の事前SELECT後に直接DELETEしている。確認と削除が別transactionであり、同時応募との競合が残る。所有者・募集status・応募履歴・match履歴の検査と更新／削除を一つのDB RPCに移す。DELETEは履歴が一件でもあればfail-closedとし、既存の業務仕様を維持する。

### 3. 応募・採用・キャンセル

- 個別キャンセルはmatchをcancelし、紐づくapplicationを`rejected`へ戻す。
- requestが`open`なら同じ演奏者の再応募を許可する。イベント／レンタル等の募集状態・定員仕様は既存ルールを維持する。
- イベント／レンタル初回料金はrequest ID単位でonce。キャンセル返金後の再成立で再徴収しない。
- 現行の採用・応募・キャンセル・返金RPCの行ロック順は混在しているため、application状態だけを直す単独SQLは作らない。

### 4. 退会・band・lessonの横断競合

request gate単独では不十分。既知のuser→band、band→user、offer→user、user→offer、request→match、match→requestの循環を同時に解消する必要がある。退会は複数aggregateを横断するため、対象IDの非ロック収集→固定ドメイン順位／ID順のgate取得→対象集合再検証→固定テーブル順位で行ロック、という全体契約が完成するまで006候補を適用しない。

### 5. 通知Outbox

キャンセル・退会・完了・返金の業務状態変更と同じDB transaction内でOutbox行を作成する。API応答に含まれる一時配列を通知の唯一の根拠にしない。workerはclaim、attempt_count、next_attempt_at、last_error、sent_atを永続化し、失敗を再送する。LINE送信成功直後のworker停止による重複はat-least-once前提で扱う。退会時は匿名化前に宛先LINE IDをOutboxへ保持するため、参照権限・マスキング・保存期間・削除方針も同時に定義する。

## API直接書込の追加棚卸し

| 優先度 | 経路 | 現状 | 次の処置 |
|---|---|---|---|
| P0 | facility/performer complete | matches直接UPDATE | 共通完了報告RPCへ統合 |
| P0 | performance-requests PATCH/DELETE | request直接UPDATE/DELETE、DELETE前検査が別要求 | gate付きRPCへ統合 |
| P0 | cancel/withdraw通知 | DB確定状態と送信処理が分離 | Outbox transactionへ統合 |
| P1 | performer/facility profile | usersとprofileを複数要求で更新 | 退会状態再検証を含む原子RPC候補 |
| P1 | band invitations | band invitation直接INSERT | band状態・leader認可をDB側で再検証するRPC候補 |
| P2 | favorites | INSERT/DELETE | request/match gate対象外。認証・重複制約を維持。今回のuser_idレスポンス修正後に実機確認 |
| 別領域 | Stripe webhook / checkout | order/incident直接更新 | Stripe購入停止を維持し、claim fencingとCAS/RPC設計完了後に修正 |
| 別領域 | inquiry/admin/chat/messages | 別aggregateの書込 | matching core公開阻害と混同せず、権限・退会状態の監査対象として追跡 |

## 実装順序（まとめて切り替える）

1. 全mutation入口・内部helper・trigger・API直書き・Cron・Edge Function・外部schedulerの一覧を固定。
2. account/request/band/lesson offer/payment orderのaggregate gateのドメイン順位を定義。複数aggregate操作は全gateを先に取得し、対象集合を再検証。
3. 行ロック階層・テーブル順位・主キー順、operation/idempotency/refund keyの取得順を定義。
4. public RPCがgateを取得し、internal helperはgate取得済み契約に統一。内部helperのgate後取りを禁止。
5. 完了報告、案件編集／削除、応募／採用、キャンセル、完了、退会を同じ契約に移行。
6. application rejected遷移、once料金、返金、Outboxを同じtransactionへ統合。
7. APIを新RPCへ切り替え、DB直接書込の迂回を閉じる。
8. migration preflight／postflight／rollbackをTokyo現行定義に合わせて生成。
9. テストDBで同時実行シナリオを検証後、SQL適用と本番切替は個別承認を得る。

## 変更しなかった理由

この段階で個別RPCにadvisory gateだけを追加したり、キャンセルSQLだけを単独修正すると、既知の逆順ロックを残したまま部分導入することになる。公開安全性を下げるため、matching coreのDB変更は全経路を同時に切り替えられる形にまとめる。お気に入りの`user_id`レスポンス修正は独立したAPI契約修正として作業用ソースに反映済み。

## 変更境界・未実施

- 作業用パッケージ内の監査文書のみ更新。
- Supabase（Tokyo／Mumbai）、実リポジトリ、GitHub、Vercelは変更しない。
- SQL実行・DB適用、Git commit／push、deployは未実施。
- build／lint／test／typecheck／ローカルチェックは実施しない（ユーザー指示）。
- 公開判定は引き続きBLOCKED。P0の一括修正が完了し、別途承認された後にのみ公開準備へ進む。
