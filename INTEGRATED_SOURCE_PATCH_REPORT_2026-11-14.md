# Hakotohito 統合修正候補レポート（2026-11-14）

## 成果物の位置づけ

本パッケージは、2026-11-13版のソースZIPを基準にした**未検証の統合修正候補**。本番適用・公開用の完成版ではない。

- 元ZIPは変更せず、別の作業用コピーに編集。
- Supabase SQL、GitHub、Vercel、本番データには未反映。
- build／lint／typecheck／test／ローカルチェックはユーザー指示により実施していない。

## 今回の統合候補

### ソース

- `src/app/api/stripe/webhook/route.ts`
  - `claim_stripe_webhook_event`によるイベント排他claim。
  - processing tokenを持つ実行だけが状態を更新。0行更新・lease喪失は成功扱いしない。
  - 同一イベントの並行実行、失敗後の再試行、lease期限切れ再claimを想定。
- `src/app/performer/home/page.tsx`、レッスン一覧・詳細・新規・編集、`src/app/performer/map/page.tsx`
  - 変更系APIの503停止に合わせ、レッスン募集・編集・応募のUI導線を非表示。直接アクセスは停止案内、地図は演奏案件のみ。読み取りは残す。
- `src/app/api/account/withdraw/route.ts`
  - DBエラー詳細をクライアントへ返さず、409の再試行案内を返す。詳細はサーバーログに残す。
- `src/app/api/facility/requests/[id]/cancel/route.ts`
  - RPC実行前のactive matchesを通知対象にする方式を廃止。
  - DBが返す実キャンセルmatch IDから参加者を再取得し、個人・バンド全員を通知。
  - 返金済み未承認直接依頼の通知をマッチング中止通知とは別に送信。
- `PUBLIC_RELEASE_CHECKLIST.md`
  - 2026-11-14監査履歴・未完了事項・適用前提を追記。
- `KNOWN_AUDIT_FIXES_2026-11-12.md`
  - 個別キャンセル後の再応募可否に関する記述を、ユーザーが事前に確定した「applicationをrejectedへ戻し、同一演奏者は案件がopenなら再応募可能」という仕様へ修正。

### DB適用候補SQL

| Migration | 用途 | 対象 |
|---|---|---|
| `20261113_004_stripe_coin_purchase_only.sql` | Stripeコイン購入基盤。残高上限超過を`paid_review`化 | 新規基盤用。既存DBへ再適用しない |
| `20261114_005_stripe_webhook_atomic_claim.sql` | Stripe webhookの排他claim・lease | 既存Stripe基盤への差分 |
| `20261114_006_withdrawal_dual_role_direct_invite_refunds.sql` | dual-role退会・未成立直接依頼の実額返金・通知payload | 既存退会関数の置換候補。ロック順序確認必須 |
| `20261114_007_event_cancel_notification_targets.sql` | 全体キャンセル実キャンセルIDを返し、バンド通知を可能にする | 既存内部RPCの置換候補 |
| `20261114_008_stripe_balance_overflow_paid_review.sql` | 既存Stripe購入RPCの残高上限超過を`paid_review`化 | 既存Stripe基盤への差分 |

## 確定済みの業務ルール

- 個別キャンセル：関連applicationを`rejected`にし、同一演奏者は同じrequest IDが`open`なら再応募可能。バンド応募も現行DB関数は`rejected`行の再利用を実装しているが、個別の業務仕様として明示確認された記録はないため、追加の再応募禁止条件は設けない。
- 案件全体キャンセル：requestを`closed`。同じ案件IDで再募集せず、新しいrequest IDで作成。
- イベント／レンタル初回料金：同じrequest IDにつき一度だけ。返金後に同じ案件が再成立しても再請求しない。
- 退会時の未成立直接依頼：実際の引落額だけを元の施設ユーザーへ冪等返金。二重返金しない。

## 残る公開阻害事項

1. 006の退会用helper戻り値・owner・ACL・最新関数定義とロック順序の確認。
2. 007の現行DB内部関数・wrapper・参加者配列との完全差分確認。
3. レッスン停止のUI反映は候補作成済みだが、LINE実機での表示確認は未実施。
4. Stripe 005／008の対象DBへの適合確認。004は既存DBでテーブルが存在するためそのまま適用しない。
5. Stripe DashboardのWebhook購読、テストモードでの並列・再送・順序逆転・overflow・incident確認。
6. Stripe利用規約・特商法表示・法的確認。
7. default ACL、owner、RLS、function/table grantsの現行DB差分確認。
8. 1%完了手数料の実徴収、残高履歴照合、LINE実機、管理者最終確認。

## 適用・公開の境界

Supabase SQL適用、GitHub Push、Vercel Deploy、本番データ変更は、操作内容・対象環境・影響・復旧方法を個別提示し、個別承認を得た後に限る。ローカルチェックは実施しない。


## 2026-11-14追加静的SQLレビュー

- `20261114_006_withdrawal_dual_role_direct_invite_refunds.sql` の参加者通知用サブクエリに重複した `FROM unnest(` があったため1つに修正。
- 同 migration の `CREATE OR REPLACE FUNCTION` 終端にセミコロンが欠落していたため修正。
- `20261114_008_stripe_balance_overflow_paid_review.sql` も関数終端セミコロンが欠落していたため修正。
- これらは静的な構文レビューで見つけた候補SQLの修正であり、PostgreSQLでの実行検証は未実施。ユーザー指示によりローカルbuild/lint/test/checkは実行していない。
- `withdraw_user_account` はユーザー行を先にロックした後、既存キャンセルRPC／直接依頼返金helperへ進む。helper側の案件・施設ユーザー・applicationロック順序と競合した場合のデッドロック可能性が残るため、適用前にロック順序の再設計が必要。
- Stripe webhook claimの5分leaseは長時間処理で期限切れになり得る。処理tokenによるfencingは状態更新を保護するが、lease期限後の二重実行を完全に排除するものではない。実際の業務RPCの冪等性・同時実行時の順序を追加確認する。

- `20261114_007_event_cancel_notification_targets.sql` の未承認直接依頼通知先取得に重複した `INTO` があったため1つに修正。

## 2026-11-14 追加・関数契約／並行実行レビュー（未適用）

### 006 退会SQL：追加で確認した阻害事項

- 現行の `reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)` は、案件行 → 施設ユーザー残高行 → application行 → advisory refund key の順にロックする。
- 候補 `withdraw_user_account(text)` は最初に退会対象 `users` 行をロックし、その後にマッチング行をロックしてキャンセルRPCを呼ぶ。施設退会では退会対象ユーザー行とキャンセルRPCがロックする施設ユーザー行が同一になり得る。別トランザクションが案件行を先にロックして施設ユーザー行を待つと、退会側のユーザー行保持と案件行待ちが循環する可能性がある。現状の006はロック順序を解決していないため適用不可。
- 施設退会／演奏者退会の未成立直接依頼ループでは、返金済みキーの有無をhelper呼び出し前に別SELECTして通知要否を決めている。SELECT後、helper実行前に別トランザクションが返金を完了すると、helperは二重返金を防げても、退会側が「今回返金した」と誤認して通知を重複送信する競合が残る。
- helperの戻り値は `success, balance_after, error_message` のみで、今回返金したか／既返金だったかを区別できない。通知を正確に一度だけ発生させるには、DBトランザクション内のoutbox記録またはhelperの `refunded_now` 等の明示戻り値と通知イベントIDが必要。
- 退会APIはDB処理完了後にLINE Pushを送るが、送信失敗を永続化して再送するoutboxがない。退会自体は成功しているため、通知失敗が後から回復できない。

### 007 全体キャンセル：通知の再送性

- `cancelledMatchIds` によりDBが実際にキャンセルしたmatchだけをAPIが対象にする契約は一致している。
- ただしAPIはRPC完了後にmatches／performers／usersを再取得して通知先を構成し、LINE送信結果を永続化していない。取得・送信失敗時に同じキャンセルRPCを再実行しても、既にclosedのrequestでは通常再実行できず、通知だけを再送する手段がない。
- `pendingDirectInviteNotifications` も同様にDB応答内の一時データであり、送信失敗時の再送記録がない。キャンセルと通知の原子性は成立していない。

### 005 Stripe Webhook claim：lease期限後の副作用

- processing tokenはイベント行の最終状態更新をfenceするが、lease期限後に旧実行がまだ業務処理中の場合、新実行と旧実行の副作用が並行する可能性は残る。
- コイン付与RPCの注文ロック・冪等性は重複付与を抑止する一方、refund/dispute incident upsertやPayment Intent紐付け更新も、イベント再実行・イベント順序逆転を含めて同一注文行をロックするDB側の原子処理に統一する必要がある。
- lease延長（heartbeat）または十分な処理期限、fencing tokenを検証するDB側業務RPC、イベント単位の副作用冪等性をセットで確定するまで005を適用可としない。

### 次の統合修正方針

1. 退会処理は、ユーザー行を先にロックしたまま案件ロックを取得する現行候補を採用しない。全関係処理で共通のロック順序を定義し、対象案件・マッチ・施設残高・applicationを順序付きで事前ロックする方式、または処理予約／outbox方式を再設計する。
2. 返金helperの結果に「今回新規に返金したか」を明示し、通知イベントを一意キーでDBに記録する。LINE送信はoutbox worker等で再送可能にする。
3. 全体キャンセルも同じ通知outbox契約に統一し、RPC結果配列を一度限りの通知データとして使うだけの方式を解消する。
4. Stripe webhookはlease claimだけでなく、注文・事故レコードの副作用をDB関数内でロック／冪等化し、旧workerがlease喪失後に副作用を実行できない設計を検討する。

※ 以上は読み取り専用DB関数エクスポートと作業用ソース／SQLの静的読解による設計レビュー。SQL実行、build／lint／test／ローカルチェック、Supabase適用、Git操作、Vercel操作は行っていない。


### 2026-11-14 追加監査：退会キャンセルのロック循環と証拠ファイル照合

- 既存 `cancel_match_with_direct_invite_refund(uuid,uuid)` は、対象matchのrequest IDを先に読み取った後、案件行 → 施設ユーザー残高行 → match行の順でロックする。
- 006候補の退会処理は、先に退会対象users行・両プロフィールをロックし、さらに進行中matchを `FOR UPDATE` で取得してから `cancel_match_with_direct_invite_refund` を呼ぶ。このため退会側がmatch行を保持して案件行を待ち、通常キャンセル側が案件行を保持してmatch行を待つ循環が成立し得る。施設退会ではusers行の競合も加わる。これは単なる理論上の一般論ではなく、現行候補のロック取得順序から確認できる具体的なデッドロック経路であり、006は適用不可。
- 006を安全化するには、退会処理が事前にmatch行をロックしたまま既存キャンセルRPCを呼ぶ構造を解消する必要がある。RPCの内部ロックと重複する事前ロックを避け、キャンセル・退会・採用で共通する順序を定義する。単純にusers行のロックを外すだけでは、退会と通常操作の競合を別途防げないため不十分。
- 証拠ファイル名と内容の不一致を確認。`evidence/reject_direct_invitation_with_refund_for_withdrawal.sql` および `evidence/manage_stripe_payment_incident_20261114.sql` の内容は、いずれも `accept_application_with_coins(...)` の定義であり、ファイル名の関数定義ではない。退会返金helperの実体は `evidence/schema(2).sql` 内の `reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)` 定義で確認できる。一方、`manage_stripe_payment_incident(uuid,text,text,text)` の完全な定義は現時点の証拠セットから確認できず、管理者による状態変更・再オープン仕様は未確認として扱う。
- Stripe 008の `balance_overflow` upsertはincidentの `resolution_status` と `resolved_at` を更新しない。ただし同RPCは `paid_review` 注文を先頭で `alreadyProcessed` として返すため、通常の再実行経路ではupsert自体に到達しない。よって現時点では実害確定ではなく、管理者が注文状態を手動でpendingへ戻す等の例外運用を行う場合の整合性確認事項として保留する。
- SQL実行・DB接続・ローカルチェックは行っていない。上記は取得済みエクスポートと候補SQLの静的照合。

### 2026-11-14 追加：統一ロック順序の設計案

- `CONCURRENCY_LOCK_ORDER_DESIGN_2026-11-14.md` を追加。request単位のtransaction advisory gateを全mutationの最初に取得し、複数requestはUUID昇順でgate取得後、request → band → match → application → idempotency advisory key → userの順にロックする設計案を記録。
- 退会はrequest集合を先に収集してgateを昇順取得し、gate取得後に対象集合を再検証する。match行を先に保持したまま既存cancel RPCを呼ぶ構造は廃止する方針。
- 返金helperは`refunded_now`を返し、返金と通知outbox作成を同一DBトランザクションで行う。通知workerは再送管理する。ただしLINE送信成功直後のworker停止による重複は、LINE側冪等性がない場合に完全排除できないため、at-least-onceの扱いを決定する必要がある。
- Stripe Webhookはclaim tokenを業務RPCにも渡し、DB副作用の直前にfencing検証する方針。leaseだけで二重処理を防がない。
- これは設計案であり、関係する全mutation RPCの完全定義・ACL・`spend_coins_legacy`・通知送信経路の追加証拠が揃うまで実装SQLは作成・適用しない。

- 追加照合で、既存DBの`complete_match_with_fee`がmatch行→request行の順にロックし、個別／全体キャンセルはrequest行→match行の順にロックすることを確認。完了とキャンセルの並行実行でもデッドロックが成立し得るため、問題範囲を006退会候補だけでなく、既存の完了・異議申立て・合意解決RPCへ拡張。統一request gateはこれらすべての状態変更RPCで最初に取得する必要がある。

### 2026-11-14 追加監査：mutation RPCのロック順序棚卸し

提供済み`evidence/schema(2).sql`に含まれるmutation RPCを静的に棚卸しし、request gate参加候補を応募・採用・直接招待・拒否返金・個別／全体キャンセル・完了・異議申立て・レビュー報酬・退会まで拡張した。関数ごとの現行ロック順と必要な変更は`CONCURRENCY_LOCK_ORDER_DESIGN_2026-11-14.md`の第8節に記録。

追加で、`apply_to_performance_request_as_band`がuser行を先にロックしてから`spend_coins`を呼び、同RPC内でidempotency advisory keyを取得するため、user→idempotency keyの逆順が存在することを確認。また、直接依頼拒否・退会helperはuser→application→refund key、個別／全体キャンセルはuser→match/applicationの順序を含む。request gateを先頭に追加するだけでは解決しない。

operation idempotency wrapperはoperation advisory lock取得後に応募本体へ進むため、request gateを最初に統一する場合はrequest IDの事前解決と取得順の変更が必要。汎用`spend_coins`にrequest IDが指定される直接呼出し経路のgate責務も定義が必要。

この棚卸しは提供されたDBエクスポートに含まれる定義の範囲であり、DB内の全関数・全直接更新を網羅した証明ではない。DB実行、build／lint／test／ローカルチェック、Supabase適用、Git操作、Vercel操作は実施していない。

## 2026-11-14 追加監査：バンド・レッスン・コイン移動のロック循環

提供済み `schema(2).sql` の関数定義を追加照合し、request gate案だけでは解消できない横断ロック循環を確認した。

- `apply_to_performance_request_as_band`：request→band→application→userの順。後続`spend_coins`がidempotency advisory lockを取得するため、user先行ロックも修正対象。
- `respond_to_band_invitation`：user行を先にロックしてからband行をロックする。band応募・送金側のband→userと逆順。
- `transfer_band_coins`：送金idempotency key→band→member→複数user（UUID順）。退会側user→band更新と競合し得る。
- `apply_to_lesson_offer`／`update_lesson_offer_with_levels`：lesson offer→講師user。退会側はuserを先にロックしてからlesson_offersを更新するため循環し得る。
- `withdraw_user_account`：user先行ロックを保持したままrequest取消、lesson offer更新、band更新へ進む。複数ドメインを横断する専用のgate収集・固定順序が必要。

従来の単一request gate＋request→band→match→application→idempotency→user案は、全ドメインの確定設計として不十分と判定。request／band／lesson offer／payment order等の複数aggregate gateを、固定されたドメイン順位＋ID昇順で行ロック前に取得する案へ再設計する。ただし完全な関数・呼出経路・trigger・API直接更新の証拠が揃っていないため、ドメイン順位・行ロック順位は未確定であり、migration化しない。

SQL実行、DB適用、ローカルチェック、build／lint／test、GitHub Push、Vercel Deployは未実施。

### 2026-11-14 追加監査：API直接DB更新の横断照合

統合候補ソース `src/app/api/**` のSupabase `.insert/.update/.upsert/.delete` を静的抽出し、RPC外で状態変更する経路を分類した。

- 完了報告API（施設側・演奏者側）は`matches`を直接UPDATEする。完了RPC・キャンセルRPCと共通request/match gateを共有しないため、gate参加型の完了報告RPCへ統合する。
- 案件編集・削除APIは`performance_requests`を直接UPDATE/DELETEする。応募・採用・キャンセルと共通gateを通らず、DELETE前のmatch count確認とDELETEが別transactionで競合し得るため、検査と変更を同一RPC transactionへ移す。
- Stripe Webhookは`payment_orders`のPayment Intent紐付け・注文状態更新と`stripe_payment_incidents` upsertを直接実行する。claim tokenでfenceされるのはevent state updateのみであり、業務副作用のtoken検証・order lock・incident更新を同一DB RPCに統合する。
- Stripe Checkout開始API／`stripe-marketplace.ts`もpayment_ordersを直接INSERT/UPDATEする。外部Stripe APIをDB transactionに含めず、注文の状態遷移を条件付きRPC/CASで管理する。
- performer/facility profile APIはusersとprofilesを別要求で更新する経路があり、即時のデッドロックとは断定しないが、退会との競合時にプロフィール再更新・部分更新が残る。退会状態の再検証とプロフィール更新RPC化が必要。
- favorites、chat/messages、announcements、inquiries、admin settings等も抽出したが、request/match共通gate対象とはせず、それぞれ別ドメインの認可・整合性監査対象として分類した。

関数別・ファイル別の一覧と修正方針は`CONCURRENCY_LOCK_ORDER_DESIGN_2026-11-14.md`第11節に追記。これは作業用ソース内の静的抽出であり、DB内の全mutation関数、Edge Function、service_role直接SQL、外部運用スクリプトを網羅した証明ではない。SQL実行、ローカルチェック、Supabase適用、GitHub Push、Vercel Deployは実施していない。


## 2026-11-14 追加監査：Trigger・Edge Function・Cron・API更新の最終照合

### 1. DB Trigger（提供された `schema(2).sql` の範囲）

ダンプ内で確認できたtriggerは2件。

| Trigger | 発火対象 | 関数の副作用 | 並行制御上の評価 |
|---|---|---|---|
| `trg_prevent_disputed_match_cancellation` | `matches` の `status` / `performance_status` UPDATE前 | `completion_disputed_at` があるmatchのcancelを例外で拒否。追加テーブル更新・別行ロックなし | 新たなロック循環を作る副作用は確認できない。状態更新RPCと同じmatch行ロックの内側で実行されるガード。 |
| `users_initial_coin_balance` | `users` INSERT前 | `line_registration_history`へhash行をINSERT `ON CONFLICT DO NOTHING`。既存hashなら同履歴行をUPDATEして再登録回数を加算し、初期残高を0にする | 初回登録の重複防止としてunique競合を利用。matching aggregateのロック循環は確認できないが、同じLINE hashの同時再登録では履歴行の競合待ちが起き得る。 |

このDBダンプの範囲では、trigger内からmatch/request/band/lesson/paymentの別aggregateを更新する隠れた副作用は確認されなかった。これは取得済みダンプの範囲に限る。

### 2. Edge Function・外部ジョブ

- 作業用ソースZIPには `supabase/functions/`、Deno Edge Function、独立したworker実装は含まれていない。したがってEdge Functionが存在しないと断定はできず、今回の提出資料からは確認不能。
- 提供DBダンプには `pg_cron` のjob定義や外部HTTP scheduler設定は含まれていない。DB内スケジューラの有無・登録jobは未確認。
- リポジトリ内で確認できる定期実行設定は `vercel.json` の `/api/cron/auto-complete`、毎日 `0 0 * * *` の1件。

### 3. 自動完了Cronの判定

`src/app/api/cron/auto-complete/route.ts` はservice_roleで候補matchを読み取るが、match行を直接UPDATEせず、各対象について `complete_match_with_fee` RPCを呼ぶ。従って現状のCron自体は完了状態の直接更新によるRPC迂回ではない。

ただし候補抽出はロックなしの事前SELECTであり、同時にキャンセル・異議申立て・完了が走る可能性がある。最終判定はRPC内で再検証する契約が必要。RPCが状態不一致を返した場合はCron側でskipとして扱う。Cronが重複起動しても安全であるためには、RPCの行ロック・冪等性・共通gate参加が必須であり、前述の `complete_match_with_fee` のlock order問題が解消するまでは公開阻害。

### 4. API直接更新経路の補足

前回のAPI mutation一覧に加え、以下を明確化した。

- 施設側・演奏者側の完了報告APIは、予定日・状態を読み取った後、`matches` の完了報告日時をPostgREST UPDATEで直接書き込む。後続の完了RPCとは別transactionであり、報告登録と状態遷移／通知イベントを一体化するRPCが必要。
- Stripe Webhookのイベント状態更新はclaim token条件付きだが、`payment_orders`のPayment Intent紐付け・session紐付け・status更新、`stripe_payment_incidents` upsertは別のPostgREST要求。業務副作用全体をtoken-fencedなDB RPCへ移す必要がある。
- Stripe coin purchase APIおよび `src/lib/stripe-marketplace.ts` には `payment_orders` の直接INSERT/UPDATEがある。Stripe外部API呼出しをDB transactionに含めず、注文状態の作成・確定・失敗化を状態条件付きRPC/CASで制御する。
- `src/app/api/cron/auto-complete/route.ts` は上記の通り読み取り＋RPCのみであり、直接更新一覧には含めない。

### 5. 今回の最終スコープ判定

| 対象 | 判定 |
|---|---|
| 提供DBダンプ内trigger 2件 | 調査済み。追加aggregate更新なし |
| Vercel Cron | 1件確認。RPC経由であり直接更新迂回なし。ただしRPC lock order問題が残る |
| Supabase Edge Functions | 提出ZIP内に実装なし。存在有無は未確認 |
| pg_cron／外部scheduler | 証拠資料なし。存在有無は未確認 |
| 完了報告API | gate参加RPCへの統合が必要 |
| Stripe Webhook／注文状態更新 | token fencingを業務副作用全体へ拡張するDB RPCが必要 |
| Stripe Checkout開始・Marketplace共通helper | 注文状態のRPC/CAS化が必要。外部APIはtransaction外 |

**結論：** 今回の資料で確認できたtriggerは2件、Vercel Cronは1件で、いずれも独立した隠れたmatch/request更新処理ではなかった。一方、Edge Functions・pg_cron・外部schedulerは証拠がないため未確認。従って「全実行経路を網羅した」とは判定しない。実装前にSupabase Dashboard／CLI等からfunctions一覧・cron.job・trigger catalog・function定義・service_role権限を読み取り専用で追加取得する必要がある。

SQL実行、DB接続、ローカルチェック、build／lint／typecheck／test、Supabase適用、Git操作、Vercel操作は行っていない。

### 2026-11-14 追加：不足証拠を取得する読み取り専用パッケージ

今回、Supabase SQL Editorで個別実行できるSELECT専用証拠収集SQL `docs/audit_evidence/20261114_readonly_execution_path_evidence.sql` と、Edge Functions／Vercel Cron／外部schedulerの取得手順 `docs/audit_evidence/20261114_external_execution_path_evidence.md` を追加した。

取得対象は、実行環境識別、拡張、全user triggerとtrigger function定義、event trigger、public routine定義とsecurity/ACL、pg_cron jobおよび直近実行履歴、role、RLS対象、RLS policy。SQLはSELECTのみであり、関数呼出し・DDL・DMLを含めない。Q5/Q6はpg_cron未導入または権限不足時にエラーとなり得るため、エラー結果も証拠として保存する。

Edge FunctionsとVercel Cronの完全な実体はSQL catalogだけでは得られないため、Supabase Dashboard/CLIおよびVercel Project Settingsから別途一覧・ソースを取得する。秘密情報は伏せる。まずテスト環境（東京）でQ0の環境識別を確認してから取得する。production（Mumbai）の変更・接続・取得はこの作業に含めない。

**判定は未完了のまま維持する。** 本パッケージ作成時点ではSQLを実行しておらず、追加証拠はまだ取得していない。全実行経路を網羅したとは扱わない。


## 2026-11-14 追加追補反映（候補SQLの安全側修正）

ユーザー要望により、既存監査をやり直さず、確実に反映できる範囲の候補修正を作業用コピーへ反映した。

1. `20261114_005_stripe_webhook_atomic_claim.sql`
   - `processing_status`を含むCHECK制約を`ILIKE`で一括DROPする処理を撤去。
   - 既存CHECKが同列を参照する場合はpreflightで停止する。複合CHECKの別条件を誤って削除しない。
   - 既存status値がNULLまたは許容集合外の場合もpreflightで停止する。
   - 既存CHECKがあるDBに対するlossless置換は、完全定義を取得後に別途設計する。
2. `20261114_006_withdrawal_dual_role_direct_invite_refunds.sql` と `20261114_007_event_cancel_notification_targets.sql`
   - SECURITY DEFINER関数のsearch_pathを`pg_catalog, public, pg_temp`へ変更。

この反映は候補ファイルのみ。SQL実行・PostgreSQL構文実行検証・DB適用は行っていない。006／007のデッドロック、通知outbox、005の業務副作用fencing等は未解決のため、いずれも適用可能になったわけではない。ローカルチェック・build／lint／test／typecheck、Git操作、Push、Deployも未実施。
