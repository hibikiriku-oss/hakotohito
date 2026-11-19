# V45.3候補 変更台帳・Supabase適用状態（2026-11-19）

## 基準
- V44候補ZIPを基準とする。作業対象ソースはZIP内の`music-matching/`。
- V45は候補パッケージ。今回作成したmigration・ソース変更は未適用・未デプロイ。
- 既存の本番DB変更は、候補ZIPに含まれるmigration番号だけで適用済みと判断しない。

## V45の変更内容

### レッスンのコイン処理
- 募集作成時：`configured_lesson_fee(lesson_fee) * capacity`を現在残高と比較するだけ。コインを差し引かず、`reserved_coins=0`で保存。
- 募集編集時：成立済み人数を除く残定員分の必要額を現在残高と比較するだけ。仮押さえしない。
- 応募処理：V44の`apply_to_lesson_offer`は応募を`matched`として即時成立させる関数であるため、成立時点で最新の`configured_lesson_fee`を読み、講師残高の再確認・コイン徴収・`coin_transactions`記録・マッチング登録を同一トランザクションで実行する。
- 既存`lesson_offers.reserved_coins`は仮想予約額であり、実残高からの控除ではないため、migrationで全行0へ正規化する。
- バンド送金RPCと`spend_coins_legacy`からレッスン予約額控除を除去。送金・通常消費の可否は現在残高のみで判定。
- withdrawal時の募集終了処理が`reserved_coins=0`をセットする既存処理は互換上維持。

### 新規登録の管理者承認
- 新規登録時は`account_status='pending_approval'`。
- 本番で確認した`users_account_status_check`を`active`・`withdrawn`・`pending_approval`の3値へ拡張する。既存API/RPCの`account_status='active'`判定をそのまま待機中ユーザーの利用拒否に使うため、別の承認状態列は追加しない。想定外の追加CHECK制約があればmigrationを停止する。
- `/lobby`で承認待ち案内と状態再確認を提供。プロフィール初期登録ページ(`/performer`・`/facility`)と各ホームもpending状態を検出してロビーへ戻す。
- `/api/users`は本人の`active`または`pending_approval`を返す。通常APIは既存の`active`条件・DB mutation guardにより待機中アカウントを拒否。退会済みユーザーの再登録経路は維持。
- 管理者専用`/admin/approvals`と`/api/admin/users/approvals`を追加。
- 承認時に`account_status='active'`、`approved_at`、`approved_by_user_id`を同一UPDATEで記録。
- 既存activeユーザーは自動的に承認待ちへ戻さない。
- 初期コイン付与triggerは変更しない。pending中はactive制限で利用できず、承認後に通常利用可能となる。

## V45.2追加：本番ベースラインの厳密照合
- ユーザー提供の本番関数定義から取得した5関数のMD5をmigration preflightに固定し、想定外の関数定義ならトランザクション開始後の変更前に停止する。
- `users_account_status_check`も、確認済みの`active`/`withdrawn`のみの定義と完全一致する場合に限り拡張する。
- 期待MD5：`apply_to_lesson_offer`=`5be2c47bc9922aca406b3ee1570bf69b`、`create_lesson_offer`=`295a8ab05d0688897a2a182bbad9d36f`、`update_lesson_offer_with_levels`=`dddb28d69f43d213050324ee24f4ba58`、`transfer_band_coins`=`b35615756e1253860b3ad142c3090cfa`、`spend_coins_legacy`=`8c946d0ad72d11b5a19303b565cfd4b2`。

## 追加静的確認・修正
- `spend_coins`の互換先である`spend_coins_legacy`にも`reserved_coins`控除が残っていたため、V45 migration内で現在残高のみを判定する定義へ置換。
- migration preflightに`spend_coins_legacy`署名と`users.account_status`のtext系型確認を追加。
- `/api/users`の登録時に既存の`active`／`pending_approval`は再利用し、退会済み行は再利用せず既存の再登録処理へ進むことを明記。

## DB適用状態の記録

| 対象 | 状態 | 根拠／備考 |
|---|---|---|
| `20261116_009_global_mutation_gate` | ユーザー報告で適用済み | ただしV44内の同番号SQL全内容が本番と一致するかは未照合 |
| `performance_requests.venue_address` | ユーザー報告で適用済み | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 成功報告 |
| コイン購入停止設定 | ユーザー報告で適用済み | `coin_purchase_enabled=false` 成功報告 |
| `delete_open_performance_request_atomic` | ユーザー報告で適用済み | RPC作成成功報告。ライブhash `1c8fc8d752b9550e268211c8080ca9a3` の確認履歴あり |
| application notification outbox Flexリンク | ユーザー報告で適用済み | LINE実機でリンク付き通知の到達確認済み |
| `create_facility_invitation_with_coins` | ライブ定義確認済み | send時非課金・application_attempt作成。md5 `429338fdde9c637cfa3488784a4751a9` |
| `accept_direct_invitation_atomic` | ライブ定義確認済み | 成立時課金。md5 `2021f8afba186dd038507924b7f223aa` |
| `create_lesson_offer` | ライブ定義確認済み・旧仮押さえ動作 | md5 `295a8ab05d0688897a2a182bbad9d36f`。V45で置換対象 |
| `create_lesson_offer_with_levels_and_address` | ライブ定義確認済み | md5 `e1a7ebadab947e4c954d96ceff7cd115`。wrapperは維持 |
| `20261116_010`〜`023`、`20261118_001`〜`017` | 個別適用状態未確定 | migration番号のみで適用済みとみなさない。適用済み／未適用のライブ照合が必要 |
| `20261119_001_lesson_no_holds_and_registration_approval.sql` | 未適用 | V45候補として新規作成 |

## 反映前に必要な作業
1. 本番DBのmigration履歴と対象関数定義を照合し、既存適用分を正確に確定する。
2. V45 migrationのpreflight対象と本番の実関数署名・ACL・trigger状態を確認する。
3. 本migrationをSupabaseへ適用。
4. VercelへV45ソースをデプロイ。
5. LINE実機で、pendingロビー→管理者承認→利用開始、レッスン募集登録（残高不変）→成立時徴収、残高不足時不成立、バンド送金を確認。

## 未実施
- Supabase SQL適用、Git commit／push、Vercel deploy、build／lint／test／typecheckは本台帳作成時点で未実施。


## 2026-11-19 本番事前確認結果
- `users`：`active` 2名、その他の状態0名。
- `users_account_status_check`：`active` / `withdrawn` のみを許可する既知の制約を確認。V45 migrationでこの制約を3値へ拡張する必要あり。
- `lesson_offers`：公開中0件、`reserved_coins`非ゼロ0件、仮押さえ合計0。
- `trg_global_mutation_gate` と `users_initial_coin_balance`：両方とも有効。
- 対象関数は存在し`SECURITY DEFINER` / `service_role EXECUTE`を確認。`create_lesson_offer`の本番hashは`295a8ab05d0688897a2a182bbad9d36f`。その他4関数のhashも取得済みだが、V44候補の最終定義との内容照合は未完了のため、適用前に定義全文を照合する。
- 上記確認は読み取り専用。Supabase変更・デプロイは未実施。
