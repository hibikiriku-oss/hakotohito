# 2026-11-19 施設側実機テスト追跡監査（v44候補）

## 基準・作業境界

- 基準ソース：`Hakotohito_20261118_limited_release_phase2_batch_remediation_candidate_v43.zip`。
- 追加反映：Vercel TypeScriptエラー対応7ファイル（`422ca04`で修正した5ファイル、`2ba38e5`で修正した2ファイル）。候補ZIPのrootと`music-matching/`ミラーの両方へ反映。
- この文書は候補ソースの静的照合と、ユーザーが2026-11-19に報告した施設側LINE実機結果を分けて記録する。実DBの状態・ログは未取得。
- SQL実行、DB変更、アプリ実行、build/lint/test/typecheck/ローカルチェック、Git操作、Push、Deployは行わない。

## 施設側LINE実機結果と静的照合

| No. | ユーザー報告 | 静的照合・現時点の評価 | 候補対応 |
|---:|---|---|---|
| 1 | コイン購入は「現在利用できません」 | 限定公開ではStripeコイン購入停止が既定方針。migration `20261118_001` とUIのdisabled表示に一致。機能不具合ではない。 | 購入停止表示は維持。ホームへ戻る導線が購入ページにないためUI修正候補。 |
| 2 | 依頼削除は応募履歴等の注意表示後、削除中表示になり、一覧に変化なし | UIはDELETE後、APIが409等を返すとエラーを`deleteError`へ表示し、`finally`で削除中状態を解除する設計。APIは `delete_open_performance_request_atomic(uuid,uuid,text)` を呼び、応募・match・attemptが1件でもあればfail-closedで削除拒否。応募履歴がある案件を削除できないこと自体は正しい。エラー表示の視認性と実DB RPC適用状況は未確認。 | 削除拒否の理由をボタン付近で明確に表示し、削除中表示が残らないことを実機再確認。RPCの存在・定義をread-onlyで確認。 |
| 3 | 施設プロフィール編集・保存成功 | ユーザー実機で成功。今回の施設テストでの正常確認。 | 変更なし。 |
| 4 | マッチング一覧「情報の取得に失敗」 | `GET /api/facility/matches` は `performance_requests.venue_address` をSELECTする。候補migration `20261118_002` がこの列を追加する。対象DBに列がなければPostgREST query全体が失敗し得る。ほかの列/FK/relationship不整合もあり得る。ログ未取得のため原因確定ではない。 | まず列・constraint・relationshipをread-onlyで照合し、Vercel APIログのDB error codeを確認。 |
| 5 | 演奏者検索・詳細・直接依頼画面への遷移は成功 | ユーザー実機で成功。 | 変更なし。 |
| 6 | 同じ演奏者への2回目の直接依頼は重複拒否 | UI/APIで重複拒否を実機確認。候補SQLもpending/acceptedの既存applicationを拒否する設計。 | 変更なし。期限切れ・rejected後の再依頼は別テスト。 |
| 7 | 直接依頼通知が演奏者へ届かない | 候補SQL `20261116_015_application_notification_outbox.sql` は `application_attempts` INSERT triggerで直接依頼の受信者Outbox行を作成。migration 014/004のOutbox本体・claim/ack RPC、Vercel worker、LINE送信条件のどこかが未反映/失敗している可能性。ユーザー報告だけでは原因未確定。 | trigger存在・enabled、Outbox行のstatus、claim RPC/worker結果を個人情報なしで確認。 |
| 8 | 「オファーを登録する」で演奏依頼登録に失敗 | 施設側作成API `POST /api/performance-requests` は `venue_address` を含めて `performance_requests` に直接INSERTする。migration 002未適用で列がない場合、今回の登録失敗とNo.4のマッチング一覧失敗を同時に説明できる。その他の必須列・制約・認証エラーも候補。 | migration 002の列有無を最優先でread-only確認。VercelログのDB error codeも取得。 |
| 9 | お気に入り一覧には演奏者が表示されるが依頼ボタンがない | `src/app/facility/favorites/page.tsx` のプロフィールモーダルには「お気に入り解除」「閉じる」のみ。演奏者検索画面には `/facility/performers/{id}/invite` への依頼導線があるため、お気に入り画面だけ導線が欠落していることを静的確認。 | お気に入りプロフィールモーダルへ「この演奏者に依頼する」を追加し、既存invite画面へ遷移させる。 |
| 10 | お問い合わせ履歴に取り下げボタンがない | `src/app/inquiry/page.tsx` の履歴カードに取り下げ操作なし。`/api/inquiries` はGET/POSTのみでDELETEなし。現状は問い合わせ取消機能自体が未実装。 | 受付前/対応前のみ取り下げ可能にするか、対応中・返信済みも含むか仕様を定義。監査証跡を残す状態変更方式を優先し、物理削除は避ける候補。 |
| 11 | 直接依頼時にコイン履歴へ-100が記録 | 現行仕様「送信時は徴収せず残高確認のみ、マッチング成立時に同一transactionで徴収、残高不足なら成立させない」と不一致。候補migration 009内には旧即時徴収版が残るが、後続migration 011/`20261118_012`が作成時徴収を外し、migration 012が承諾・成立時徴収へ置き換える。後続SQLが対象DBに未適用、または古い関数定義が有効な可能性が高いが、live function定義を未確認のため断定しない。 | `create_facility_invitation_with_coins`の実体がattempt作成・残高確認のみか、`spend_coins`を直接呼ぶ旧定義かをread-onlyで判定。`coin_transactions.match_id`とidempotency key prefixも集計確認。 |

## DB反映順の依存関係（要照合）

今回のNo.4/8/11/7/2は、別々のUI不具合に見えてもSQL候補の未反映が共通原因となる可能性がある。

1. `20261118_002_performance_request_venue_address.sql`：`performance_requests.venue_address`列。未反映なら案件作成INSERTと施設マッチング一覧SELECTの双方に影響し得る。
2. `20261118_008_atomic_performance_request_delete.sql`：案件削除APIが呼ぶatomic delete RPC。先行するmatching core 009/010が必要。
3. `20261116_011_matching_fee_deferred_to_match.sql` と `20261116_012_match_establishment_fee_charging.sql`、後続 `20261118_012_active_account_rpc_guards.sql`：直接依頼作成時の非徴収と、承諾・マッチング成立時の徴収。
4. `20261116_014_transactional_line_notification_outbox.sql`、`20261116_015_application_notification_outbox.sql`、Outbox hardening 004：直接依頼通知のtransactional enqueueとworker配信。

migration history tableはアプリ独自には存在しない。適用済み/未適用をファイル名やSupabase内部migration tableから推測しない。対象Tokyo DBのread-only catalog/function/trigger確認を行い、SQL Editorでの手動適用記録と照合する。

## 課金・返金方針の更新候補

ユーザーの2026-11-19発言を最新方針として記録：

- 直接依頼送信時はコインを徴収しない。必要残高の確認のみ。
- マッチング成立時に徴収する。
- 成立時に残高不足ならマッチングを成立させない。
- 「コインの返金ロジックを無くしてできるだけシンプルな設計にする」との意向あり。

返金ロジック撤廃の範囲は未確定。現行候補には直接依頼拒否/キャンセル/退会の返金処理（migration 013、016、019等）と、イベント・レンタル初回料金の返金処理がある。確認前にイベント/レンタル返金を含む全領域を一括削除しない。まず直接依頼のどの状態（未承諾、承諾後マッチング、成立後キャンセル、退会）で返金をなくすかを整理する。

## 7ファイルTypeScript修正の候補反映

以下7ファイルのVercel TypeScriptエラー修正をv43候補へ反映した。rootとnested mirror双方へ同一内容を配置。

- `src/app/api/map-search/route.ts`
- `src/app/facility/matches/[id]/page.tsx`
- `src/app/facility/requests/[id]/page.tsx`
- `src/app/performer/matches/[id]/page.tsx`
- `src/lib/stripe-marketplace.ts`
- `src/app/api/bands/invitations/route.ts`
- `src/app/api/lesson-offers/[id]/route.ts`

Git履歴としては、前5ファイルは`422ca04`、後2ファイルは`2ba38e5`。後者はユーザーがPush成功を報告。VercelのReady表示はユーザー報告として扱い、この監査でbuildログを再取得したものではない。

## 次の監査・修正候補

- [ ] read-only診断SQLでvenue_address、delete RPC、直接依頼RPC定義、Outbox trigger/件数、直近direct_invite_fee ledgerを照合。
- [ ] Vercel APIログのerror codeでNo.4/8/2の原因を確定。
- [ ] お気に入りから直接依頼への導線を追加。
- [ ] コイン購入画面へホーム戻り導線を追加。
- [ ] 問い合わせ取り下げの状態遷移・管理者側表示・監査記録を設計。
- [ ] 直接依頼返金撤廃の適用範囲を確定し、API/DB/Outbox/管理者画面/履歴文言を横断更新。
- [ ] 施設側・演奏者側の追加実機結果を統合してから修正パッケージを確定。

**判定：** v44は実機テスト所見と静的コード照合を追加した未適用候補。DB適用状態・Vercel runtime logs未確認。build/test/lint/typecheck/ローカルチェック、SQL実行、Supabase/GitHub/Vercel変更なし。公開判定BLOCKED。
