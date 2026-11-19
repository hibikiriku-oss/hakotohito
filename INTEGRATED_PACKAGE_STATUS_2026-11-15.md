# Hakotohito 統合修正候補パッケージ状況（2026-11-15）

## 今回の基準

- ソース・SQL基準：`Hakotohito_統合修正候補_20261114_統合台帳反映版_未適用.zip`
- 追加DB証拠：Tokyo DB snapshot（2026-11-15 10:00 JST）
- 今回の修正版：お気に入りIDレスポンス不整合と再応募仕様記述を訂正した作業用コピー。

## 今回反映した修正

1. `src/app/api/performers/route.ts`
   - 施設ユーザーの演奏者検索に限り、favorites APIが必要とする`user_id`を返す。
   - performer等、施設以外のユーザーには内部`user_id`を返さない。
2. 個別キャンセル後の再応募仕様
   - applicationを`rejected`へ戻し、同一演奏者はrequestが`open`なら再応募可能というユーザー確定仕様へ訂正。
   - バンド再応募は現行DB関数が既存行を再利用する。独立仕様の確認がないため、禁止条件を追加しない。
3. `PUBLIC_RELEASE_CHECKLIST.md`、統合修正台帳、関連レポートを更新。

## 現在の公開阻害事項

- matching coreの全書込経路にまたがる共通ロック順序が未完成。
- 現行キャンセルRPCは対象applicationを`rejected`に戻していない。正しい差分は必要だが、共通ロック設計と一体で適用する。
- 退会／全体キャンセル／返金通知の永続Outboxと再送workerが未完成。
- 完了報告・案件編集／削除・Stripe webhook等にAPI直接更新が残る。
- Stripe webhook claim tokenがorder／incident／ledgerの業務副作用全体をfenceしていない。
- Edge Functions・外部scheduler等の全実行経路証拠が未完了。

## 機能公開の最短方針

- matching coreの公開に集中。
- Lessonは停止状態を維持。
- Stripeコイン購入は`coin_purchase_enabled=false`を維持し、Webhook fencing・テスト決済・法的表示確認まで公開しない。
- 004は既存Stripe基盤に再適用しない。005〜008は現行DB差分と安全条件が確定するまで適用しない。

## 操作実績

- 作業用パッケージ内のソース・文書のみ変更。
- Supabase、GitHub、実リポジトリ、Vercelは変更していない。
- Git commit／push、deploy、build／lint／test／typecheck／ローカルチェックは未実施。
- お気に入り修正のLINE実機再確認は未実施。

**総合判定：公開用完成版ではない。公開判定BLOCKED。**


## 2026-11-15 追加：全37 public routineロック取得棚卸し

- Tokyo DBスナップショット内37 routineのFOR UPDATE／FOR SHARE／advisory lockとroutine呼出し順を静的抽出。
- request単独gateだけではband／lesson offer／payment order／user／idempotencyの逆順を解消できないことを確認。
- 安全な次段階は全aggregate gate先取り＋集合再検証＋固定行ロック順＋gateなしinternal helperへの分離。
- 部分SQLは作らず、監査文書 `20261115_MATCHING_CORE_LOCK_INVENTORY.md` を追加。
- 実DB・GitHub・Vercel・実リポジトリ変更なし。ローカルチェックなし。


## 2026-11-15 追加：ロック統一実装の入力確認

- 37 routineのロック順棚卸しは存在するが、2026-11-15 Tokyo snapshotの全routine完全定義は作業用ZIPに同梱されていないことを確認。
- 定義・ACL・search_pathを推測して一括migrationを作ることは避ける。
- 読み取り専用の完全定義export SQL `docs/20261115_REQUIRED_FULL_ROUTINE_EXPORT.sql` と不足入力記録 `20261115_LOCK_IMPLEMENTATION_BLOCKER.md` を追加。
- DB／実リポジトリ／GitHub／Vercelの変更なし。ローカルチェックなし。
