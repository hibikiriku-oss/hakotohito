# 修正版パッケージ状況（2026-11-16）

## 作業用コピーに反映した変更

- `LESSON_FEATURE_ENABLED=true` を維持し、レッスン募集・編集・応募APIを有効化。
- `supabase/migrations/20261116_009_global_mutation_gate.sql`：更新系31関数の先行共通ロックと、publicテーブル全体の書き込みstatement gate候補。定義ハッシュの事前照合に加え、gate導入前にpublicテーブルを安定順で`SHARE ROW EXCLUSIVE`ロックするcutover barrierを追加し、既存書き込みとgate設置の間の競合窓を閉じる。
- migrations 010〜013のトランザクション開始直後に同じtransaction advisory lockを取得し、backfill・関数置換・キャンセル関数置換をアプリ更新処理と直列化。特に010の応募試行backfillがgate稼働中の応募・課金更新と並行しないようにした。rollback候補はmigration二重versionを避けるため`supabase/rollback/`へ分離。
- `supabase/migrations/20261116_010_application_attempts_and_expiry.sql`：応募試行テーブル、既存応募のbackfill、7日期限処理RPC。
- `supabase/migrations/20261116_011_matching_fee_deferred_to_match.sql`：個人応募・バンド応募・直接依頼の作成時課金を廃止し、残高確認と試行記録に変更。
- `supabase/migrations/20261116_012_match_establishment_fee_charging.sql`：応募料・直接依頼料・通常成立料・イベント／レンタル初回成立料をマッチング成立時に徴収するRPC候補。
- `supabase/migrations/20261116_013_cancel_reapply_and_direct_fee_refund.sql`：個別キャンセル後の応募`rejected`遷移、再応募時の試行分離、新方式の直接依頼返金キー、退会時の旧方式未成立直接依頼返金を反映。
- 応募画面の課金タイミング説明、直接依頼画面の課金タイミング説明、バンド応募通知条件、コイン不足時の相手側LINE通知先・開始者向け表示、未徴収依頼の辞退メッセージ、応募期限Cronを作業用srcへ反映。
- `PUBLIC_RELEASE_CHECKLIST.md` に候補修正と未適用状態を反映。

## LINE通知Outbox候補の現状（014〜023）

- 014：マッチング成立通知。
- 015：個人応募・バンド応募・施設直接依頼の通知。
- 016：レッスン応募・レッスン募集更新通知。
- 017：個別マッチングキャンセル通知。
- 018：マッチング完了確定通知。
- 019：演奏者による直接依頼辞退通知（退会処理と区別したactor検証wrapper）。
- 020：イベント全体キャンセル通知。
- 021：退会時のマッチング中止・未成立直接依頼取消・返金通知。
- 022：バンド招待作成・回答通知。
- 023：片側の演奏完了報告通知。
- 現行APIの有効経路から直接LINE Pushを撤去し、Outbox worker経由に統一。`route.ts.backup`は実行経路ではないため対象外。
- すべて候補SQL。未適用・未実機検証。テキスト通知への変更を含むため、LINE実機で通知先・文面・重複・再送を確認する必要がある。

## 課金・期限仕様

- 応募・直接依頼の作成時は必要残高を確認するだけで、徴収しない。
- マッチング成立時に、応募料（個人／バンドリーダー）、直接依頼料（施設）、成立料（施設）を同一トランザクションで徴収する。
- 残高不足時はマッチングと徴収をrollbackし、応募／依頼をpendingのまま維持する。
- 応募試行・直接依頼は作成から7日で期限切れ。承認RPCでも期限を確認し、期限後の成立を拒否する。
- イベント／レンタル初回成立料はrequest ID単位の既存冪等キーを維持し、キャンセル・返金後の再成立でも再徴収しない。
- 既存coin_transactionsは削除しない。旧方式で既に徴収された直接依頼料金のキャンセル・退会返金経路を維持する。
- Stripeコイン購入は`coin_purchase_enabled=false`のまま。レッスン機能は有効のまま。

## 追加反映・残存制約

- コイン不足時、開始者への表示は「コイン不足のためマッチングできません」とし、支払者側の不足を相手側へLINE通知するようAPIを修正。
- 直接依頼画面に成立時徴収を明記。未成立依頼の辞退時、実際の旧方式返金履歴がある場合だけ返金済みと表示。
- 個別キャンセル・イベント全体キャンセル時に対応する成立済みapplication_attemptを`cancelled`へ遷移させる候補を反映。
- 共通gateはDB statement単位の直列化であり、APIが複数の独立したSupabase要求で構成する業務処理全体を一つのtransactionにはしない。今回の通知Outbox候補（014〜023）で主要な通知経路をDB transactionに結び付けたが、LINE Push成功後のDB完了記録失敗による重複可能性、日次cronまでの送信遅延、通知文面・送信先のLINE実機確認は残存課題。案件編集／削除・プロフィール等の複数要求フローRPC化も別途検討対象。

## 適用・検証状態

- 上記SQLはすべて候補で、Tokyo Supabaseへ未適用。
- ユーザー指示により、テスト用データ削除・クリア以前の監査結果は、未公開の開発途中データ・LINEテスト由来の残骸として以後の判断根拠から除外。
- 削除・クリア後の現行DBに対する `direct_invite_fee` / `application_fee` の負数取引かつ `application_id IS NULL` の照会結果は `Success. No rows returned`。過去監査のNULL履歴を理由とする二重徴収懸念は、現行データに対する阻止理由から除外。010のpreflightは適用時にも再確認する。
- 作業用コピーのみ変更。ユーザーの実リポジトリ、GitHub、Vercelは変更していない。
- build / lint / typecheck / test等のローカルチェックは実施しない（ユーザー指示）。
- LINE実機動作確認は未実施。
- 公開判定はBLOCKED。SQL候補の静的整合・適用前提・rollback順序の最終確認が必要。

## 次の手順

1. 削除・クリア後の現行データに対する010のpreflight結果を適用直前に確認する（今回の照会結果は0件）。
2. SQL候補009〜013の依存順と現行DB定義の整合、関数定義・ACL・trigger・制約との一致を最終確認する。
3. SQL適用前にバックアップとrollback順序を確認する。
4. SQL適用・GitHub push・Vercel deployは、それぞれ別途承認を得てから実施する。
5. LINE実機で応募・バンド応募・直接依頼・コイン不足・期限切れ・キャンセル再応募・退会返金を確認する。


## 2026-11-16 追加候補：マッチング成立通知Outbox

- `20261116_014_transactional_line_notification_outbox.sql` を追加。`matches` INSERTトランザクション内のAFTER INSERTトリガーで施設・参加演奏者向け通知をOutboxへ登録する。
- `/api/cron/line-notification-outbox` と共通送信処理を追加。採用・直接依頼承諾APIから成立直後にOutboxをdrainし、cronは日次の復旧処理としてclaim・LINE送信・成功記録・指数バックオフ再送を行う（Vercel Hobbyのcron頻度制約を考慮）。
- 採用APIと直接依頼承諾APIの成功後直接送信を除去し、DBトリガーによるOutbox登録へ一本化。コイン不足時の通知は既存API経路のまま（別途Outbox化が必要）。
- LINE push成功後にDB完了記録が失敗した場合、再送で重複する可能性がある。LINE Push API自体にexactly-once保証がないため、これは残存リスクとして扱う。APIプロセスがDBコミット直後・Outbox送信前に停止した場合は日次cronまで遅延する可能性がある。
- この014追加時点ではDB未適用・未検証で、キャンセル・退会・辞退・その他通知経路は未移行だった。その後、下記のmigration 015〜023で候補を追加した。

## 2026-11-16 作業用コピーの追加修正（当時点の記録・後続拡張済み）

- `src/lib/line-notification-outbox.ts`：LINE送信関数が例外をthrowした場合も失敗結果として扱い、`retry_line_notification_outbox`へ進むよう変更。再試行RPC自体の失敗は`failedToRecord`として記録する。
- `src/app/api/performer/invitations/[id]/accept/route.ts`：コイン不足通知キーを`direct_invite_insufficient:<application_id>`に固定し、ランダムUUIDを廃止。
- `src/app/api/facility/requests/[id]/applications/[applicationId]/accept/route.ts`：コイン不足通知キーを`matching_insufficient:<application_id>:<payer_side>`に固定し、ランダムUUIDを廃止。
- 上記は作業用コピーへの変更のみ。DB未適用。アプリのbuild/lint/typecheck/test等は実施していない。
- この記録を作成した時点では、個別キャンセル・イベント全体キャンセル・直接依頼辞退・退会・完了・応募・バンド招待・レッスン通知のtransactional Outbox移行は未完了だった。その後、下記の追加候補（migration 015〜023）で順次反映済み。


## 2026-11-16 追加候補：個人応募・施設直接依頼通知Outbox

- `supabase/migrations/20261116_015_application_notification_outbox.sql` を新規作成。`application_attempts` INSERTトリガーで、個人応募は施設へ、施設直接依頼は演奏者へ、試行IDを冪等キーとしてOutbox登録する。応募／依頼と試行行の作成トランザクションがrollbackすれば通知登録もrollbackされる。band_applyも対象に含め、バンド名を通知に使う。
- `src/app/api/applications/route.ts` と `src/app/api/facility/invitations/route.ts` から直接LINE Push処理を撤去し、DB登録後に共通Outbox workerの即時drainを試みる形へ変更。送信失敗はOutboxに残り再試行対象となる。
- 通知文面は既存Flexカードから短いテキスト通知へ統一。通知内容・リンク体験は今後のLINE実機確認対象。
- migration015は014のOutboxテーブルと010のapplication_attemptsに依存。SQL未適用。build／lint／typecheck／test等のローカルチェック未実施。
- この015追加時点では、その他のキャンセル・退会・辞退・完了・バンド招待・レッスン通知の直接送信経路が未移行だった。その後、下記のmigration 016〜023で順次移行した。

## 2026-11-16 追加候補：レッスン通知Outbox

- `supabase/migrations/20261116_016_lesson_notification_outbox.sql` を新規作成。`lesson_applications` INSERT時に募集者へ、`lesson_offers`の募集内容更新時にmatched参加者へ、同じDB transaction内でOutbox登録する。
- `src/app/api/lesson-offers/[id]/applications/route.ts` と `src/app/api/lesson-offers/[id]/route.ts` の直接LINE Pushを撤去し、共通Outbox workerの即時drainへ変更。
- レッスン機能自体は有効のまま。通知は既存Flexカードからテキスト形式へ変更し、LINE実機で内容確認が必要。
- migration016は014のOutboxテーブルと既存lesson tablesに依存。SQL未適用。ローカルチェック未実施。


## 2026-11-16 追加候補：バンド応募通知Outbox

- migration015の`application_attempts`トリガー対象に`band_apply`を追加し、応募先施設へ通知する。バンド名を通知表示名として取得する。
- `src/app/api/bands/[bandId]/applications/route.ts` の直接LINE Pushと通知先情報取得処理を撤去し、共通Outbox workerへ変更。
- SQL未適用。ローカルチェック未実施。バンド招待の作成・回答通知は別経路として残存。


## 2026-11-16 追加候補：マッチングキャンセル通知Outbox

- `supabase/migrations/20261116_017_match_cancellation_notification_outbox.sql` を追加。既存のキャンセル・返金RPC本体は変更せず、actor user ID／roleを検証するwrapper RPCを新設。既存RPCの成功後、同じtransaction内で相手側のLINE通知をOutbox登録する。
- 施設・演奏者のマッチングキャンセルAPIをwrapper RPCへ切り替え、API側の直接LINE Push処理を撤去。共通Outbox workerで即時送信を試みる。
- バンドマッチングのキャンセル権限（現役リーダー）を考慮し、バンド参加演奏者を通知対象に含める。施設キャンセルは演奏者側、演奏者キャンセルは施設側へ通知。
- 既存Flexカード通知はテキスト通知に変更。通知文面・通知先・バンドケースはLINE実機確認が必要。
- migration017は候補SQLであり未適用。ローカルチェック未実施。

## 2026-11-16 追加候補：マッチング完了通知Outbox

- `supabase/migrations/20261116_018_match_completion_notification_outbox.sql` を追加。`matches.completed_at`のNULL→確定日時への遷移をトリガーで捕捉し、完了手数料処理を含む完了RPCと同一transaction内で施設・参加演奏者双方への通知をOutbox登録する。
- 施設／演奏者の完了APIでは、最終完了時の直接LINE Pushを廃止して共通Outbox workerをdrainする。片側の完了報告時点で送る確認依頼通知は、報告更新とOutbox登録をまだ一体化できていないため直接送信経路を残す。
- 最終完了通知は双方へ送るテキスト形式。従来Flex通知とは異なり、LINE実機確認が必要。
- migration018は候補SQLで未適用。ローカルチェック未実施。


## 2026-11-16 追加候補：直接依頼辞退通知Outbox

- `supabase/migrations/20261116_019_direct_invitation_rejection_notification_outbox.sql` を追加。演奏者本人のuser IDを検証する辞退wrapper RPCを追加し、既存の辞退・返金RPC成功と同じtransaction内で施設向け通知をOutbox登録する。旧方式の直接依頼手数料返金履歴がある場合と、新方式で成立前徴収がない場合の案内を分ける。退会内部処理から誤って退会者本人へ通知しないよう、汎用applications triggerは使用しない。
- `src/app/api/performer/invitations/[id]/reject/route.ts` の直接LINE Pushを撤去し、辞退・返金RPC後に共通Outbox workerをdrainする形へ変更。
- 通知形式はテキスト。SQL未適用。ローカルチェック未実施。

## 2026-11-16 追加候補：イベント全体キャンセル通知Outbox

- `supabase/migrations/20261116_020_event_cancellation_notification_outbox.sql` を追加。施設所有者を検証するwrapper RPCから既存のイベント全体キャンセル・返金RPCを呼び、キャンセルされたマッチング参加者（個人／バンド）と未承認直接依頼の演奏者向け通知を同じtransaction内でOutbox登録する。
- `src/app/api/facility/requests/[id]/cancel/route.ts` の直接Push・通知先再取得を撤去し、共通Outbox workerへ移行。
- 通知はテキスト形式。migration020は候補SQLで未適用。ローカルチェック未実施。

## 2026-11-16 追加候補：退会通知Outbox

- `supabase/migrations/20261116_021_withdrawal_notification_outbox.sql` を追加。既存`withdraw_user_account(text)`を呼ぶwrapper RPC内で、退会処理が返すマッチング中止・未成立直接依頼取消・直接依頼返金通知をOutbox登録する。退会と返金・通知登録が一つのDB transactionになる。
- `src/app/api/account/withdraw/route.ts` をwrapper RPC＋共通Outbox workerへ置換し、API側直接LINE Pushを撤去。
- 通知形式はテキスト。migration021は候補SQLで未適用。ローカルチェック未実施。


## 2026-11-16 追加候補：バンド招待通知Outbox

- `supabase/migrations/20261116_022_band_invitation_notification_outbox.sql` を追加。`band_invitations` INSERT時に招待先へ、`pending`から`accepted`／`rejected`への更新時に招待元へ、同じDB transaction内で通知をOutbox登録する。
- `src/app/api/bands/invitations/route.ts` の招待作成・回答の直接LINE Pushを撤去し、共通Outbox workerへ移行。
- 通知形式はテキスト。SQL未適用。ローカルチェック未実施。

## 2026-11-16 追加候補：片側完了報告通知Outbox

- `supabase/migrations/20261116_023_completion_report_notification_outbox.sql` を追加。施設／演奏者の完了報告日時のNULL→設定をトリガーで捕捉し、相手側が未報告の場合のみ同じtransaction内で確認依頼通知をOutbox登録。双方報告後の最終完了通知は018で扱う。
- 施設／演奏者の完了APIに残っていたpending通知の直接LINE Pushも撤去し、Outbox workerへ移行。
- 完了関連APIの直接Push経路は撤去済み。通知形式はテキスト。migration023は候補SQLで未適用。ローカルチェック未実施。

## 2026-11-16 通知経路の現時点まとめ

- `src/app/api`の実行対象コードに残る直接LINE Push呼び出しはなし。`src/app/api/account/withdraw/route.ts.backup`はバックアップファイルで、Next.jsのAPI routeとして実行されない。実送信は`src/lib/line-notification-outbox.ts`へ集約。
- migration014〜023は連番候補SQLとして作業用コピーに存在するが、Supabaseへ未適用。migration009〜013を含め、依存順・現行DB定義・権限・triggerの適用前確認が必要。
- すべてのOutbox通知はテキスト形式へ統一。既存Flex通知のボタン・リンク体験は維持していないため、LINE実機確認と文面調整が必要。
- LINE Push成功後のOutbox完了記録失敗による重複可能性、Vercel Hobby cronが日次であることによる再送遅延は残る。exactly-once配信を保証するものではない。
- SQL未適用、build／lint／typecheck／test等のローカルチェック未実施。実機確認未実施。実リポジトリ・Supabase・GitHub・Vercelは未変更。


## 2026-11-16 追加確認：バンドマッチングキャンセル権限

- migration017のactor検証で、バンドの全参加者IDを許可していた条件を修正。個人マッチングは本人のperformer_id、バンドマッチングは当該バンドのactive leaderのみを許可する。API側の既存リーダー確認とDB wrapperの認可条件を一致させた。
- SQL候補の修正のみ。DB未適用。build／lint／typecheck／test等のローカルチェック未実施。
