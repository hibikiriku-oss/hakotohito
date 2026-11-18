# Hakotohito 追加静的監査追補（2026-11-14）

## 対象と制約

対象は `Hakotohito_統合修正候補_20261114_監査反映版_未適用.zip` の候補SQL、統合設計書、公開チェックリスト。今回もファイル内容の静的読解のみ。Supabase接続・SQL実行・DB変更・Git操作・Vercel操作・build／lint／test／typecheck・ローカルチェックは行っていない。

## 新規に確認した事項

### F-01：Webhook status CHECK の置換範囲が広すぎる（005）

`20261114_005_stripe_webhook_atomic_claim.sql` は、`stripe_webhook_events` 上で `pg_get_constraintdef(...) ILIKE '%processing_status%'` に一致するCHECK制約をすべてDROPし、その後 `received / processing / processed / ignored / failed` の5値だけを許可するCHECKを追加する。

- preflightは既存CHECK制約の名前・定義・個数・他の条件との複合有無を確認しない。
- status以外の条件も同じCHECKに含まれていた場合、その条件まで失われる。
- 既存運用で上記5値以外のstatusが存在する場合、制約追加時に既存行が原因でmigrationが失敗するか、既存値を許容していた契約を壊す。
- 対応：既存CHECKの完全定義をpreflightで固定し、status制約だけを名前と定義の完全一致で置換する。複合CHECKは分割または明示的に再構成し、未知のstatus値が1件でもあれば中断する。`NOT VALID`を使う場合も既存行検査とVALIDATE手順を別途定義する。

**判定：005は既存CHECK定義・status実データを確認するまで適用不可。**

### F-02：SECURITY DEFINER候補のsearch_pathが既存推奨契約と不一致（006／007）

006 `withdraw_user_account(text)` と007 `cancel_event_request_with_refund_internal(uuid,uuid,boolean)` は `SECURITY DEFINER` でありながら、関数設定が `search_path = public, pg_temp` となっている。今回の統合仕様で採用している強化基準 `pg_catalog, public, pg_temp` と一致しない。

これは直ちに悪用可能と確認したものではない（実際のschema CREATE権限・owner・ACLは未取得）。ただし、SECURITY DEFINER内で非修飾名を使う場合にpublic側のオブジェクト解決へ依存するため、適用前に全参照をschema-qualifiedにし、明示的search_pathを統一する必要がある。

**判定：006／007は関数owner・EXECUTE ACL・public schema CREATE権限・全非修飾参照の確認と修正が必要。**

### F-03：request単独gate案は全横断処理の共通排他として成立しない

既存 `CONCURRENCY_LOCK_ORDER_DESIGN_2026-11-14.md` 自体が、request gateだけではband／lesson／payment order／退会の複数ドメイン競合を解消できないと記載している。したがって、同文書の3.1〜3.2にあるrequest中心の単一順序は、確定設計として扱わない。

必要なのは、少なくとも以下の二層を全書込経路で一貫させること。

1. **aggregate gate層**：user/account、performance request、band、lesson offer、payment order等のgateを、固定ドメイン順位＋aggregate ID昇順で、いかなるテーブル行ロックより前に取得する。
2. **行ロック層**：全対象をgateで保護した後、テーブル順位＋主キー昇順で取得する。下位層を取得後に上位層へ戻らない。複数aggregateを扱う退会は対象集合を非ロック読取で収集し、gate取得後に集合・所有者・状態を再検証し、変化時は中断・再試行する。

ただしdomain順位そのものはまだ確定できない。全mutation RPC、API直接書込、trigger、Edge Function、pg_cron、外部scheduler、service_role直SQLの実行経路と、各関数の内部呼出し・advisory key取得順を揃えてから決める。request gateを関数先頭に追加するだけのSQLは作成しない。

### F-04：追加証拠SQLはproductionへ向けず、まずテスト環境限定

`docs/audit_evidence/20261114_readonly_execution_path_evidence.sql` はSELECT中心の証拠収集用だが、Q4は全public routineの完全な関数定義を返し、Q5はcron commandを返す。結果には内部実装やURL・token等の秘密情報が含まれる可能性がある。

- 指定どおり東京のテスト環境でQ0を先に実行し、database／role／timestampを記録する。
- Q4・Q5は共有前にsecret/token/credentialを必ず伏せる。関数のロック順・SQL構造は残す。
- Q5/Q6のrelation-not-foundやpermission deniedは、不存在の証明ではなく取得不能として扱う。
- production（Mumbai）への接続は今回の作業対象外。

## 既存所見の再確認（新規指摘ではない）

- 006の退会処理はuser/profile/matchを先にロックしてから既存cancel RPCを呼ぶため、通常キャンセルのrequest→match順と循環する。
- 退会・全体キャンセルのLINE PushはDB transaction内の永続outboxではなく、API応答後の一時データに依存する。送信失敗時の再送ができない。
- 005のprocessing tokenはイベント行の状態更新をfenceするだけで、注文・Payment Intent・incident等の業務副作用を同一tokenでfenceしていない。lease期限後の旧worker副作用が残る。
- 004は新規Stripe基盤用。既にStripeテーブルがあるDBへ再適用しない。005〜008も現行DBの完全な列・制約・function・owner・ACL・migration履歴との照合前は適用しない。
- 完了報告API、案件編集／削除API、Stripe Webhook等にRPCを迂回する直接DB更新がある。APIも含む一括切替が必要。

## 現時点の結論

本候補ZIPは監査・修正設計の作業用コピーであり、公開用完成版ではない。今回の追補で005のCHECK制約置換条件と006／007のSECURITY DEFINER search_path整合を追加阻害事項として記録した。ロック・通知outbox・Stripe fencing・全実行経路の未解決事項は継続する。

**公開判定：BLOCKED。DB適用・公開・Push・Deploy不可。**


## 追加反映：監査指摘に対する安全側修正

### F-01（005 CHECK制約）
- `processing_status`を含む既存CHECK制約を一括DROPする処理を候補SQLから撤去した。
- 既存CHECKが同列を参照する場合はpreflightで例外停止する。複合条件を含む制約を自動削除しない。
- 既存値がNULLまたは`received / processing / processed / ignored / failed`以外ならpreflightで停止する。
- この変更により、既存CHECKがある一般的なDBではmigrationが停止する。これは意図したfail-closed動作であり、現行制約の完全定義を取得後、条件を保持した個別置換SQLを別途作成する。

### F-02（006／007 search_path）
- 両SECURITY DEFINER関数の候補search_pathを`pg_catalog, public, pg_temp`へ変更した。
- これは関数探索順の改善であり、owner・ACL・public CREATE権限・非修飾オブジェクト参照の対象DB照合を代替しない。

**検証境界：** いずれも候補ファイルの静的編集のみ。PostgreSQL実行、Supabase適用、ローカルチェック、build／lint／test／typecheckは行っていない。公開判定はBLOCKEDのまま。
