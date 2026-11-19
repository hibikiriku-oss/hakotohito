# matching core ロック統一実装の入力不足（2026-11-15）

## 判定

全37 routineのロック取得順・内部routine呼出しの棚卸しは完了している。一方、現在の作業用ZIPには棚卸し結果だけがあり、2026-11-15 Tokyo snapshotの全routine完全定義（`pg_get_functiondef`結果）が同梱されていない。

この状態で新しいgate helperやRPC差し替えSQLを作ると、引数・戻り値・例外契約・既存ACL・内部routineの呼出し順を推測することになり、実DBへ適用可能な一括migrationとして保証できない。特に`SECURITY DEFINER`関数の既存ACLを落とす、overloadを誤る、triggerからの呼出しを見落とす危険がある。

## 次に必要な入力

`docs/20261115_REQUIRED_FULL_ROUTINE_EXPORT.sql`をTokyoのSQL Editorで読み取り専用実行し、結果をCSVまたはテキストで保存して作業パッケージへ追加する。これはSELECT/catalog参照のみで、DB状態を変更しない。

## 完全定義を受領後の実装順

1. 37 routineの完全定義を現行署名・ACL・search_path込みで固定。
2. matching coreに関係するmutation入口とhelperの依存グラフを確定。
3. aggregate gateの固定順位、ID順、再検証条件を設計。
4. gate取得済みinternal helperへ分離し、nested gate後取りを除去。
5. 完了報告、採用、キャンセル、返金、退会、band、coin spendを同一規約へ統合。
6. application `rejected`遷移、イベント／レンタル初回料金once、返金台帳、Outboxを同一transactionへ統合。
7. API直接書込を新RPCへ切替。
8. Tokyo現行定義に一致するpreflight/postflight/rollbackを作成。

## 変更境界

- 現段階では完全定義の推測によるSQL・RPC実装は作成しない。
- Tokyo／Mumbai DB、実リポジトリ、GitHub、Vercelは変更しない。
- build／lint／test／typecheck／ローカルチェックは行わない。
- Lessonは停止維持、Stripeコイン購入は`coin_purchase_enabled=false`維持。
