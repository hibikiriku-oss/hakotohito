# 2026-11-14 退会処理統合候補（dual-role・直接依頼返金）

## 状態

`supabase/migrations/20261114_006_withdrawal_dual_role_direct_invite_refunds.sql` は作業用候補。Supabase未適用。

基準関数は2026-11-14 02:04 UTCの読み取り専用DBエクスポートに含まれる`withdraw_user_account(text)`。退会用返金helperは`reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)`。

## 反映した候補仕様

- `users.user_type`だけで片方のプロフィールを決めず、`performers`と`facilities`の両方を確認し、存在する両プロフィールを退会処理する。
- dual-roleユーザーのマッチング対象判定を施設側・演奏者側の両方で行う。
- 施設が送信した未成立直接依頼と、演奏者が受信した未成立直接依頼をそれぞれ列挙し、既存の退会用返金helperを呼び出す。
- 返金額は設定値ではなく、元の`direct_invite_fee`取引の実額を参照する。元の引落行がない依頼は返金を捏造せず、応募だけ`rejected`にする。
- 返金冪等キー`direct_invite_refund:<application_id>`が既に存在する場合は、重複通知を生成しない。
- APIが期待する`pendingDirectInviteNotifications`と`pendingDirectInviteRefundNotifications`をRPC戻り値に追加する。
- helper失敗時は例外で退会トランザクション全体をロールバックする。

## 適用前に解消すべき重要事項

1. 現行helperは案件行→施設ユーザー行→応募行の順でロックする。一方、現行退会関数は最初にユーザー行をロックしてから案件・マッチングを処理するため、他の応募・招待処理との間でデッドロックが起きる可能性がある。デッドロック時はトランザクション全体がロールバックする。APIはRPCエラーをログに残し、詳細をクライアントへ漏らさず409の再試行案内を返す候補に変更した。ユーザー方針上、全件ロールバック・再試行可能・追跡可能なログを満たす場合は稀なデッドロックを許容するが、適用前にDB側の例外が全処理をロールバックすることを確認する。
2. dual-roleユーザーが自分の施設から自分の演奏者プロフィールへ直接依頼を送った場合の通知先・自己通知抑止を最終確認する。
3. 退会対象ユーザーが複数の直接依頼・複数マッチングを持つ場合の通知重複・順序を確認する。
4. `cancel_match_with_direct_invite_refund`、helper、全体キャンセルRPCとのロック順序と冪等性を、現行DB定義で再照合する。
5. 退会用helperのowner・SECURITY DEFINER・EXECUTE権限を確認する。`withdraw_user_account`のownerで実行可能であることを適用直前に確認する。

## ロールバック

`docs/20261114_006_withdraw_user_account_before.sql`は読み取り専用DBエクスポートから保存した置換前関数定義。ロールバックは、適用対象DBが同一であること、関数signatureと所有者・権限が一致することを確認してから実施する。権限・ownerは置換前の状態を別途取得し、必要なら復元する。

## 未実施

- SQL適用、実退会、実返金、LINE通知テスト
- build／lint／test／ローカルチェック
- GitHub Push／Vercel Deploy
