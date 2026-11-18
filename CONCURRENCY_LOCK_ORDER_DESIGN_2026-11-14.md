# 並行処理・ロック順序統合設計案（2026-11-14）

## 状態

**設計案。実装・SQL適用候補ではない。** 読み取り専用DBエクスポートと統合候補SQLを静的照合して作成。DB実行、ローカルチェック、build／lint／testは未実施。

## 1. 確認済みの現行ロック順序

| 処理 | 現行の主な取得順 | 問題 |
|---|---|---|
| `accept_application_with_coins` | `performance_requests` → `bands`（バンド応募時）→ `applications` → `spend_coins`の冪等advisory lock → `users` | 案件内の採用は先頭の案件ロックで直列化される。 |
| `cancel_match_with_direct_invite_refund` | request IDを無ロック読取 → `performance_requests` → 施設`users` → `matches` → `applications` → 返金advisory lock | 採用と同じ案件ロックを最初に取るが、match/applicationより先にuserをロックする。 |
| `reject_direct_invitation_with_refund_for_withdrawal` | request IDを無ロック読取 → `performance_requests` → 施設`users` → `applications` → 返金advisory lock | applicationより先にuserをロックする。戻り値に今回返金したかの情報がない。 |
| `cancel_event_request_with_refund_internal` | `performance_requests` → 施設`users` → `matches`（ID順）→ `applications`（ID順）→ 返金advisory lock | request内のmatch/applicationの順序は整っているが、userがmatch/applicationより先。 |
| `complete_match_with_fee` | `matches` → `performance_requests` → `applications`参照 → 返金／手数料advisory lock → payer `users` | cancel系のrequest → matchと逆順。具体的なデッドロック経路がある。 |
| `register_completion_dispute` / `agree_completion_dispute` | `matches`を先にロック。requestは参照のみ／未ロック | match状態変更の全経路でrequest gateを共有する必要がある。 |
| `manage_completion_dispute_case` | `matches` → dispute case | match→case順は同関数内で一貫。request gate参加が必要。 |
| 006候補 `withdraw_user_account` | 退会者`users` → profile → `matches`（matched_at順）→ 既存cancel RPC | matchを保持してrequestを待つため、通常キャンセルとの循環が成立する。 |

## 2. 具体的なデッドロック経路

### 2.1 退会と個別キャンセル

1. 退会トランザクションWが対象match行を`FOR UPDATE`で取得する。
2. 通常キャンセルトランザクションCが同じ案件行を`FOR UPDATE`で取得する。
3. Wが`cancel_match_with_direct_invite_refund`を呼び、案件行を待つ。
4. Cが同じmatch行をロックしようとしてWを待つ。
5. Wはmatch、Cはrequestを保持したまま相互待ちとなる。

### 2.2 演奏完了と個別／全体キャンセル

1. `complete_match_with_fee`がmatch行を先に`FOR UPDATE`する。
2. 個別キャンセルまたは全体キャンセルがrequest行を先に`FOR UPDATE`する。
3. 完了処理は後続でrequest行を`FOR UPDATE`するためキャンセル側を待つ。
4. キャンセル側は後続のmatch行ロックで完了処理を待つ。
5. match → requestとrequest → matchの循環が成立する。

これは退会候補だけの問題ではない。既存DBの`complete_match_with_fee`自体が、既存キャンセルRPC／全体キャンセルRPCと逆順のロックを取得している。

したがって006だけを修正しても不十分であり、完了・異議申立て・合意解決を含むmatch更新系RPCも共通gateに参加させる必要がある。退会者user行のロックを単に外すだけでは、match/requestの循環や複数案件にまたがるロック順序を解消しない。

## 3. 統一案：request gateを全mutationの最初に取得

### 3.1 論理ロック

案件に関係するすべての状態変更RPCは、対象requestのトランザクションadvisory lockを、**テーブル行ロック・user行ロック・match/application行ロックより前**に取得する。

- キー案：`hashtextextended('hakotohito:request:' || request_id::text, 0)`
- 複数requestを扱う処理（退会、複数案件一括処理）は、request UUID昇順に全gateを取得してから次へ進む。
- request IDがまだ確定しない場合は、非ロック読取で候補IDを収集し、gate取得後に所有者・状態・対象集合を再読込する。集合が変化していたら安全側に中断して再試行させる。
- すべての関連RPCが同じgate規約を採用しない限り、導入しても保証にならない。部分導入は禁止。

### 3.2 行ロック順

request gate取得後の標準順序案：

1. `performance_requests`（request UUID昇順）
2. `bands`（band UUID昇順。必要な処理のみ）
3. `matches`（match UUID昇順）
4. `applications`（application UUID昇順）
5. 返金・消費の冪等advisory key（文字列キー昇順）
6. `users`（user UUID昇順）

複数request・複数userを扱う場合は、各階層をまとめて昇順取得する。下位階層を取得した後に上位階層へ戻る処理を禁止する。

### 3.3 既存関数の変更対象

- `cancel_match_with_direct_invite_refund`：request gateを最初に取得。request → match → application → 返金key → userの順に変更。
- `reject_direct_invitation_with_refund_for_withdrawal`：request gate → request → application → 返金key → user。今回返金したかを`refunded_now`等で返す。
- `cancel_event_request_with_refund_internal`：request gate → request → matches → applications → 全返金key → user。複数返金keyの取得順を固定。
- `accept_application_with_coins`、`accept_direct_invitation_atomic`、直接招待送信、個人／バンド応募、個別キャンセル、`complete_match_with_fee`、`register_completion_dispute`、`agree_completion_dispute`、`manage_completion_dispute_case`、退会など、同一request/match/applicationを更新する全RPCもgate対象とし、漏れがないよう関数一覧を確定する。match IDからrequest IDを得る必要があるRPCは非ロック読取でrequest IDを取得し、gate取得後にmatch/requestの紐付けを再検証する。
- `withdraw_user_account`：退会対象user/profileを最初にロックしない。対象request集合を収集し、全request gateを昇順取得してから再検証。その後に関連match/applicationと返金先usersを標準順でロックする。単純に既存cancel RPCをmatchロック保持中に呼ばず、ロック済み対象を処理する専用内部処理へ統合する。

## 4. 重要な設計上の制約

- `spend_coins`は現状、冪等advisory lockを取得してから`spend_coins_legacy`へ進む。最終的なuser行ロック順と整合するよう、関連RPCの全経路を追跡する必要がある。既存の冪等キーの意味・一意性は変えない。
- 返金処理は「履歴をSELECTしてからhelperを呼ぶ」二段階判定を廃止する。返金helperが同一トランザクション内で返金の新規実行／既返金を判定し、結果に`refunded_now`を含める。
- 返金と通知outbox行の作成は同じDBトランザクション内で行う。outboxの一意キー例：`event_type + aggregate_id + recipient_user_id`。ただし、同一受信者へ同一matchに対して異なる通知種類が必要な場合はevent_typeを含めて分離する。
- outbox workerは`FOR UPDATE SKIP LOCKED`等で送信待ちをclaimし、attempt_count、next_attempt_at、last_error、sent_atを保存。LINE送信成功後のみsentにする。送信API成功直後にworkerが落ちると重複送信の可能性が残るため、LINE側に冪等キー機能がない前提では「at-least-once＋通知ID表示／重複許容」の設計判断が必要。
- 退会ユーザーのLINE IDを匿名化する前に、必要な通知先IDをoutboxに永続化する。IDを含むoutboxのアクセス権限・保存期間・削除方針を決める。

## 5. Stripe Webhookとの共通化

- webhook event claim tokenはfencing tokenとして扱い、Stripe eventのDB副作用を実行するRPCにもtokenを渡す。
- DB RPCはevent rowをロックしてtokenが現在のprocessing tokenと一致することを検証してから、order／incident更新を同一トランザクションで行う。
- 外部Stripe API取得などDBトランザクション外の処理を行う場合、取得後に必ずtokenを再検証し、失効済みworkerは副作用を実行できないようにする。
- order単位のロック順を統一し、payment order → incident rows（ID順）→ user balance row → ledgerの順を全関連RPCで共有する。event単位・order単位の両方の冪等キーを維持する。
- 5分leaseだけで二重実行を防ぐ設計にはしない。heartbeatまたは十分なleaseとfencing検証を組み合わせる。

## 6. 実装前に必要な追加証拠

1. 現行DBに存在する全mutation RPCの完全な関数定義（応募、直接招待、承諾、採用、個別／全体キャンセル、完了、異議申立て、退会、バンド、レッスン、コイン移動）。今回のスキーマエクスポートから、少なくとも`complete_match_with_fee`がmatch → requestの逆順であることを追加確認済み。
2. `spend_coins_legacy`の完全定義と、残高更新・ユーザー行ロックの位置。
3. 全関数のowner、EXECUTE ACL、RLS／テーブル権限、default ACL。
4. Stripe incident管理RPCの正しい完全定義。現在の証拠ファイル名と内容に不一致があるため、現状の断片から管理者の再オープン動作を推定しない。
5. LINE通知送信関数／APIの送信失敗・タイムアウト・再試行挙動。

## 7. 適用判定

この設計案だけでは006・007・005の適用承認にはならない。全mutation RPCのgate参加と行ロック順を照合し、通知outboxの権限・個人情報保持・worker運用を決め、差分SQLを作成した後に再監査する。SQL実行・Supabase適用・GitHub Push・Vercel Deployは別途個別承認が必要。

## 8. 2026-11-14 追加：DB関数エクスポート内のmutation RPC棚卸し

以下は提供済み `evidence/schema(2).sql` に含まれる関数定義を対象にした静的棚卸し。エクスポートに存在しない関数や、別スキーマ・別DBにだけ存在する関数まで網羅したという意味ではない。

### 8.1 request gate必須候補

| 関数 | 現行ロック・処理順（確認できた範囲） | gate導入時の修正点 |
|---|---|---|
| `apply_to_performance_request` | request → application → `spend_coins` | request取得前にrequest ID gate。応募者プロフィールの読取はgate前でも非ロックなら可。 |
| `apply_to_performance_request_as_band` | request → band → application → coin settings → user → `spend_coins` | gateを最初に追加。user行を`spend_coins`より先にロックしており、idempotency advisory key→userの順と逆転するため、user先行ロックを除去または冪等keyを先に取得する設計へ変更。 |
| `accept_application_with_coins` | request → band（該当時）→ application → `spend_coins` | gateをrequest行より先に追加。現行の後段は共通順序に比較的近い。 |
| `accept_direct_invitation_atomic` | applicationとのjoinでrequestをロック → application → match作成／更新 → `spend_coins` | application IDからrequest IDを非ロック取得し、gate後にrequest/application紐付けを再検証。 |
| `create_facility_invitation_with_coins` | request → application関連処理／コイン消費 | gateをrequest行ロックより先に取得。application・idempotency・user順を完全定義で再確認。 |
| `reject_direct_invitation_with_refund` | request → user → application → refund advisory key／残高更新 | userをapplication・返金keyより先にロックする順序を変更。返金keyの確保とuser行ロックを標準順に統一。 |
| `reject_direct_invitation_with_refund_for_withdrawal` | request → user → application → refund advisory key／残高更新 | 上記と同様。さらに`refunded_now`を返してoutbox登録と同一transactionにする。 |
| `cancel_match_with_direct_invite_refund` | request → facility user → match → application → refund advisory key | match/applicationより前のuserロックを後段へ移動。複数返金keyの取得順も固定。 |
| `cancel_event_request_with_refund_internal` | request → facility user → matches（ID順）→ applications（ID順）→ 複数refund key／user更新 | facility userを先にロックする順序を変更。複数match/application/refund keyを全件収集して階層別にソート・ロックする。 |
| `complete_match_with_fee` | match → request → application参照 → fee advisory key → payer user | match IDからrequest IDを非ロック取得し、request gate→request→matchへ順序変更。 |
| `register_completion_dispute` | matchを先にロックし、状態更新 | matchからrequest IDを非ロック取得してgateを先に取得。gate後に紐付け・状態再検証。 |
| `agree_completion_dispute` | matchを先にロックし、match・case履歴更新 | 同じrequest gateに参加。match→admin caseの下位順序を全関数で固定。 |
| `manage_completion_dispute_case` | matchをロック後、caseをロック・状態更新 | case IDから対象match/requestを非ロック読取してgate取得。gate後にcase/match紐付けを再検証。 |
| `create_review_with_reward` | match → reviewer user（報酬付与時） | レビュー可能な完了済matchも同じgateを先に取得し、match→idempotency→userへ統一。 |
| `withdraw_user_account` | user → profile → match（複数）→ cancel RPC等 | user/profile/matchの先行ロックを廃止。対象request集合を収集しUUID昇順で全gateを取得、集合再検証後に標準順で処理。 |

### 8.2 request gate対象外または別gateで扱う関数

- `admin_grant_coins`：requestを扱わない。現在はidempotency advisory key→user行の順。コイン台帳の共通ルールに従う。
- `spend_coins`／`spend_coins_legacy`：汎用コインRPC。idempotency key→user行の順を維持。`p_request_id`が指定される直接呼出し経路が存在する場合、request gateを呼出元で必ず先に取得する契約を明示し、RPC単独実行を許すなら内部でgate取得する。下位処理からgateを後取りする設計は禁止。
- `transfer_band_coins`：band/memberの確認・idempotency key・複数user残高を扱う。request gateではなくband単位gateが必要か、band application／退会との競合を含めて別途確認。複数userはUUID昇順にロック。
- `disband_band`、`respond_to_band_invitation`：band/member状態の更新。requestに紐づかない操作でも、active band membershipを参照するrequest応募・退会との競合があるため、band行ロックを共通化し、request gate取得後にbandを取る関数と逆順にしない。
- `apply_to_lesson_offer`、`create_lesson_offer`、`create_lesson_offer_with_levels`、`create_lesson_offer_with_levels_and_address`、`update_lesson_offer_with_levels`：lesson offer／予約／user残高系の別ドメイン。performance request gateの対象外だが、lesson offer→application→user等の独立したロック順を棚卸しする。
- `create_band_with_leader`：新規band作成。既存requestを更新しないためrequest gate対象外。
- `configured_coin_fee`、`configured_lesson_fee`、`digest`、`set_initial_coin_balance`、`prevent_disputed_match_cancellation`：読み取り関数・trigger等。状態変更RPCから呼ばれるtriggerのロック副作用は個別に確認。

### 8.3 追加で確定した順序不整合

1. `apply_to_performance_request_as_band`は、応募手数料の`spend_coins`呼出し前に`users`行を`FOR UPDATE`する。その後`spend_coins`が冪等advisory keyを取得するため、提案している「idempotency key → user」順と逆転している。band応募経路も修正対象。
2. `reject_direct_invitation_with_refund`と退会用helperは、user残高行をapplication行・返金advisory keyより前にロックする。キャンセル・返金の共通順序へ並べ替える必要がある。
3. `cancel_match_with_direct_invite_refund`と`cancel_event_request_with_refund_internal`も、match/applicationより先に施設userをロックする。`complete_match_with_fee`だけをrequest gateへ参加させても、これらの行ロック順が不一致のままなら他のuser/match競合が残る。
4. `submit_personal_application_idempotent`／`submit_band_application_idempotent`はoperation advisory lockを取得してから応募本体を呼ぶ。request gateを全mutationの最初にするなら、request IDを先に解決し、request gate→operation advisory lock→応募本体の順にする必要がある。wrapper経由とRPC直接経由の両方で同じ契約を強制する。
5. `spend_coins`は汎用RPCのため、`p_request_id`がある呼出しでgate取得責務を呼出元とRPCのどちらが持つか明確にする。既に行ロックを取得した後でgateを取得する二重経路は作らない。

### 8.4 gate設計に関する補足

- transaction advisory gateは、同一requestに関するすべての競合処理が同じキー・同じロック方式を使う場合にのみ直列化を保証する。直接テーブル更新、別RPC、trigger、管理者操作、service_roleからの直接SQLがgateを迂回しないか、APIソースとDB権限も含めて棚卸しする。
- request IDを非ロック読取した後にgateを取得する場合、gate取得後にrequest・match・applicationの関連付けと状態を必ず再検証する。削除・再紐付け・状態変化を検出したら安全側に中断する。
- 同一トランザクション内でgateを複数回取得する再入は避け、入口RPCで一度だけ取得する。内部helperは「gate取得済み」を契約化し、独立実行可能な公開RPCには入口側gateを実装する。
- UUID順の複数request gate取得後に、各requestの全match/application/refund keyを階層ごとに集める。request Aの下位ロックを取ってからrequest Bの上位ロックへ戻る実装は避ける。

## 9. 追加監査の結論

今回の関数棚卸しにより、共通request gateの対象は少なくとも応募・採用・直接招待・拒否返金・個別／全体キャンセル・完了・異議申立て・レビュー報酬・退会に及ぶことを確認した。さらにband応募ではuser行とidempotency advisory keyの順序逆転がある。

従って、単純にrequest gateを各関数の先頭へ追加するだけのSQLパッチは作成しない。入口RPC／内部helperの責務分離、全件事前収集、行ロック階層、コイン冪等key、band gate、通知outbox、Webhook fencingを一体で再設計し、証拠の不足する関数定義を追加取得してから実装候補を作る。

## 10. 2026-11-14 追加：バンド・レッスン・コイン移動のロック循環

今回の追加照合対象は、提供済み `schema(2).sql` 内の `apply_to_performance_request_as_band`、`respond_to_band_invitation`、`disband_band`、`transfer_band_coins`、`apply_to_lesson_offer`、`update_lesson_offer_with_levels`、`withdraw_user_account`。以下は関数本文で確認できたロック順序であり、実DBでの同時実行試験ではない。

### 10.1 確認できたロック順序

| 関数 | 先行ロック | 後続ロック／更新 | 判定 |
|---|---|---|---|
| `apply_to_performance_request_as_band` | `performance_requests` → `bands` → `applications` → coin settings | `users FOR UPDATE` → `spend_coins`（内部でidempotency advisory lock） | band→userとuser→idempotencyの両方が他経路と競合。 |
| `respond_to_band_invitation` | 招待performerの`users FOR UPDATE` | `bands FOR UPDATE` → `band_invitations FOR UPDATE` | user→band。band→user経路と逆順。 |
| `disband_band` | `bands FOR UPDATE` | `band_invitations`／`band_members`更新 | band行を先に取得。退会処理のuser→bandと競合し得る。 |
| `transfer_band_coins` | 送金idempotency advisory lock → `bands FOR SHARE` → `band_members FOR SHARE` | 送信元・受取先`users FOR UPDATE`（UUID昇順） | band→user。退会処理のuser→bandと循環し得る。 |
| `apply_to_lesson_offer` | `lesson_offers FOR UPDATE` | 講師`users FOR UPDATE` → application作成・残高更新 | offer→user。退会処理のuser→offerと逆順。 |
| `update_lesson_offer_with_levels` | 対象`lesson_offers FOR UPDATE` | 講師`users FOR UPDATE` | offer→user。退会処理のuser→offerと逆順。 |
| `withdraw_user_account` | 退会対象`users FOR UPDATE` → profile | match取消RPC呼出し、lesson offer更新、band更新等 | userを先に保持したまま複数ドメインの行を更新する。 |

### 10.2 デッドロック経路（関数定義から成立し得る循環）

**A. バンド応募／送金と退会**

1. バンド応募または`transfer_band_coins`がband行をロックする。
2. 退会が対象user行をロックし、その後に同じband行を更新しようとする。
3. バンド側処理は後続のuser行ロックを待つ。
4. 退会側はband行ロックを待つ。
5. band→userとuser→bandの循環になる。

**B. バンド招待回答とバンド応募**

1. `respond_to_band_invitation`が招待されたperformerのuser行を先にロックする。
2. `apply_to_performance_request_as_band`がrequestの後にband行をロックする。
3. 招待回答が同じband行を待つ一方、バンド応募はリーダーのuser行を待つ場合、user→band／band→userの循環になる。

**C. レッスン応募・編集と講師退会**

1. `apply_to_lesson_offer`または`update_lesson_offer_with_levels`がlesson offer行を先にロックする。
2. 退会が講師user行を先にロックし、後続の`UPDATE lesson_offers`で同じoffer行を更新しようとする。
3. レッスン側処理は講師user行を待ち、退会側はoffer行を待つ。
4. offer→userとuser→offerの循環になる。

これらはrequest gateだけを追加しても解消しない。退会はrequest・band・lesson offerの複数ドメインを横断するため、単一ドメインのgate取得だけでは不足する。

### 10.3 共通設計案の修正

前節までの「request gateを最初に取得し、その後request→band→match→application→idempotency→user」という単一階層案は、バンド・レッスンを含む全処理の最終設計としては不十分。現時点では確定設計に昇格させない。

再設計では、少なくとも次を満たす必要がある。

1. **ドメインgate層**：request、band、lesson offer、payment order等、同時更新対象となる全aggregateのgateを、固定されたドメイン順位＋ID昇順で、いずれのテーブル行ロックよりも前に取得する。
2. **複数ドメイン操作**：退会などは対象aggregate IDを非ロック読取で収集し、gateを一括取得後に対象集合・所有者・状態を再検証する。収集後に集合が変化していれば安全側に中断し、再試行可能な結果にする。
3. **行ロック層**：ドメインgate取得後に、各テーブルの行をテーブル順位・主キー昇順でロックする。user行を先に取ってからband／offer／request行へ戻ることを禁止する。
4. **冪等性advisory lock**：wrapper operation key、coin/refund key、band transfer key、Stripe event tokenの取得順位を別表にして固定する。呼出先内部で下位ロックを後取りしないよう、必要なkeyを入口で収集・取得するか、ロック取得責務を持つpublic RPCと内部no-lock helperを分離する。
5. **通知outbox／返金**：返金台帳とoutbox insertは同一トランザクション。通知の新規発生判定は返金helperの原子的な戻り値で行う。
6. **再試行**：デッドロック／serialization failure時はトランザクション全体をrollbackし、クライアントが安全に再試行できるエラー分類・ログを用意する。関数内で一部だけを再実行しない。

具体的なドメイン順位・テーブル順位は、全関数の完全定義、全呼出経路、trigger、API直書き更新を揃えてから確定する。現段階で順位を断定してmigration化しない。

### 10.4 今回の判定

- `withdraw_user_account`：request gate案だけでは不十分。band／lesson offerのgateと行ロック順も含めて再設計が必要。
- `apply_to_performance_request_as_band`：band→user／idempotency→userの順序を修正対象とする。
- `respond_to_band_invitation`：user→bandを解消し、band関連RPCと同じ順序へ統一する。
- `transfer_band_coins`：band→複数userの順序を維持するか、退会・他のband mutationと統一したgate設計へ移行する。
- `apply_to_lesson_offer`／`update_lesson_offer_with_levels`：offer→userの順序を退会処理と統一する。
- 006／007／005：この横断設計、outbox、Stripe fencingの完了までは引き続き適用不可。

SQL実行、DB適用、ローカルチェック、build／lint／test、GitHub Push、Vercel Deployは実施していない。

## 11. 2026-11-14 追加監査：Next.js APIからの直接DB更新経路

対象：統合候補ソース `src/app/api/**` の `.insert/.update/.upsert/.delete` 呼出しを静的検索し、DB RPCのロック規約を迂回する状態変更を分類した。これはソース内のSupabaseクライアント呼出しの棚卸しであり、DB内のservice_role直SQLや外部運用スクリプトは対象外。

### 11.1 集約gate・原子RPCへ移すべき高優先度経路

| API | 直接更新 | 並行制御上の問題 | 対応方針 |
|---|---|---|---|
| `src/app/api/facility/matches/[id]/complete/route.ts` | `matches.facility_completion_reported_at` | match行を直接更新し、完了RPC／キャンセルRPCと同じmatch状態に触れる。共通match/request gateを通らない。 | request IDを取得後、gate参加RPCで報告登録・状態検証・通知イベント作成を原子的に行う。 |
| `src/app/api/performer/matches/[id]/complete/route.ts` | `matches.performer_completion_reported_at` | 上記と同じ。施設側APIとの同時報告・キャンセルとの競合をDB契約に集約できていない。 | 同一の完了報告RPCへ統合し、sideのみ引数化。 |
| `src/app/api/performance-requests/[id]/route.ts` | `performance_requests` UPDATE / DELETE | 案件編集・削除が採用・応募・キャンセルのRPC外で実行され、対象requestのgateを取得しない。DELETE前のmatch count確認とDELETEも別リクエストで競合可能。 | request gateを取得する編集／削除RPCへ移行。削除可否・関連履歴検査・DELETEを同一transactionにする。 |
| `src/app/api/stripe/webhook/route.ts` | `payment_orders` UPDATE、`stripe_payment_incidents` UPSERT | claim tokenを確認するのはイベント状態更新のみ。Payment Intent紐付け、incident upsert、注文状態更新がtoken fencingを伴う単一DB transactionではない。 | event tokenを引数にするDB業務RPCへ統合し、token検証・order lock・incident/ledger変更を同一transactionで実行。 |
| `src/app/api/stripe/coin-purchase/route.ts` / `src/lib/stripe-marketplace.ts` | `payment_orders` INSERT / UPDATE | Checkout Session作成とDB保存は外部APIをまたぐ。失敗時に不確定状態・孤立Sessionを作り得る。既存Webhook処理と注文状態を直接更新する経路もある。 | order作成・状態遷移の許可状態をDB側でCAS/RPC化。外部Stripe API呼出しはDB transaction外に保ち、作成結果をorder version/state条件付きで確定。 |

### 11.2 退会・プロフィールとの競合を確認する経路

- `src/app/api/performers/route.ts`：`users` avatar UPDATE後に`performers` UPSERT。
- `src/app/api/facilities/route.ts`：`users` avatar UPDATEと`facilities` UPSERT、また別経路で`facilities` UPDATE後に`users` avatar UPDATE。
- `src/app/api/performers/profile/route.ts`：`performers` UPDATE。
- `src/app/api/facilities/route.ts`：`facilities` UPDATE。

これらは複数のPostgREST要求に分かれているため、各UPDATEが個別transactionでcommitする通常構造では、関数内の複数行ロック循環をそのまま構成するとは断定できない。ただし退会処理とプロフィール編集が競合した際に、退会済みユーザーのプロフィールが再作成・再更新される可能性、途中成功による片側だけの更新がある。退会状態を条件に含めるか、プロフィール変更を単一RPCへ集約し、user/profileの有効状態を同一transaction内で検証する必要がある。

### 11.3 低優先度・別ドメインの直接更新

- `src/app/api/favorites/route.ts`：favorites INSERT/DELETE。matching/coin stateを変更しないためrequest gate対象外。認証・重複制約を別途確認。
- `src/app/api/matches/[id]/chat/route.ts`、`src/app/api/bands/[bandId]/messages/route.ts`：conversation/message INSERT/UPDATE。match/band退会・アクセス権変更と整合する認可再検証が必要だが、現時点の抽出だけではロック循環は確定しない。
- `src/app/api/bands/invitations/route.ts`：band invitation INSERT。band gate・band状態・leader権限の検証をRPCに集約する候補。
- `src/app/api/admin/announcements/route.ts`、`src/app/api/admin/inquiries/[id]/route.ts`、`src/app/api/inquiries/route.ts`：告知・問い合わせ管理。matching gate対象外。
- `src/app/api/admin/coin-rates/route.ts`、`src/app/api/admin/payment-settings/route.ts`：設定行更新。購入開始・fee計算と同時変更時の設定snapshot／version整合を別途確認。
- `src/app/api/performers/route.ts`、`src/app/api/facilities/route.ts` のprofile/user更新は前項参照。

### 11.4 API直接更新の暫定判定

- 完了報告API、案件編集／削除API、Stripe Webhookの直接更新は、共通gate／fencingを確立する際に必ず移行対象に含める。
- Checkout Session作成は外部Stripe APIを含むため、長時間DB transactionで囲まず、状態遷移を条件付き更新・RPCで制御する。
- profile更新は直ちにデッドロックと断定しないが、退会状態の再検証・部分更新の原子性を修正対象にする。
- favorites、chat、announcement、inquiry等は別ドメインの認可・整合性監査対象として記録し、request gateを機械的に適用しない。

この追加棚卸しでも、Supabase DB内の全関数・trigger・Edge Function・service_roleスクリプト・外部管理SQLを完全に網羅したとは扱わない。全mutation RPCの完全なエクスポートと、API以外の書込経路の一覧が必要。SQL実行・build／lint／test／ローカルチェック・DB適用・Git操作・Vercel操作は未実施。


## 12. Trigger・Edge Function・Cronの追加照合（2026-11-14）

- 提供 `schema(2).sql` のtriggerは `trg_prevent_disputed_match_cancellation` と `users_initial_coin_balance` の2件。前者はcancel guardのみ、後者はLINE登録履歴と初期残高処理。別aggregateのmatch/request/band/lesson/paymentを更新する隠れたtrigger副作用は確認されない。
- `vercel.json` のcronは `/api/cron/auto-complete` 毎日1回。候補matchを読み取り、状態更新は `complete_match_with_fee` RPCに委譲する。Cron自体は直接UPDATEを迂回実行しないが、RPCのlock order／gate参加／冪等性に依存するため現時点では公開阻害。
- 提出ソースに `supabase/functions/` やDeno Edge Functionは含まれない。DB dumpにもpg_cron job定義は含まれず、Edge Functions／pg_cron／外部schedulerの存在有無は未確認。
- 完了報告API、Stripe Webhook、payment_orders作成・更新は別々のPostgREST要求で直接更新する。業務状態遷移とfencingを同一DB RPC/CASへ集約する。
- 今回の確認範囲は提供資料内に限定。全mutation経路の網羅性を証明するには、対象DBからtrigger catalog、routine定義、pg_cron.job、Supabase Edge Functions一覧、service_roleによる直接更新経路の追加証拠が必要。
