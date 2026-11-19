# 2026-11-14 全体キャンセル通知対象の厳密化

## 状態

`supabase/migrations/20261114_007_event_cancel_notification_targets.sql` は候補。未適用。

## 変更契約

- `cancel_event_request_with_refund_internal`は今回実際に`matches`をキャンセルしたIDだけを`cancelledMatchIds`として返す。
- 全体キャンセルAPIはRPC実行前のactive matchesを通知対象にしない。
- RPC成功後に返されたIDでキャンセル済みmatchだけを再取得し、`performer_id`と`participant_performer_ids`の両方から対象演奏者を集める。
- `users.account_status='active'`かつ退会済みLINE IDではないユーザーだけに通知する。
- 未承認直接依頼の返金通知は、DBが実際に返金した対象のみ別通知として送る。マッチング中止通知との重複抑止で返金案内を消さない。

## 適用前提

- DB関数の完全な現行定義を取得し、11月12日schema dumpとの差分を確認する。
- `cancel_event_request_with_refund` wrapperが内部関数の戻りJSONをそのまま返すことを確認する。
- `participant_performer_ids`が現行matchesテーブルに存在し、実際の参加者IDを含むことを確認する。
- SQLとAPI sourceを同一リリース単位で適用する。SQL未適用の状態でAPIだけをデプロイしない。

## ロールバック

置換前の内部関数定義は`schema(2).sql`の該当箇所から復元する。適用前に対象DBから現行定義・owner・ACLを別途保存し、対象DBが一致することを確認してから戻す。
