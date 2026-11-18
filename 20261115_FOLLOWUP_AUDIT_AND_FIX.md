# Hakotohito 追加監査・修正記録（2026-11-15）

## 対象と変更境界

- 基準：`Hakotohito_統合修正候補_20261114_統合台帳反映版_未適用.zip`
- 追加証拠：Tokyo DB読み取り専用スナップショット（取得時刻 `2026-11-15T01:00:00.301644+00:00`／日本時間10:00）
- 変更対象：この作業用パッケージ内のソースと監査文書のみ。
- 実Supabase、実リポジトリ、GitHub、Vercelは変更していない。
- build／lint／test／typecheck／ローカルチェックは実施していない。

## 1. 実機で発生したお気に入り登録エラー

### 原因

`src/app/facility/performers/page.tsx` はお気に入り登録時に `performer.user_id` を `targetUserId` として `/api/favorites` へ送信する。一方、`src/app/api/performers/route.ts` はレスポンス生成時に `user_id` を除外していた。その結果、施設側画面では `performer.user_id` が `undefined` になり、favorites APIが「お気に入り対象のユーザーIDが指定されていません」を返す。

### 作業用ソースの修正

- `/api/performers` でLINE ID tokenを検証した後、呼出ユーザーの `users.user_type` を取得。
- `user_type === 'facility'` の場合に限り、演奏者一覧レスポンスへ `user_id`（`users.id`）を含める。
- performer側など施設以外の呼出しには `user_id` を返さず、内部IDの不要な露出を避ける。
- お気に入り登録APIの既存契約（`targetUserId` は `users.id`）は変更しない。

**状態：** 作業用パッケージへ修正済み。実機での再確認は未実施。

## 2. 個別キャンセル後の再応募仕様の訂正

2026-11-14候補文書には「同一performer／同一bandの再応募不可」と記載されていたが、ユーザーによる仕様変更の確認が取れていない。ユーザーが事前に確定した仕様は、個別キャンセル時に関連applicationを`rejected`へ戻し、同一演奏者がrequestが`open`の間に再応募できること。

Tokyo DBスナップショットの関数定義では次を確認した。

- `apply_to_performance_request`：既存応募が`rejected`なら`is_reapply=true`とし、同じapplication行を`pending`へ戻す。
- `apply_to_performance_request_as_band`：既存応募行を再利用して`pending`へ戻す実装。バンド応募の再応募可否について独立したユーザー仕様確認は未取得のため、候補で禁止条件を追加しない。
- 現行`cancel_match_with_direct_invite_refund`：matchをcancelしrequestを再開するが、関連applicationを`rejected`へ更新する処理が見当たらない。
- `20261112_001_known_audit_fixes.sql`候補には、キャンセル対象matchの`application_id`が指す`accepted`応募を`rejected`へ戻す処理が含まれる。

**対応方針：** 再応募禁止の候補文書記述を訂正。applicationを`rejected`へ戻すDB差分は必要だが、既存migration全体の現行DB差分・ロック順序を確定するまでTokyoへ適用しない。

## 3. Tokyo DBの追加証拠（読み取り専用）

2026-11-15 10:00 JSTの取得結果：

- public routines：37件（うちSECURITY DEFINER 35件）
- routine owner：37件すべて`postgres`
- public triggers：2件
- default privileges：24項目
- Stripe constraints：24項目
- `cron.job` relation existence：false
- `stripe_webhook_events_processing_status_check` は `received / processed / ignored / failed` のみを許可し、候補005が追加しようとする`processing`を許可しない。
- `cancel_event_request_with_refund_internal` と `reject_direct_invitation_with_refund_for_withdrawal` はpostgresのみEXECUTE。その他のroutineは取得ACL上、service_roleにもEXECUTEが付与されている。

注意：`cron.job` relationが見つからなかったことだけで、pg_cron extensionや外部schedulerが存在しないとは断定しない。Edge Functions・外部schedulerも別途証拠が必要。

## 4. 公開を止めている既知事項（再監査せず継続）

- 完了RPCとキャンセルRPCのmatch/requestロック順序が逆転し、同時実行でデッドロックし得る。
- 退会・band・lesson・coin idempotency keyをまたぐロック順序が未統一。request単独gateを足すだけでは解消しない。
- 退会／全体キャンセル等のLINE通知に永続Outboxがなく、DB処理後の送信失敗を確実に再送できない。
- 完了報告、案件編集／削除、Stripe webhook等にRPCを迂回するAPI直接更新が残る。
- Stripe 005のclaim tokenはevent状態だけでなくorder／incident／ledgerの業務副作用全体をfenceする必要がある。
- 005はTokyo現行CHECKと不整合のため適用不可。004は新規基盤用で、既存Stripe基盤へ再適用しない。006〜008も現行DB差分・ロック・通知契約が未確定のため未適用。

## 5. 最短公開方針

- 公開候補の中心はLINEログイン、プロフィール、募集・応募・採用、マッチング、キャンセル、完了、コイン台帳、通知に絞る。
- レッスン機能は現行の停止状態を維持。
- Stripeコイン購入は `coin_purchase_enabled=false` を維持し、Webhook fencing・テスト決済・法的表示の確認が終わるまで公開対象に含めない。
- matching coreの共通ロック契約、キャンセルapplication状態、通知Outbox、API直接更新の原子化を先に完成させる。
- SQLはTokyoの現行定義に対する差分として作成し、preflight／postflight／rollbackを揃えてから個別承認を得る。

## 6. 未実施

- Tokyo／Mumbai DBへの変更・SQL適用
- ソースの実リポジトリ反映、Git commit／push
- Vercel環境変数変更・deploy
- build／lint／test／typecheck／ローカルチェック
- LINE実機再テスト、Stripe test mode

**総合判定：公開用完成版ではない。お気に入りID不整合は作業用ソースで修正済み。matching coreのP0事項が残るため、公開判定はBLOCKED。**
