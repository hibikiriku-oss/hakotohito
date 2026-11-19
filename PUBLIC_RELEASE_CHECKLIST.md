# 公開準備チェックリスト

最終更新：2026-11-19（Phase 2 v45候補・登録承認制／レッスン仮押さえ撤廃）


> **2026-11-19時点の重要状態**：レッスン機能は有効のまま維持。Stripeコイン購入は`coin_purchase_enabled=false`で停止（ユーザー適用報告）。V44候補のmigration適用状態は一括して未適用とは扱わず、`20261116_009`はユーザー適用報告あり、他migrationは個別確認が必要。`venue_address`、案件削除RPC、通知Flexリンク等の個別反映状況は別紙`docs/20261119_V45_CHANGE_AND_DATABASE_STATUS.md`に記録。V45の新規変更は未適用・未デプロイ。ローカルチェック／build／lint／test／typecheckは実施しない。

> **2026-11-19時点の追記**：Vercel TypeScript修正7ファイル（`422ca04`の5ファイル、`2ba38e5`の2ファイル）はGitHubへPush済みとのユーザー報告。施設側実機でマッチング一覧取得失敗、案件登録失敗、直接依頼通知未着、直接依頼送信時の-100コイン、UI導線不足を確認。v44候補では実機所見とread-only診断SQLを追加したが、東京DBのmigration適用状態は未確認。直接依頼は成立時課金・不足時不成立が最新方針。返金撤廃の範囲は未確定。

> **2026-11-19 v45候補追記**：V44を基準に、レッスン募集の仮押さえ撤廃（登録・編集時は定員分残高確認のみ、`reserved_coins=0`、即時マッチング成立時に最新料金で原子徴収）、バンド送金からレッスン予約残高控除を除去、新規登録を`pending_approval`でロビー待機させる管理者承認フローを候補ソース／migrationへ追加。既存の演奏応募・直接依頼の成立時課金設計は維持。v45候補は未適用・未デプロイ。既存DBのmigration適用状態はユーザー報告・個別SQL結果・ライブ関数確認に分けて別紙台帳で管理する。ローカルチェック／build／lint／test／typecheckは実施しない。


## 1. 基本前提・環境

- [x] Supabaseのデータバックアップ
- [x] VercelとGitHubの接続確認
- [x] LINE LIFFのログイン動作確認
- [x] 管理者アカウントの登録
- [x] 管理者画面へのアクセス制限
- [x] LINE IDトークンによる本人確認の導入
- [x] 管理者APIの本人確認
- [x] CRON_SECRETの設定
- [x] Google Maps APIキーの設定・動作確認
- [ ] 本番環境の環境変数を最終確認
- [ ] 不要な環境変数・古い設定の整理

## 2. 認証・アクセス制御

### ユーザー・プロフィール

- [x] users APIの認証確認
- [x] users APIのユーザー情報更新制御
- [x] performers一覧APIの認証確認
- [x] performers詳細APIの認証確認
- [x] performersレビューAPIの認証確認
- [x] facilities詳細APIの認証確認
- [x] favorites APIの認証確認
- [x] APIでLINE IDトークンからユーザーを特定する仕組み
- [x] クライアントから送られたユーザーIDを本人確認に使用しないこと

### 公開情報・閲覧範囲

- [x] 未ログイン状態で演奏者プロフィールを閲覧できないこと
- [x] 未ログイン状態で施設プロフィールを閲覧できないこと
- [x] ログインユーザーがプロフィールを閲覧できること
- [x] 公開案件一覧の匿名閲覧
- [x] 匿名の案件一覧レスポンスから施設プロフィール情報を除外
- [x] ログイン時の案件詳細情報の取得制御
- [x] APIレスポンスに不要なユーザー情報を含めないこと

## 3. 演奏案件・レッスン関連API

### 演奏案件

- [x] 案件一覧APIの認証・公開範囲確認
- [x] 案件作成APIの本人確認
- [x] 案件詳細APIの本人確認
- [x] 案件更新・削除時の施設所有者確認
- [x] 応募期限の確認
- [x] 募集状態の確認
- [x] 募集対象レベルの確認
- [x] 匿名レスポンスで施設情報を除外

### レッスン

- [x] レッスン募集一覧APIの認証確認
- [x] レッスン募集詳細APIの認証確認
- [x] レッスン募集作成APIの本人確認
- [x] レッスン募集更新APIの本人確認
- [x] レッスン募集の所有者確認
- [x] レッスン応募APIの本人確認
- [x] レッスン応募時のコイン処理をDB関数で実行
- [x] レッスン関連DB関数の実行権限をservice_roleに限定
- [x] レッスン募集作成・編集時は定員分の残高確認のみ（仮押さえなし、v45候補）
- [x] レッスン成立時に最新料金を再確認し同一トランザクションで徴収（v45候補）
- [x] 既存lesson_offers.reserved_coinsの仮想予約値を0に統一するmigrationを追加（v45候補）

### 地図検索

- [x] 地図検索APIのLINE本人確認
- [x] ログイン中の演奏者本人の応募案件を取得
- [x] 公開状態・本人の応募状態に応じた表示制御
- [x] 施設住所の取得範囲確認

## 4. 応募・マッチング・レビュー

### 個人応募

- [x] 個人応募APIのLINE本人確認
- [x] 応募者をLINE IDからサーバー側で特定
- [x] 応募対象案件の確認
- [x] 応募期限のDB側チェック
- [x] 募集対象レベルのDB側チェック
- [x] レベル表記の正規化
- [x] 応募登録と応募試行記録のDB一括処理（課金はマッチング成立時、SQL候補・DB未適用）
- [x] 応募処理の二重実行対策
- [x] DB関数の実行権限をservice_roleに限定
- [x] 個人応募DB関数のメッセージ2000文字制限
- [x] 個人応募APIの案件ID UUID形式チェック
- [x] 個人応募APIのメッセージ型チェック
- [x] 個人応募APIのメッセージ2000文字制限
- [x] 個人応募APIの修正後レビュー

### 応募承認・マッチング

- [x] 施設側の応募承認APIのLINE本人確認
- [x] 施設所有者の確認
- [x] 応募対象案件と応募情報の整合性確認
- [ ] 応募承認・応募手数料・成立手数料・マッチング作成を同一トランザクションで実行
- [x] 応募承認時の案件行ロック
- [x] バンド応募の場合のバンド行ロック
- [x] バンド応募の場合の応募行ロック
- [x] バンド応募者が現役リーダーであることの再確認
- [x] バンドが活動中であることの再確認
- [x] バンド応募処理と応募承認処理のロック順序統一
- [x] DB関数の実行権限をservice_roleに限定
- [x] イベント案件の採用APIで、定員に達していない場合はmatched状態でも追加採用できるよう修正
- [x] 採用APIのUUID・環境変数・RPC結果の検証を確認
- [x] 採用APIのエラー応答とキャッシュ防止を確認
- [x] 採用後のLINE通知結果に応じた画面表示を確認
- [x] 施設側応募一覧APIの施設所有者確認を確認
- [x] 採用済み演奏者数を個人応募1人・バンド応募は所属メンバー数で集計するよう修正
- [x] 応募一覧画面の件数表示を「応募件数」「応募中」に整理
- [ ] 修正後の応募一覧・採用処理のLINE実機動作確認

### 直接招待・承諾

- [x] 施設からの直接招待APIの本人確認
- [x] 招待対象案件の施設所有者確認
- [x] 直接招待時は残高確認のみ行い、課金はマッチング成立時に実行（SQL候補・API反映、DB未適用）
- [x] 演奏者側の直接招待承諾APIの本人確認
- [x] 招待された本人であることの確認
- [x] 直接招待料・成立料・マッチング作成を同一トランザクションで実行（SQL候補、DB未適用）
- [x] 直接招待承諾時の案件行ロック
- [x] 直接招待承諾DB関数の実行権限をservice_roleに限定

### レビュー

- [x] レビュー取得APIの本人確認
- [x] レビュー投稿APIの本人確認
- [x] マッチング参加者本人であることの確認
- [x] 演奏完了済みマッチングのみレビュー可能
- [x] レビュー報酬のDB一括処理
- [x] レビュー報酬の二重付与防止
- [x] レビューDB関数の実行権限をservice_roleに限定
- [x] レビューコメントのAPI側1000文字制限
- [x] レビューコメントの施設側・演奏者側画面の1000文字制限
- [x] レビューコメントの文字数制限を最終確認

## 5. バンド関連

### バンドAPI

- [x] バンド一覧・作成APIの本人確認
- [x] バンド詳細APIの本人確認
- [x] バンド招待APIの本人確認
- [x] バンド応募APIの本人確認
- [x] バンドコイン移動APIの本人確認
- [x] バンドメッセージAPIの本人確認
- [x] バンドメンバーの閲覧範囲確認
- [x] バンドメッセージの閲覧範囲確認
- [x] バンド操作時の本人確認と対象バンドの所属確認

### バンド応募・承認

- [x] バンド応募時のリーダー確認
- [x] バンド応募時の全メンバーレベル確認
- [x] バンド応募時の案件期限確認
- [x] バンド応募時は残高確認のみ行い、リーダー手数料は成立時に徴収（SQL候補・DB未適用）
- [x] バンド応募の重複登録防止
- [x] バンド応募試行IDと成立時課金の冪等性をコード候補へ反映（DB未適用・実機未確認）
- [x] バンド応募・承認時のロック順序統一
- [x] 応募承認時のバンド活動状態確認
- [x] 応募承認時の現役リーダー資格確認
- [x] バンド応募の再実行時に施設への重複通知が発生しないかコード上で確認

### バンド招待・解散・コイン移動

- [x] バンド招待承認時のバンド行ロック
- [x] バンド解散時のバンド行ロック
- [x] バンド解散時の進行中マッチング確認
- [x] バンド解散時の招待・メンバー状態更新
- [x] バンドコイン移動時の所属確認
- [x] バンドコイン移動時の残高・予約コイン確認
- [x] バンドコイン移動のDB一括処理
- [x] バンド関連DB関数7件のSECURITY DEFINER確認
- [x] バンド関連DB関数7件の実行権限をservice_roleに限定
- [x] バンド招待の重複送信対策を確認
- [x] バンド招待を送信できるメンバーの権限仕様を確認
- [x] バンド招待の送信権限を「リーダーのみ」に確定・実装

## 6. コイン関連

### 残高・履歴・料金

- [x] コイン残高APIの本人確認
- [x] 自分自身の残高だけを取得すること
- [x] コイン残高APIのキャッシュ禁止
- [x] コイン履歴APIの本人確認
- [x] 自分自身のコイン履歴だけを取得すること
- [x] コイン履歴APIの取得件数100件制限
- [x] コイン履歴APIのキャッシュ禁止
- [x] コイン料金設定APIの公開範囲確認
- [x] 管理者向けコイン料金設定APIの管理者認証
- [x] コイン料金設定の入力値チェック
- [x] 管理者コイン料金設定APIの不正JSON・本文形式チェック

### 管理者によるコイン付与

- [x] 管理者コイン付与APIの管理者認証
- [x] 付与対象ユーザーの確認
- [x] 付与額・説明文の入力値チェック
- [x] admin_grant_coinsの原子性確認
- [x] admin_grant_coinsの二重実行対策
- [x] admin_grant_coinsの実行権限をservice_roleに限定
- [x] 管理者コイン付与APIの不正JSON・本文形式チェック

### コイン消費・手数料

- [x] spend_coinsの本人・対象情報確認
- [x] spend_coinsの二重実行対策
- [x] spend_coins_legacyの残高ロック確認
- [x] 応募料金をマッチング成立時に徴収するSQL候補を作成（DB未適用）
- [x] 直接招待料金をマッチング成立時に徴収するSQL候補を作成（DB未適用）
- [x] 成立時の応募料・直接依頼料・成立料の原子徴収をSQL候補へ反映（DB未適用・実機未確認）
- [x] レッスン応募料金のDB処理確認
- [x] バンド応募料金を成立時にリーダー個人から徴収するSQL候補を作成（DB未適用）
- [x] 演奏完了時の1%手数料機能の実装
- [ ] 演奏完了時の1%手数料の実徴収テスト
- [x] コイン関連API・DB関数の最終横断レビュー
- [ ] コイン履歴と残高の整合性を実データで確認

## 7. 新規登録・管理者承認（v45候補）

- [x] 新規ユーザーは`pending_approval`で登録し、初回から通常機能へ遷移させない
- [x] ロビー画面で承認待ち状態を案内し、利用者が承認状態を再確認できる
- [x] 既存のactiveユーザーは従来どおり利用可能
- [x] 承認待ちユーザーは既存のactive-account API／DBガードで通常機能を利用不可
- [x] 管理者専用の承認待ち一覧・承認API・承認画面を追加
- [x] 承認者・承認日時をusersへ記録
- [ ] 管理者承認からLINEホーム利用開始までの実機確認

## 8. 問い合わせ・お知らせ・管理者機能

- [x] 管理者画面のアクセス制限
- [x] 管理者によるコイン付与機能
- [x] 管理者によるコイン料金設定
- [x] 問い合わせ管理機能
- [x] 問い合わせステータス管理
- [x] お知らせ管理機能
- [x] お知らせ公開・非公開切り替え
- [x] 演奏者ホームのお知らせ表示
- [x] 施設ホームのお知らせ表示
- [x] 管理者異議申し立て更新APIの管理者認証
- [x] 管理者異議申し立て更新APIのUUID・本文・操作内容チェック
- [x] manage_completion_dispute_caseの状態確認・行ロック・入力チェック
- [x] manage_completion_dispute_caseの実行権限をservice_roleに限定
- [x] 管理者お知らせAPIの管理者認証・入力チェック
- [x] 管理者コイン料金設定APIの管理者認証・入力チェック
- [x] 問い合わせAPIの最終認証・入力チェック
- [x] 管理者コイン付与APIの不正JSON・本文形式対応
- [x] 管理者異議申し立て更新APIの不正JSON・本文形式対応
- [ ] 管理者機能の最終動作確認

## 9. その他のAPI・セキュリティ監査

### 演奏完了・キャンセル・異議申し立て

- [x] register_completion_disputeの呼び出し元・認証確認
- [x] 異議申し立てAPIの本人確認
- [x] 異議申し立て時のマッチング参加者確認
- [x] 異議申し立てAPIの入力チェック
- [x] 異議申し立て中のキャンセル制御
- [x] 演奏完了APIの本人確認・状態確認
- [x] 演奏完了時の二重処理・通知制御
- [x] 通常キャンセルAPIの本人確認・返金処理確認
- [x] イベント案件キャンセル時の返金処理確認
- [x] 異議申し立て・キャンセル・演奏完了のDB処理確認
- [x] キャンセル用DB関数2件のSECURITY DEFINER・search_path確認
- [x] キャンセル用DB関数2件の実行権限確認（anon・authenticated不可、service_roleのみ可）
- [x] イベント・レンタル案件のperformance_statusがNULLのマッチングデータが存在しないことを確認
- [ ] 共通トランザクションロックを全更新RPC・publicテーブル書き込みへ適用し、ロック順序を統一
- [x] 全体キャンセルDB関数における保留中の直接依頼手数料の実額返金・応募状態更新・冪等性確認
- [ ] 全体キャンセルAPIでDB関数が返す未成立直接依頼の通知情報を使用したLINE通知
- [x] イベント・レンタル案件のキャンセル後に再成立した場合の初回成立手数料を一度だけ請求する仕様の確定・DB処理確認
- [ ] 個別キャンセル時に関連応募を `rejected` に戻し、再応募可能にするDB修正の適用・確認（同一演奏者は案件が `open` なら再応募可能。他の応募者も既存条件を満たせば応募可能）
- [ ] 個別キャンセルAPIの返金メッセージを実際の返金内訳に基づく方式に改善
- [ ] 退会時に旧方式で徴収済みの未成立直接依頼のみ返金し、新方式の未徴収分は返金なしで却下するDB処理
- [ ] 演奏者退会・施設退会の両方で未成立直接依頼を処理し、旧方式の徴収済み分だけ返金すること
- [ ] 退会APIとDB関数間の返金通知データの受け渡し・LINE通知を整合させる
- [ ] キャンセル・退会時の返金額と通知内容の整合性確認

### チャット機能

- [x] チャットAPIのLINE IDトークン本人確認
- [x] マッチング参加者のアクセス制御
- [x] バンドマッチング時の現役リーダー確認
- [x] メッセージ送信者を認証済みユーザーから特定
- [x] メッセージ本文の入力チェック
- [x] チャット取得APIのページネーション
- [x] 同一日時のメッセージを考慮した取得カーソル
- [x] 過去メッセージ取得時の既読状態への影響確認
- [x] APIレスポンスのキャッシュ防止
- [x] 演奏者側チャット画面の過去メッセージ追加取得
- [x] 施設側チャット画面の過去メッセージ追加取得
- [x] 両画面の新着メッセージ取得時の履歴保持
- [x] 過去メッセージ読み込み後のスクロール位置維持
- [x] 権限がなくなった場合のチャット画面の表示制御
- [ ] チャット機能のLINE実機動作確認

### 施設マッチング一覧

- [x] 施設マッチング一覧APIのLINE IDトークン本人確認
- [x] 認証済みユーザーから施設IDを取得する処理の確認
- [x] 施設マッチング一覧画面のBearerトークン送信確認
- [x] 施設マッチング一覧画面のキャッシュ防止
- [x] `performance_requests!inner` と施設IDフィルターによる施設所有案件への限定
- [x] 他施設のマッチング・演奏者情報が混入しないことのコード上の確認
- [x] 施設マッチング一覧APIのレスポンスキャッシュ防止
- [x] 施設マッチング一覧APIのエラー応答確認
- [x] 施設マッチング一覧APIの取得件数方式の確認（現状の一括取得を維持し、上限追加は保留）
- [ ] 修正後の施設マッチング一覧画面のLINE実機動作確認

### その他のAPI・共通セキュリティ

- [ ] 残存する全APIの認証方式を横断確認
- [ ] x-line-user-idなどクライアント申告IDへの依存がないことを再確認
- [ ] APIのUUID・文字数・数値など入力チェックの横断確認
- [ ] APIレスポンスに不要な個人情報が含まれないことを確認
- [ ] エラー処理・ログ出力に機密情報が含まれないことを確認
- [x] 現存するpublicテーブルのRLS有効化を確認
- [ ] 現存するpublicテーブルのanon・authenticated権限を全て取り消し（2026-11-18アップロード済みACLでREFERENCES/TRIGGER/TRUNCATE残存を確認。migration 005候補あり・未適用）
- [x] 現存するpublicテーブルのシーケンス権限を確認
- [x] SECURITY DEFINER関数の一部に残っていたPUBLIC・anon・authenticated実行権限を修正
- [ ] SECURITY DEFINER関数のsearch_path・実行権限の最終確認
- [ ] service_roleキーがクライアント側に露出していないことを確認
- [ ] Supabaseのデフォルト権限設定の制約を踏まえた新規テーブル作成後の権限確認手順を確定
- [ ] 不要なバックアップファイル・スクリプトの整理
- [ ] 不要な管理用・検証用コードの整理

## 10. 最終リリース確認

- [ ] 全API監査の完了
- [ ] 全DB関数・権限監査の完了
- [ ] npm run build 成功
- [ ] Git差分の最終確認
- [ ] commit・push
- [ ] Vercel本番デプロイ成功
- [ ] 本番URLでのログイン確認
- [ ] LINE実機で演奏者側の主要操作確認
- [ ] LINE実機で施設側の主要操作確認
- [ ] 応募・承認・マッチングの実動作確認
- [ ] 直接招待・承諾の実動作確認
- [ ] バンド機能の実動作確認
- [ ] レッスン機能の実動作確認
- [ ] チャット機能の実動作確認
- [ ] コイン残高・履歴の実動作確認
- [ ] コイン付与の実動作確認
- [ ] 演奏完了時の1%手数料の実徴収確認
- [ ] 問い合わせ・お知らせ機能の実動作確認
- [ ] 公開前の最終バックアップ
- [ ] 公開判断

---

## 11. 進行履歴

### 2026-11-16 matching core 課金・応募期限・共通ロック修正候補（作業用コピーのみ）

- Tokyo本番から受領した37関数の完全定義を使用し、更新系31関数に共通トランザクションロックを先行取得させるSQL候補`20261116_009_global_mutation_gate.sql`を作成。publicスキーマの全テーブルにも書き込み開始時のstatement triggerを設置する構成とし、関数定義ハッシュの事前照合とrollback候補を用意。
- `application_attempts`を追加する`20261116_010`を作成。既存coin_transactionsは保持し、既存応募は履歴から最新の試行をbackfill。新規応募・直接依頼は7日間で期限切れとし、期限切れ時は応募を`rejected`へ戻す。期限チェックは承認RPCでも行う。
- 個人応募・バンド応募・直接依頼の作成時は料金を徴収せず、必要残高の確認と試行記録のみ行う`20261116_011`を作成。
- 個人・バンド応募の応募料、直接依頼料、通常マッチング成立料、イベント／レンタル初回成立料をマッチング成立時に同一トランザクションで徴収する`20261116_012`を作成。コイン不足時はマッチング・課金をrollbackし、応募／依頼をpendingのまま維持する。
- 個別キャンセル後の応募`rejected`遷移、再応募ごとの課金キー、直接依頼の新旧返金キー互換、退会時の未成立直接依頼処理を`20261116_013`へ反映。
- API/UI作業用コピーに応募時の課金説明、バンド応募通知条件、コイン不足時の相手側LINE通知、応募期限Cronを反映。
- 上記SQLはすべて候補で未適用。作業用srcのみ変更し、実リポジトリ、Supabase、GitHub、Vercelは変更していない。ローカルチェック・build・lint・test・typecheckは実施していない。公開判定は引き続きBLOCKED。

### 2026-11-14 統合監査・修正候補（作業用コピーのみ）

- 最終成果物を「相互整合した統合修正版ソース」と「DB適用用SQL」に分離する方針を確定。個別パッチの継ぎ足しではなく、API・UI・DB関数・権限・通知・決済の契約を横断して整合させる。
- 個別キャンセル後の応募状態は`rejected`とし、案件が`open`なら同一演奏者の再応募を可能にする方針を維持。案件全体キャンセルは`closed`とし、再募集は新しい案件IDで行う。イベント／レンタル初回料金は同一案件IDにつき一度だけ。
- `withdraw_user_account`のDB関数定義は現行ソースZIP内にはないが、2026-11-14の読み取り専用DBエクスポートから完全な定義を回収。退会APIが期待する2種類の直接依頼通知配列がDB戻り値にないこと、`user_type`分岐でdual-roleの片方しか処理しないこと、退会用返金helperが呼び出されていないことを確認。
- dual-role処理と未成立直接依頼の実額返金・通知配列を追加する`20261114_006_withdrawal_dual_role_direct_invite_refunds.sql`候補を作成。helperと退会関数のロック順序が逆転する可能性があるため、適用前のロック順序監査を必須とし、未適用のまま保留。
- Stripeコイン購入RPCで残高整数上限超過時に注文を`paid_review`へ移し、`balance_overflow`事故記録を作成する候補修正を004へ反映。既存DB向け差分として`20261114_008_stripe_balance_overflow_paid_review.sql`も作成。実際の残高加算は行わない。
- Stripe Webhookのイベント重複処理に対し、DB行ロック・処理トークン・5分leaseによる排他的claimを追加する`20261114_005_stripe_webhook_atomic_claim.sql`を新規作成。対応するWebhook APIをclaim RPCとトークン付き状態更新へ変更。
- 005は既存Stripe DB基盤に対する差分候補。現行DBにはStripe関連テーブルが既に存在するため、004をそのまま再適用しない。適用前に対象DBの列・制約・関数・権限・所有者・migration履歴を照合する。
- レッスンの変更系APIは503停止済みだが、演奏者ホーム・一覧・詳細・編集・新規画面・地図に操作導線や募集表示が残ることを確認。画面側停止との統合は未完了。
- 全体キャンセルAPIはRPC実行前のactive matchesを通知対象にしている。DBが実際にキャンセルした対象との一致、およびバンド参加者通知を保証できないため未完了。
- 個別キャンセル・全体キャンセル・退会・完了処理のロック順序は引き続き要監査。デッドロック発生は確認していない。
- ソース変更は作業用コピーのみ。Supabase SQL適用、データ変更、GitHub Push、Vercel Deployは未実施。ビルド・Lint・テスト・ローカルチェックも未実施。
- 30分を超えて作業が継続する場合は経過報告を行う。Supabase適用・Push・Deploy・本番データ変更は操作ごとに内容と影響を提示して個別承認を得る。


### 2026-11-05 キャンセル・退会・返金処理の追加監査

- 個別キャンセルAPI（施設側・演奏者側）の認証、対象者確認、キャンセルDB関数の呼び出しを確認。
- 個別キャンセルでは、施設側・演奏者側の両APIが `cancel_match_with_direct_invite_refund` を使用していることを確認。
- 個別キャンセルDB関数は、実際に徴収した直接依頼手数料・マッチング成立手数料・イベント／レンタル料金を取引履歴から確認して返金する構造であることを確認。
- 個別キャンセルDB関数の返金は、冪等キーを使用して二重返金を防ぐ構造であることを確認。
- 個別キャンセルAPIの返金メッセージが `refundAmount === 100` で直接招待手数料の返金を判定していることを確認。この判定では、複数種類の返金や料金設定変更時に誤った案内になるため修正が必要。
- 個別キャンセル時のLINE通知には、実際の返金額・返金内訳が十分に反映されていないことを確認。
- 個別キャンセルDB関数は、関連する採用済み応募の状態を `rejected` に更新していないことを確認。現在のままでは、キャンセル後も応募状態が `accepted` のままとなり、演奏者が再応募できない可能性がある。採用済み応募を `rejected` に変更して再応募可能にする仕様を維持する。
- 全体キャンセルAPI `src/app/api/facility/requests/[id]/cancel/route.ts` を確認。DB関数が返す `pendingDirectInviteNotifications` をAPI側で使用しておらず、返金対象となった未成立直接依頼の演奏者へのLINE通知が行われていないことを確認。
- 全体キャンセルDB関数 `cancel_event_request_with_refund_internal` の現行定義を再確認。保留中の直接依頼について、実際の徴収額を取引履歴から取得して返金し、応募状態を `rejected` に変更し、冪等キーで二重返金を防ぐ処理が既に実装されていることを確認。
- したがって、全体キャンセル時の保留中直接依頼の返金DB処理自体は確認済みとし、未完了事項は主にAPI側の通知データ受け渡し・LINE通知とする。
- 2026-11-03の「全体キャンセル処理では保留中の直接依頼が返金対象にならない可能性」という評価は、今回のDB関数定義の再確認により訂正する。現在のDB関数には返金処理が実装されている。過去の履歴は監査時点の記録として残す。
- 退会API `src/app/api/withdraw/route.ts` を確認。API側には `pendingDirectInviteNotifications` と `pendingDirectInviteRefundNotifications` を受け取ってLINE通知する処理があることを確認。
- 一方、退会DB関数 `withdraw_user_account` は、演奏者退会・施設退会のどちらについても、未成立直接依頼の実際の徴収額を返金する処理や通知配列を生成する処理を持っていないことを確認。APIとDB関数の実装が一致していない。
- 退会時の未成立直接依頼返金について、演奏者退会では対象演奏者宛ての直接依頼を、施設退会では当該施設の案件に紐づく保留中直接依頼を対象にする必要がある。返金額は設定料金ではなく実際の徴収額を使用し、通常拒否処理などとの二重返金を防止する必要がある。
- `reject_direct_invitation_with_refund_for_withdrawal` の現行定義を確認。実際の徴収額に基づく返金と冪等性は備えているが、アプリケーション側からの呼び出しは確認できていない。
- DB関数のロック順序を横断確認。個別キャンセル・全体キャンセル・退会・演奏完了・コイン消費などでロック取得順序に差があることを確認。デッドロックの可能性はあるが、実際の発生は確認していない。
- イベント・レンタル案件の初回成立手数料について、同一案件IDに対する `event_match_fee:<request_id>` の冪等キーと、キャンセル時の初回手数料返金キーを確認。キャンセル・返金後に同じ案件が再成立しても初回成立手数料を再請求しない仕様と現行DB処理を確認した。実データを使った再成立テストは未実施。
- 今回の監査ではコード変更・DB関数変更・DBデータ変更・コイン残高調整・実際のキャンセル・退会処理は実施していない。
- キャンセル・退会・返金処理の監査は継続中。修正後にDB関数・API・LINE実機で再確認する。

### 2026-11-03

- 施設側の応募承認APIを確認し、イベント案件では定員に達するまで追加採用できるよう修正。
- 採用APIのUUID検証、環境変数確認、RPC結果の検証、エラー応答、キャッシュ防止を確認。
- 採用後のLINE通知結果に応じて画面の成功メッセージを切り替える処理を確認。
- 施設側応募一覧APIの認証と施設所有者確認を確認。
- 採用済み演奏者数について、個人応募は1人、バンド応募は所属メンバー数で集計するよう修正。
- 応募一覧画面の件数表示を「応募件数」「応募中」に変更。
- 上記のコード修正は保存済み。ビルド・LINE実機動作確認は未実施。

#### キャンセル処理・コイン返金の追加監査

- `cancel_match_with_direct_invite_refund` と `cancel_event_request_with_refund` の現行DB関数定義を確認。
- 両関数とも `SECURITY DEFINER`、`search_path=public` を確認。
- 両関数とも `anon` と `authenticated` の実行権限はなし、`service_role` のみ実行可能であることを確認。
- 個別キャンセル・全体キャンセルとも、実際の引き落とし額を参照して返金する構造と、冪等キーによる二重返金防止を確認。
- 全体キャンセル処理では、保留中の直接依頼が返金対象にならない可能性を確認。現在、該当する未返金データは0件。
- イベント・レンタル案件の全体キャンセル後、同一案件IDで再成立した場合、初回成立手数料が再請求されない可能性を確認。実データでは該当する取引がなく、仕様・再成立時の挙動は未確定。
- 個別キャンセルと全体キャンセルでロック順序が異なり、同時実行時にデッドロックが発生する可能性を確認。実際の発生は未確認。
- 全体キャンセル関数の `performance_status <> 'cancelled'` 条件について、NULLのマッチングが対象外になる可能性を確認。現在、該当するNULLデータは0件。
- 上記は現行コード上の要修正・要検証事項として保留。過去のテストデータや旧仕様による不整合とは区別する。
- DBデータの削除・更新、コイン残高調整、関数の修正は実施していない。
- 公開前のキャンセル処理監査は未完了。修正後にDB関数・API・LINE実機で再確認する。

### 2026-11-02

- チャットAPIの認証・マッチング参加者確認・バンドリーダー確認をレビュー。
- チャットAPIに最新100件・過去メッセージ取得のページネーションを実装・確認。
- 同一日時のメッセージを考慮したカーソル取得方式を確認。
- 過去メッセージの取得では既読状態を変更しないことを確認。
- チャットAPIのキャッシュ防止を確認。
- 演奏者側チャット画面に過去メッセージの追加取得、履歴統合、スクロール位置維持を実装。
- 施設側チャット画面にも同じページネーション機能を実装。
- 両画面の3秒ごとの新着取得で既存履歴を保持する処理を実装。
- チャットのアクセス権限がなくなった場合の画面表示・入力制御を実装。
- チャットAPIと両画面のページ取得方式の整合性をコード上で確認。
- 管理者異議申し立て更新APIの管理者認証、UUID・本文・操作内容の入力チェックを確認。
- manage_completion_dispute_caseの状態確認、マッチング行・案件行のロック、入力チェックを確認。
- manage_completion_dispute_caseの実行権限がservice_roleに限定されていることを確認。
- 管理者コイン付与APIとadmin_grant_coinsの管理者認証、入力値確認、原子性、冪等性を確認。
- 管理者お知らせAPIの管理者認証・入力チェック・公開状態制御を確認。
- 管理者コイン料金設定APIの管理者認証・数値入力チェック・キャッシュ防止を確認。
- 管理者コイン付与APIと管理者異議申し立て更新APIには、不正JSON・不正な本文形式への対応に追加確認・修正が必要な点を確認。
- 施設マッチング一覧APIのLINE IDトークン本人確認と施設ID取得処理を確認。
- 施設マッチング一覧画面のBearerトークン送信とキャッシュ防止を確認。
- 施設マッチング一覧APIについて、埋め込み先の施設IDフィルターだけでは親のmatches行を確実に限定できない可能性を確認。施設をまたいだ情報混入を防ぐ修正が必要と判断。
- 施設マッチング一覧APIの修正が完了するまで、この項目は未完了とする。
- 管理者コイン付与APIに不正JSON・不正な本文形式への対応を追加し、保存を確認。
- 管理者異議申し立て更新APIのエラー応答を整理し、不正JSON・不正な本文形式への対応を確認。
- 問い合わせAPIの本人確認、入力チェック、不正JSON対応、キャッシュ防止を確認・修正。
- レビュー投稿APIのコメント上限を1000文字に設定し、保存を確認。
- 施設側・演奏者側のレビュー画面に1000文字制限と文字数カウンターを追加し、両ファイルの保存を確認。
- 施設マッチング一覧APIを `performance_requests!inner` と施設IDフィルターで絞り込み、施設所有案件に紐づくマッチングだけを取得する形に修正。
- 施設マッチング一覧APIのno-storeヘッダー、エラー応答、認証処理を確認。
- 施設マッチング一覧画面のBearerトークン送信とno-store指定を再確認。
- 施設マッチング一覧の取得件数について、画面側で全件を対象に検索・絞り込み・並べ替えを行う現行仕様を維持するため、現時点では取得上限・分割取得を追加しない方針に決定。
- コイン残高APIにno-storeヘッダーとエラー情報を抑制したログ出力を追加し、保存を確認。
- コイン履歴APIにno-storeヘッダーとエラー情報を抑制したログ出力を追加し、保存を確認。
- コイン履歴APIの本人別取得と最新100件の取得制限を確認。

### 2026-11-01

- バンド関連API主要6ファイルの認証・アクセス制御を確認。
- バンド応募・応募承認のDBロック順序を統一。
- 応募承認時にバンド活動状態と現役リーダー資格を再確認する処理を確認。
- バンド招待承認・バンド解散時のバンド行ロックを確認。
- バンドコイン移動処理の所属・残高確認とDB一括処理を確認。
- バンド関連DB関数7件のSECURITY DEFINERと実行権限を確認。
- バンド応募APIをDB一括処理方式に変更。
- バンド応募時のコイン消費の二重実行対策を確認。
- バンド応募APIを修正し、実際にコインを消費した場合だけ施設へLINE通知を送るよう変更。
- バンド応募の再実行時にコインの二重消費と施設への重複通知を防止するコードを確認。
- バンド招待APIに未回答招待の重複登録を防ぐDB一意制約と、制約違反時の409応答を実装・確認。
- バンド招待の送信権限を「アクティブなリーダーのみ」に確定。
- バンド招待APIにリーダー権限チェック、UUID形式チェック、GETキャッシュ防止を追加・確認。
- コイン残高・履歴APIの本人確認を確認。
- コイン料金設定APIの公開範囲と管理者権限を確認。
- 管理者コイン付与APIとadmin_grant_coinsの原子性・二重実行対策を確認。
- 施設直接招待APIと直接招待料金処理を確認。
- 応募承認APIとaccept_application_with_coinsのロック・権限を確認。
- 演奏者側の直接招待承諾APIとaccept_direct_invitation_atomicのロック・権限を確認。
- 個人応募DB関数に応募期限チェック、レベル表記の正規化、メッセージ2000文字制限を追加・確認。
- 個人応募APIに案件IDのUUID形式チェックを追加。
- 個人応募APIにメッセージの型チェックと2000文字制限を追加。
- UUID_PATTERNをモジュールスコープに配置し、GET・POSTの両方から参照できることを確認。
- 個人応募APIの修正後レビューを完了。

## 12. 次に行う作業

### 最優先：統合ソース・DB契約の整合

1. 現行DBから`withdraw_user_account`、`reject_direct_invitation_with_refund_for_withdrawal`、`cancel_event_request_with_refund`および関連helperの完全な定義・signature・権限を取得し、退会APIの戻り値と照合する。
2. dual-roleユーザーの退会仕様、両プロフィール・案件・マッチング・バンド・レッスン・未成立直接依頼の処理順を確定する。
3. Stripe 005・008、退会006、全体キャンセル007の各候補について、現行DBの完全な関数定義・列・制約・owner・ACLを照合し、004新規基盤との適用分岐・順序・ロールバックを確定する。
4. Stripe Dashboardの購読イベント、注文状態、事故管理UI、利用規約・特商法表示、テストモード確認を完了するまでコイン購入を有効化しない。
5. レッスン停止状態をホーム・一覧・詳細・編集・新規・地図表示へ統一し、読み取りを残すかも含めて公開仕様を確定する。
6. 全体キャンセル通知対象をDB処理結果に一致させ、バンドメンバーへの通知を含める。
7. 既存の複数migrationと候補SQLを整理し、統合ソースと対応する最終SQLセットを確定する。

### 最優先：キャンセル・退会・返金処理

1. 個別キャンセル時に関連する採用済み応募を `rejected` に更新するDB修正を適用・確認する。同一演奏者は案件が `open` なら再応募可能。他の応募者も既存条件を満たせば応募可能。
2. 個別キャンセル・全体キャンセル・退会・演奏完了・コイン消費のDBロック取得順序を引き続き監査し、デッドロック対策を整理する。
3. 演奏者退会時に、その演奏者宛ての未成立ダイレクトオファーを実際の徴収額に基づいて返金するDB処理を整備する。
4. 施設退会時に、その施設の未成立ダイレクトオファーを実際の徴収額に基づいて返金するDB処理を整備する。
5. 退会DB関数が返金通知情報を返し、退会APIが受け取ってLINE通知する処理を整合させる。
6. 全体キャンセルAPIでDB関数の `pendingDirectInviteNotifications` を使用し、返金対象の演奏者へLINE通知する。
7. 個別キャンセルAPIの返金メッセージを、実際の返金額・返金内訳に基づく表示に改善する。
8. キャンセル・退会時の返金額、コイン履歴、残高、LINE通知内容の整合性を確認する。
9. 修正後にDB関数・APIの整合性と冪等性を再確認する。実際のキャンセル・退会テストは、テスト対象と実行条件を確認してから行う。

### その他の監査・動作確認

10. 今回修正した施設側応募一覧・採用処理のLINE実機動作確認を行う。
11. 管理者機能の最終動作確認を行う。
12. チャット機能のLINE実機動作確認を行う。
13. コイン履歴と残高の整合性を実データで確認する。
14. 演奏完了時の1%手数料の実徴収テストを行う。
15. 残存する全APIの認証方式を横断確認する。
16. x-line-user-idなどクライアント申告IDへの依存がないことを再確認する。
17. APIのUUID・文字数・数値など入力チェックを横断確認する。
18. APIレスポンスに不要な個人情報が含まれないことを確認する。
19. エラー処理・ログ出力に機密情報が含まれないことを確認する。
20. SECURITY DEFINER関数のsearch_path・実行権限を最終確認する。
21. service_roleキーがクライアント側に露出していないことを確認する。
22. Supabaseのデフォルト権限設定の制約を踏まえ、新規テーブル作成後の権限確認手順を確定する。
23. 本番環境の環境変数を最終確認し、不要な設定を整理する。
24. 不要なバックアップファイル・スクリプト・管理用コードを整理する。

### 最終リリース作業

25. 全API・DB関数・権限監査の完了を確認する。
26. npm run build を実行する。
27. Git差分を最終確認する。
28. commit・pushを行う。
29. Vercel本番デプロイを行う。
30. 本番URL・LINE実機で演奏者側と施設側の主要操作を確認する。
31. 応募・承認・マッチング・直接招待・バンド・レッスン・チャットの実動作を確認する。
32. コイン残高・履歴・コイン付与・演奏完了時の1%手数料を確認する。
33. 問い合わせ・お知らせ機能を確認する。
34. 公開前の最終バックアップを取得する。
35. 最終的な公開判断を行う。

※ 現時点では監査継続中。今回の応募一覧・採用処理の変更を含め、ビルド・commit・push・本番デプロイはまだ実施していない。

### 2026-11-12（限定公開向け・第1修正バッチ準備）

- 基準ソースを `Hakotohito_Stripe決済基盤_20261112.zip` に固定。古いGitHub branchは今回の編集基準に使用しない。
- 現行DBの `cancel_match_with_direct_invite_refund` を確認し、個別キャンセル時に採用済み応募を `rejected` に戻す処理が不足していることを確認。
- 個別キャンセルRPCの修正候補に、ロック取得後の `completion_disputed_at` 再確認を追加。紛争中のキャンセルをDB側でも拒否する。
- 個別キャンセルAPIに `account_status = active` と `completed_at` の事前確認を追加。最終判定はDB RPC側で行う。
- 施設応募採用APIにも `account_status = active` の確認を追加。採用・コイン処理の本体 `accept_application_with_coins` は今回変更しない。
- 既存の `20261112_001_known_audit_fixes.sql` に含まれていた退会RPC候補は、`user_type` による片側プロフィール処理、ロック順序の未解決、手数料履歴がない未承認依頼の扱いが未解決のため、今回のmigrationから分離。未適用のまま保留。
- 退会時の両プロフィール処理、直接依頼の実額返金、返金通知、ロック順序統一は未完了。退会RPCの修正・適用前確認が必要。
- イベント・レンタル初回料金 `event_match_fee:<request_id>` のonce仕様は変更していない。
- 全体キャンセルAPIの通知対象をDBが実際にキャンセルした参加者に厳密に一致させる修正は未完了。バンド参加者通知も追加確認対象。
- SQL適用前の読み取り専用preflightと、取得済み関数定義を用いるrollback手順メモを追加。
- 本作業ではSupabaseへのSQL適用、Git操作、Vercel操作、build／lint／test／ローカルチェックを実施していない。

#### 限定公開ゲート

- 個別キャンセル：修正案作成済み。DB適用・適用後確認は未実施。
- 退会・返金：未完了。公開前に別バッチで修正する。
- 全体キャンセル通知：未完了。
- Stripe決済・コイン購入：引き続き無効化を維持し、今回の修正対象外。


## 2026-11-12 Stripeコイン購入専用ソース修正（未検証・未適用）

- [x] 購入APIをコイン購入専用設定に変更（Connectフラグ参照を除外）
- [x] 購入要求IDとStripe注文IDに基づく再送安定化を実装
- [x] 購入条件同意のサーバー検証と注文metadata記録を追加
- [x] Webhookのpayment_type既定値を廃止し、coin_purchase以外の処理を遮断
- [x] Connect onboarding APIをサーバー側で403拒否
- [x] 管理者API・画面をコイン購入設定だけに限定
- [x] 購入状態確認APIを追加し、完了画面を注文status基準に変更
- [x] 追加migration `20261112_003_stripe_coin_purchase_hardening.sql` を作成（未適用）
- [ ] ライブDBの既存migration・制約・関数署名との照合
- [ ] Stripeテストモードで購入・再送・失敗・Webhook順序を検証
- [ ] 利用規約・特商法表示ページの実在URL確定と法的レビュー
- [ ] build／lint／test／ローカルチェックは未実施（ユーザー指示により実施しない）
- [ ] GitHub・Supabase・Vercelへの反映は未実施

**注意：この修正パッケージは未検証のソース案であり、本番適用不可。** DB migrationの適用前に既存DBの状態確認が必要。


### Stripeコイン購入専用・第2ソース修正バッチ（2026-11-13）

- [x] Checkout完了イベントの `unpaid` を決済待ちとして処理し、注文をpending維持（非同期決済成功イベント待ち）。
- [x] 非同期決済成功イベントは `payment_status=paid` とPayment Intent IDを確認してから付与。
- [x] コイン購入以外のCheckoutイベントは注文・残高を変更せず `ignored` として正常応答。
- [x] その他のStripeイベントも本限定公開版では実行せず `ignored` として記録（第2バッチ時点）。
- [ ] Stripeテストモードで同期決済・非同期決済・未払い・期限切れ・対象外イベント・Webhook再送を検証。
- ※ 返金・紛争イベントは第3バッチで専用事故記録処理を追加し、第2バッチ時点の「ignored」方針を更新。
- [ ] ライブDBとのmigration／関数／制約照合。
- [ ] 返金・チャージバック・不正利用の専用事故記録フロー。
- [ ] 正式な利用規約・特商法表示・法的レビュー。
- [ ] 退会と決済中／決済済み注文の競合ポリシー確定。

※ build／lint／test／ローカルチェックはユーザー指示により未実施。SQL適用、GitHub Push、Vercel Deployも未実施。


### Stripeコイン購入専用・第3ソース／DB整合修正バッチ（2026-11-13）

- [x] `paid_review` の購入状態を完了画面で明示し、重複購入せず管理者確認を待つ案内を追加。
- [x] Stripe返金イベント（`charge.refunded`、`refund.created`、`refund.updated`、`refund.failed`）をコイン購入注文に紐付けて記録するWebhook処理を追加。
- [x] Stripe紛争イベント（`charge.dispute.created`、`updated`、`closed`、`funds_withdrawn`、`funds_reinstated`）をコイン購入注文に紐付けて記録するWebhook処理を追加。
- [x] Payment Intentのmetadataから注文を特定できるようにし、Checkout完了イベントより先に返金・紛争イベントが届いた場合も事故記録を残す設計に変更。
- [x] 返金・紛争記録がコイン付与より先に存在する場合、購入RPCは自動付与せず `paid_review` に保留する設計に変更。
- [x] 既に付与済みのコインを返金・紛争イベントだけで自動減算しない。事故記録と管理者判断に分離。
- [x] 管理者用の決済事故一覧API・対応更新APIを追加し、管理者認証とDB側の対応履歴RPCを使用。
- [x] 管理者「決済設定」画面に返金・紛争・要確認一覧、対応状況フィルター、対応履歴、確認中／対応済み／対象外の記録操作を追加。
- [x] 統合DB migration 004に決済事故対応履歴テーブルと管理者対応RPCを追加し、上記Webhook・管理画面のDB契約に合わせて更新。
- [ ] Stripe Dashboardで上記Webhookイベントを購読設定し、実際のイベントpayload・部分返金・複数返金・紛争更新をテストモードで検証。
- [ ] Stripeテストモードで同期決済・非同期決済・未払い・期限切れ・Webhook再送・返金／紛争イベント順序を検証。
- [ ] 管理者画面でインシデントの一覧・対応履歴・状態更新を実機確認。
- [ ] migration 004の適用前に既存DB状態を差分確認し、適用後にRPC・権限・制約を確認。
- [ ] 正式な利用規約・特商法表示ページのURL確定と法的レビュー。
- [ ] 返金・チャージバック後のコイン残高調整は自動化しない。個別判断・管理者記録・必要な法令／Stripe対応を確認してから実施。

※ 第3バッチはソース／SQL成果物の編集であり、ビルド・Lint・テスト・ローカルチェックは未実施。Supabase適用、GitHub Push、Vercel Deployも未実施。


## 2026-11-14 追加監査メモ（統合候補SQLの静的レビュー）

- 退会SQL 006：参加者通知サブクエリの重複 `FROM unnest` を修正。関数終端セミコロン欠落も修正。
- Stripe残高上限SQL 008：関数終端セミコロン欠落を修正。
- SQL構文の実行検証は未実施。ローカルチェックは実施しない方針を維持。
- 退会関数のロック順序は未解決。ユーザー行ロック後に既存RPC/helperへ入るため、案件・施設ユーザー・応募ロックとの逆順競合を確認してから適用判断する。
- Webhook 5分leaseは処理が長引いた場合に再claimされ得る。processing tokenのfencingに加え、Stripe購入RPC・事故upsertの冪等性と並列処理を確認する。
- Supabase適用、GitHub Push、Vercelデプロイ、本番データ変更はいずれも未実施。

- 追加修正：全体キャンセルSQL 007の通知先取得で重複していた `INTO` を修正。SQL実行検証は未実施。

### 2026-11-14 追加監査：ロック順序・通知outbox・Webhook lease

- [ ] 退会SQL 006は未適用。現行返金helperが「案件→施設ユーザー残高→application→返金advisory key」の順でロックする一方、退会候補はユーザー行を先にロックするため、施設退会と全体キャンセル等の並行処理でロック循環が発生し得ることを確認。共通ロック順序の再設計が必要。
- [ ] 退会時の直接依頼返金は、helper実行前に返金履歴の有無を別SELECTして通知要否を決めている。並行返金がその間に完了すると、二重返金は防げても重複通知の可能性がある。helper戻り値に今回返金フラグを持たせるか、通知outboxを追加する。
- [ ] 退会API・全体キャンセルAPIとも、DB処理後のLINE Push失敗を永続化・再送するoutboxがない。通知のexactly-onceではなく、DB一意イベントIDによるat-least-once再送と重複排除を設計する。
- [ ] 全体キャンセルはDB返却の `cancelledMatchIds` とAPIの対象取得契約が一致することを確認。ただし送信失敗時の通知再送は未解決。
- [ ] Stripe webhook 005のprocessing tokenは最終状態更新をfenceするが、5分lease後に旧実行が副作用を継続する可能性がある。heartbeat／期限管理と業務副作用側のfencing・冪等性を統合設計するまで適用しない。
- [ ] Stripe返金・紛争incidentのupsertとPayment Intent紐付けを、同一注文行ロックを伴うDB側原子処理に統一する。
- これらは静的な関数・API契約レビューであり、SQL実行やローカルチェックは実施していない。


### 2026-11-14 追加監査：ロック循環・証拠ファイル照合

- [ ] 006候補は退会側がmatch行を事前ロックしてから、案件行→施設ユーザー→match行の順でロックする既存キャンセルRPCを呼ぶため、通常キャンセルとの間で「退会：match→request」「通常キャンセル：request→match」のデッドロック循環が成立し得る。ロック設計を変更するまで適用不可。
- [ ] 退会処理のusers行ロックと通常キャンセル・採用処理のロック順序を含め、共通順序を再設計する。users行のロックを単純に外すだけでは退会競合を防げない。
- [ ] 証拠ファイル `reject_direct_invitation_with_refund_for_withdrawal.sql` と `manage_stripe_payment_incident_20261114.sql` はファイル名と異なり `accept_application_with_coins` の定義を含む。退会helperは `schema(2).sql` から確認できたが、管理者incident RPCの完全な定義は証拠セットにないため再オープン動作は未確認。
- [ ] Stripe 008のincident upsertは解決状態をリセットしない。ただし通常の `paid_review` 再実行は早期returnするため、通常経路での再オープン問題とは断定せず、手動状態変更等の例外運用時の整合性確認事項とする。
- SQL実行・ローカルチェックは未実施。

## 2026-11-14 追加監査：共通ロック順序・通知outbox設計

- [ ] 全mutation RPCにrequest単位advisory gateを導入し、複数requestではUUID昇順で取得する設計を確定
- [ ] request → band → match → application → idempotency key → userの共通ロック順を全関数で照合
- [ ] 退会関数のuser/profile先行ロックとmatch先行FOR UPDATEを廃止し、全request gate取得後に対象を再検証する構造へ変更
- [ ] 返金helperが今回新規返金したかを戻り値で返し、返金履歴の事前SELECTによる通知判定を廃止
- [ ] 返金・キャンセルと通知outbox作成を同一DBトランザクションに統合
- [ ] LINE通知outbox workerのclaim・再送・attempt記録・個人情報保持・重複送信方針を確定
- [ ] Stripe Webhookのclaim tokenを業務RPCに渡し、order／incidentの副作用直前にfencing検証
- [ ] `spend_coins_legacy`、全mutation RPCの完全定義、function owner／ACL／default ACLの証拠を追加取得
- [ ] Stripe incident管理RPCの正しい完全定義を取得（現行証拠ファイル名と内容が不一致）

**判定：** 006退会SQL、007全体キャンセルSQL、005 Stripe webhook claim SQLは、共通ロック順序・通知再送・fencingの統合設計が完了するまで適用不可。今回の設計文書は候補設計であり、DB適用・GitHub Push・Vercel Deployを許可するものではない。

- [ ] `complete_match_with_fee`のmatch→requestロック順を修正し、個別／全体キャンセルのrequest→match順との循環を解消
- [ ] `register_completion_dispute`・`agree_completion_dispute`・`manage_completion_dispute_case`もrequest gateへ参加させ、match更新系RPCの並行実行を統一

### 2026-11-14 追加：mutation RPCロック順序棚卸し

- [ ] `schema(2).sql`内の応募・採用・直接招待・拒否返金・個別／全体キャンセル・完了・異議申立て・レビュー報酬・退会RPCを棚卸しし、全てrequest gate参加候補として整理
- [ ] `apply_to_performance_request_as_band`がuser行をロックした後に`spend_coins`の冪等advisory keyを取得する逆順を修正
- [ ] `reject_direct_invitation_with_refund`／退会helperのuser→application→refund key順を標準順へ変更
- [ ] `cancel_match_with_direct_invite_refund`／`cancel_event_request_with_refund_internal`のuser先行ロックをmatch/application/返金keyの後へ変更
- [ ] `submit_personal_application_idempotent`／`submit_band_application_idempotent`のoperation advisory lockとrequest gate取得順を統一
- [ ] `spend_coins`のrequest gate責務を呼出元・RPC間で一意に定義し、行ロック後のgate後取りを禁止
- [ ] band招待・解散・コイン移動とrequest応募・退会のband行ロック順を追加照合
- [ ] レッスンoffer・application・reserved_coins系の独立ロック順序を別途棚卸し
- [ ] DBエクスポート外のmutation RPC、直接テーブル更新、trigger、管理者操作、service_role直接SQLがgateを迂回しないことを確認

**判定：** 共通ロック設計は引き続き設計段階。関数の先頭にgateを追加するだけでは不十分で、現行関数内にuser／application／idempotency keyの逆順が残る。006・007・005は引き続き未適用・適用不可。

### 2026-11-14 追加監査：バンド・レッスン・コイン移動の横断ロック

- [ ] `respond_to_band_invitation`のuser→bandロックと、バンド応募・送金のband→userロックの逆転を解消
- [ ] `transfer_band_coins`のband→usersロックと退会処理のuser→band更新が循環しないよう統一
- [ ] `apply_to_lesson_offer`／`update_lesson_offer_with_levels`のoffer→teacher userロックと、退会処理のuser→offer更新の逆転を解消
- [ ] `withdraw_user_account`のrequest・band・lesson offerを横断する対象aggregate gateを、ID収集・固定順取得・取得後再検証の構造に再設計
- [ ] `apply_to_performance_request_as_band`のuser先行ロックと`spend_coins`のidempotency advisory lock順を統一
- [ ] request単独gate案を最終設計とせず、request／band／lesson offer／payment order等の複数domain gateと、冪等keyを含む全ロック階層を再確定
- [ ] 全mutation RPC・trigger・API直接更新・service_role経路を網羅するまで共通ロックmigrationを作らない

**判定：** request gateだけではデッドロックを解消できない。退会を含む複数ドメイン操作のgate取得と行ロック順を再設計する。006／007／005は引き続き未適用・適用不可。SQL実行・ローカルチェック・build／lint／test・リモート変更は未実施。

### 2026-11-14 追加監査：API直接DB更新経路

- [ ] 施設側／演奏者側の完了報告APIによる`matches`直接UPDATEを、共通request gateを取得するDB RPCへ移行
- [ ] 案件編集／削除APIの直接UPDATE/DELETEをgate付きRPCへ移行し、削除前履歴検査とDELETEを同一transaction化
- [ ] Stripe WebhookのPayment Intent紐付け・注文状態更新・incident upsertを、processing token fencingとorder lockを伴う単一DB業務RPCへ統合
- [ ] Stripe Checkout開始APIのpayment_orders INSERT/UPDATEを状態条件付きRPC/CASへ集約（外部Stripe API呼出しをDB transaction内に含めない）
- [ ] performer/facility profile APIのusers/profile別更新を原子RPC化し、退会済み状態の再検証と部分更新を防止
- [ ] band invitation INSERT、chat/messages、favorites、admin settings等の直接書込を別ドメインごとに認可・退会・状態遷移と照合
- [ ] API以外のEdge Function、service_role直接SQL、管理スクリプト、外部ジョブの全書込経路を追加取得し、RPC/gate迂回がないことを確認

**判定：** 完了報告・案件編集／削除・Stripe WebhookのAPI直接更新が共通ロック／fencingを迂回するため、共通設計の対象はDB RPCだけでなくAPI直接書込も含める。引き続きSQL実行・ローカルチェック・Supabase適用・GitHub Push・Vercel Deployは未実施。


## 2026-11-14 追加監査メモ（Trigger・Cron・外部実行経路）

- [x] 提供DBダンプ内のtrigger定義を確認（2件）。matchキャンセル拒否guardと初回コイン付与／LINE登録履歴更新のみ。
- [x] Vercel Cronを確認（`/api/cron/auto-complete` 毎日1回）。状態更新は `complete_match_with_fee` RPC経由。RPC側の共通lock order修正は未完了。
- [ ] Supabase Edge Functions一覧・実装の有無を確認（提出ZIPに`supabase/functions/`は含まれないため未確認）。
- [ ] 対象DBの`pg_cron.job`、trigger catalog、全routine定義を読み取り専用で取得。
- [ ] 外部scheduler／service_role直SQL／運用スクリプトの有無を確認。
- [ ] 完了報告APIをgate参加RPCへ統合。
- [ ] Stripe Webhookの注文・事故record副作用をclaim tokenでfenceするDB RPCへ統合。
- [ ] Stripe Checkout開始・注文状態更新を状態条件付きRPC/CASへ統合。

※ 今回の静的照合でtrigger 2件とVercel Cron 1件を確認したが、Edge Functions・pg_cron・外部schedulerは未確認。全経路網羅済みとは判定しない。SQL実行、build／lint／test／ローカルチェック、Supabase適用、GitHub Push、Vercel Deployは未実施。

### 2026-11-14 追加監査：未取得証拠の読み取り専用収集パッケージ

- [ ] テスト環境（東京）でQ0を実行し、対象DB・role・取得時刻を確認
- [ ] `docs/audit_evidence/20261114_readonly_execution_path_evidence.sql` のQ1〜Q10を個別実行し、結果を保存
- [ ] Q5/Q6のpg_cron結果またはエラー全文を保存（エラーだけで不存在と断定しない）
- [ ] Supabase DashboardからEdge Functions一覧と全ソースを取得
- [ ] Vercel Project SettingsからCron Jobs一覧を取得
- [ ] GitHub Actions等、外部scheduler・運用スクリプトの書き込み経路を一覧化
- [ ] 関数定義・cron command・ログに含まれるsecret/token/個人情報を伏せてから共有
- [ ] 追加証拠をソース・RPC・API直接更新一覧と突合し、gate/fencingを迂回する書込経路を確定

**注意：** 上記SQLはSELECTのみで、SQL実行自体もまだ行っていない。Edge Functions・pg_cron・外部schedulerの有無は未確認のまま。production（Mumbai）への接続・変更は対象外。全実行経路の網羅完了とは判定しない。


### 2026-11-14 仕様記述の訂正・統合候補の再照合

- 2026-11-14候補資料の「同一演奏者／同一バンドの再応募不可」はユーザーによる仕様変更確認が取れていないため、確定仕様として扱わない。ユーザーが事前に確定した「個別キャンセル後はapplicationをrejectedにし、同一演奏者は案件がopenなら再応募可能」を維持する。
- 現行仕様：個別キャンセル時は関連applicationを `rejected` にし、同一演奏者はrequestが `open` なら再応募可能。他の応募者も既存条件を満たせば応募可能。Tokyoのバンド応募関数もrejected応募行を再利用するが、バンド応募の業務仕様は独立確認待ち。request全体のキャンセルは `closed` とし、再募集は新しいrequest IDで行う。
- `20261112_001_known_audit_fixes.sql` には個別キャンセル時に関連applicationを `rejected` へ更新する候補処理が含まれる。ただし対象DBへの適用履歴・現行関数との差分は未確認のため、適用済みとは扱わない。
- 旧履歴に記載された退会APIのパス `src/app/api/withdraw/route.ts` は誤記。現行ソースの対象は `src/app/api/account/withdraw/route.ts`。
- 統合候補ZIPは基準ソース165ファイルを欠落なく含み、変更済みファイル12件・追加ファイル17件を確認。候補ソースとSQLは作業用コピーに集約済みだが、以下の理由で公開・DB適用可能な最終版とは判定しない。
- 公開阻害：全mutation RPC／API直接更新／band・lesson・payment orderの横断ロック順序が未統一。006退会候補にはmatch→requestのロック循環が残る。単一request gate追加だけではband／lesson／coin／withdrawalの逆順を解消できない。
- 公開阻害：退会・全体キャンセルのLINE通知はDB transaction内のoutboxではなく、RPC応答後の一時データをAPIが送信する。送信失敗時の永続再送がなく、並行返金時の重複通知競合も残る。
- 公開阻害：Stripe 005のprocessing tokenはWebhookイベント行の状態更新をfenceするが、注文・Payment Intent紐付け・incident upsert等の業務副作用を同じtokenでfenceしない。5分lease期限後の旧workerと新workerの副作用競合が残る。
- DB適用不可：004は新規Stripe基盤用であり、Stripeテーブルが既に存在する対象DBへ再適用しない。005／006／007／008も現行DBの完全な定義・owner・ACL・制約・migration履歴との最終照合前は適用しない。
- 実機・外部確認未完了：Edge Functions／pg_cron／外部schedulerの有無、Stripe test mode、LINE実機、1%完了手数料実徴収、残高履歴照合、管理者最終確認、法的表示の確認が残る。
- build／lint／typecheck／test／ローカルチェック、SQL実行、DB変更、Git操作、Push、Deployは未実施。

### 2026-11-14 追加静的監査追補（005〜007）

- [x] 005候補の危険なCHECK制約一括DROPを撤去。既存CHECKが`processing_status`を参照する場合、未知statusがある場合はpreflightで停止するfail-closed方式へ変更（既存制約の個別置換はDB定義取得後に別途設計）。
- [x] 006／007候補のSECURITY DEFINER関数search_pathを`pg_catalog, public, pg_temp`へ変更。非修飾参照・function owner・EXECUTE ACL・public schema CREATE権限の対象DB照合は未完了（現時点で悪用可能性を断定しない）。
- [ ] request単独gateを最終設計にしない。account／request／band／lesson offer／payment order等のaggregate gateと、行ロック階層を全mutation RPC・API直接更新・trigger・Edge Function・Cron・外部scheduler・service_role経路で一括確定する。
- [ ] 読み取り専用実行経路証拠SQLは東京のテスト環境でQ0から取得。Q4 routine定義・Q5 cron commandはsecret/tokenを伏せて共有し、取得権限エラーを不存在の証拠と扱わない。
- 詳細は`20261114_FOLLOWUP_STATIC_AUDIT.md`。

**判定継続：BLOCKED。005／006／007／008は未適用。SQL実行・DB変更・Git操作・Deploy・build／lint／test／typecheck・ローカルチェックは未実施。**


### 2026-11-14 追加：監査追補に基づく候補SQLの安全側修正

- [x] 005候補から`processing_status`を含むCHECK制約の一括DROP処理を削除。既存CHECKが該当列を参照する場合はpreflightで停止し、複合条件を誤って失わないようfail-closed化。
- [x] 005候補に既存`processing_status`値の許容集合チェックを追加。未知値／NULLがあれば制約追加前に停止。
- [x] 006 `withdraw_user_account(text)` と007 `cancel_event_request_with_refund_internal(uuid,uuid,boolean)` のSECURITY DEFINER search_pathを`pg_catalog, public, pg_temp`へ統一。
- [ ] 005の既存CHECK制約がある対象DB向けのlossless置換SQLは未作成。現行制約定義・status実データを取得してから個別設計する。

**注意：** 上記は作業用候補ファイルへの反映のみ。PostgreSQL実行検証・Supabase適用は未実施。006／007のロック循環・通知outbox不足、005の業務副作用fencing不足は未解消のため、公開／適用判定は引き続きBLOCKED。

## 2026-11-14 統合修正台帳の追加

- [x] 既存監査所見・適用阻害条件・統合実装の依存関係を `20261114_REMEDIATION_IMPLEMENTATION_LEDGER.md` に集約。以後はこの台帳を正本として、既知事項の再監査を避け、新しい証拠・変更差分のみ追跡する。
- [x] 005の既存CHECK一括削除を禁止するfail-closed preflightを候補へ反映。
- [x] 006／007 SECURITY DEFINER候補のsearch_pathを `pg_catalog, public, pg_temp` へ変更。
- [ ] aggregate gateのドメイン順位・行ロック階層・冪等key取得順を全書込経路で確定。
- [ ] 退会／キャンセル／完了／返金と通知Outboxを同一transactionに統合し、再送workerを実装。
- [ ] Stripe claim tokenをorder／incident／ledgerの業務副作用までfenceするDB RPCへ統合。
- [ ] 完了報告・案件編集／削除・Stripe Webhook等のAPI直接更新をRPC/CASへ移行。
- [ ] DB routine／owner／ACL／trigger／pg_cron／Edge Function／外部schedulerの対象環境証拠を取得。

**判定：BLOCKED。** 台帳・候補ソース・SQL・文書のみ更新。Supabase適用、実リポジトリ変更、GitHub Push、Vercel Deploy、build／lint／test／typecheck、ローカルチェックは未実施。

## 2026-11-15 最新パッケージ追加監査・修正

- [x] 2026-11-14統合候補パッケージを基準に、Tokyo DB 2026-11-15 10:00 JSTの読み取り専用証拠を照合。
- [x] お気に入り登録エラーの原因を特定：`/api/performers` が`user_id`を除外し、施設側画面が`performer.user_id`を送っていた。施設ユーザーに限り`user_id`を返す修正を作業用ソースへ反映。
- [ ] お気に入り登録・解除をLINE実機で再確認（修正パッケージ反映後）。
- [x] 個別キャンセル後の再応募仕様を訂正：applicationを`rejected`へ戻し、同一演奏者はrequestが`open`なら再応募可能。候補資料の「再応募不可」はユーザー確認済みの仕様変更ではないため採用しない。
- [x] Tokyo DBの`apply_to_performance_request`が`rejected`応募を再利用して再応募可能にすることを確認。
- [ ] Tokyo DBの現行`cancel_match_with_direct_invite_refund`へ、対象applicationを`rejected`に戻す差分を安全に統合（ロック順序統一と同時に実施し、単独適用しない）。
- [x] Tokyo DBのroutine 37件・trigger 2件・default privileges 24項目・Stripe constraints 24項目を取得済み証拠で確認。
- [ ] `cron.job`未検出の範囲を確認し、Edge Functions・外部schedulerの実行経路証拠を追加取得。
- [ ] matching core全書込経路の共通ロック契約、通知Outbox、API直接更新RPC化を完成。
- [ ] Stripe購入は無効状態を維持。005〜008は現行DB差分・fencing・ロック・Outboxが解決するまで適用しない。

**状態：** お気に入りID不整合は作業用ソース修正済み・未実機確認。DB／実リポジトリ／GitHub／Vercelは未変更。公開判定はBLOCKED。

### 2026-11-15 matching core次段階監査

- [x] 公開対象をmatching coreへ限定し、Lesson停止・Stripeコイン購入停止を維持する方針を明文化。
- [x] 完了報告API（施設／演奏者）の`matches`直接UPDATEをP0のRPC統合対象として固定。
- [x] 募集編集／削除APIの直接UPDATE/DELETEと、削除前履歴検査が別要求である点をP0対象として固定。
- [x] 個別キャンセル時のapplication `rejected`、同一requestがopenの場合の再応募可、イベント／レンタル初回料金onceを一括修正条件として固定。
- [x] 退会・band・lesson offerを横断する逆順ロックを確認済み所見として統合し、request単独gateの部分導入を禁止。
- [x] 退会／キャンセル／完了／返金のOutbox transaction統合と再送workerをP0の一括修正条件として固定。
- [ ] aggregate gate・行ロック・idempotency/refund keyの全体順位を全mutation経路で確定。
- [ ] 完了報告／募集編集・削除／応募・採用／キャンセル／完了／退会のDB RPCを一括実装し、API直接更新を撤去。
- [ ] application rejected遷移・once料金・返金・Outboxを同じtransactionに統合。
- [ ] Tokyo現行DB差分に基づくmigration preflight／postflight／rollbackを作成。
- [ ] テストDBで同時実行・再試行・通知Outboxの検証を実施。

**判定：** 今回はAPI直接書込のP0範囲と一括修正条件を固定。既知の逆順ロックを残したまま部分gate／単独キャンセルSQLを適用することは安全でないため、matching coreのDB変更は一括切替方式とする。実DB・実リポジトリ・GitHub・Vercelは未変更。SQL実行・ローカルチェック・build／lint／test／typecheck・Push・Deployは未実施。公開判定はBLOCKED。

### 2026-11-16 matching core候補実装の追加反映

- [x] 個人・バンド応募、直接依頼の作成時課金を外し、残高確認のみへ変更するSQL候補を作成。
- [x] 応募試行単位の7日期限、採用時の期限再確認、期限切れ応募のrejected遷移をSQL候補へ反映。
- [x] 応募料・直接依頼料・通常成立料をマッチング成立時に原子的に徴収するSQL候補を作成。イベント／レンタル初回成立料のrequest単位onceキーは維持。
- [x] 個別キャンセル後にapplicationをrejectedへ戻し、対応するapplication_attemptをcancelledへ遷移する候補を反映。
- [x] 新方式で未成立の直接依頼を辞退・退会する場合は返金せず却下し、旧方式の実徴収履歴に対する返金経路を維持。
- [x] コイン不足時の開始者向け表示を「コイン不足のためマッチングできません」に統一し、支払者不足の種類に応じて相手側LINE通知先を切り替えるソース候補を反映。
- [x] 直接依頼の送信画面に「成立時徴収・送信時残高確認のみ」を明示し、未徴収の辞退で返金済みと誤表示しないよう変更。
- [ ] SQL候補009〜013の適用前レビュー、PostgreSQL構文・依存順・preflight/postflightの最終確認。
- [ ] 共通gateで直列化されるstatement単位と、API複数要求をまたぐ非原子的な業務フローの残存箇所をRPC化。
- [x] 退会・キャンセル・辞退・完了・応募・バンド招待・レッスン通知のtransactional Outbox化と再送worker実装（migration014〜023候補。未適用）。
- [ ] LINE実機でコイン不足通知先・表示、直接依頼辞退、期限切れ、個別キャンセル後の再応募を確認。

**状態：** 上記は作業用src／SQL候補のみ。Tokyo Supabase未適用、実リポジトリ・GitHub・Vercel未変更。build／lint／test／typecheck／ローカルチェックは実施していない。公開判定は引き続きBLOCKED。


## 2026-11-16 matching core follow-up
- 009のgate導入時にpublicテーブルのcutover barrierを追加。010〜013も共通advisory lockで移行処理を直列化（未適用候補）。


### 2026-11-16 transactional LINE Outbox追加候補（未適用）
- [x] 個人応募・施設直接依頼の通知を`application_attempts` INSERTトリガーで同一DB transaction内にOutbox登録するmigration015候補を作成。
- [x] 個人応募API・施設直接依頼APIの直接LINE Pushを撤去し、共通Outbox workerのdrainへ変更。
- [ ] 通知内容・二重送信防止・再試行をLINE実機で確認。
- [x] キャンセル・退会・辞退・完了・バンド招待・レッスン通知の直接送信をOutboxへ移行（migration017〜023候補。未適用）。

**状態：** migration015およびAPI変更は作業用コピーのみ。後続のmigration016〜023で残りの主要通知経路もOutboxへ移行済み。SQL未適用、ローカルチェック未実施。公開判定BLOCKED。

### 2026-11-16 レッスン通知Outbox追加候補（未適用）
- [x] レッスン応募成立通知を`lesson_applications` INSERTトリガーでOutbox登録するmigration016候補を作成。
- [x] レッスン募集内容更新通知を`lesson_offers` UPDATEトリガーでmatched参加者向けにOutbox登録する候補を作成。
- [x] レッスン応募API・募集更新APIの直接LINE Pushを撤去し、共通Outbox workerへ変更。
- [ ] LINE実機でレッスン応募・募集更新通知の内容と再送を確認。

**状態：** migration016およびAPI変更は作業用コピーのみ。SQL未適用、ローカルチェック未実施。公開判定BLOCKED。

### 2026-11-16 バンド応募通知Outbox追加候補（未適用）
- [x] migration015の応募試行トリガーをband_applyにも適用し、施設へバンド名を含む通知を登録。
- [x] バンド応募APIの直接LINE Pushを撤去し、共通Outbox workerへ変更。
- [x] バンド招待の作成・回答通知をtransactional Outboxへ移行（migration022候補。未適用）。

**状態：** 作業用コピーのみ。SQL未適用、ローカルチェック未実施。公開判定BLOCKED。


## 2026-11-16 追加候補：マッチングキャンセル通知Outbox

- `supabase/migrations/20261116_017_match_cancellation_notification_outbox.sql` を新規作成。既存の`cancel_match_with_direct_invite_refund(uuid,uuid)`の署名・定義を変更せず、actor IDとactor roleを検証するwrapper RPCを追加。既存キャンセル・返金RPCの成功と同じDB transaction内で相手側の通知をOutbox登録する。
- 施設側・演奏者側のマッチングキャンセルAPIをwrapper RPC呼び出しへ変更し、直接LINE Pushを撤去。送信は共通Outbox workerへ移行。
- バンドマッチングは現役リーダーをactorとして許可し、参加演奏者側へ通知する。施設キャンセルは参加演奏者（個人／バンド）へ、演奏者キャンセルは施設へ通知する。
- 通知形式はテキストに統一。旧Flexカードのリンク・表示体験は変更されるためLINE実機確認が必要。
- migration017は014・013および既存テーブル構成に依存。SQL未適用。ローカルチェック未実施。

## 2026-11-16 追加候補：マッチング完了通知Outbox

- `supabase/migrations/20261116_018_match_completion_notification_outbox.sql` を新規作成。`matches.completed_at`がNULLから確定日時へ変化したtransaction内で、施設・参加演奏者双方へ完了通知をOutbox登録する。
- 施設側・演奏者側の完了APIから最終完了通知の直接Pushを除去し、完了RPC後に共通Outbox workerをdrainする。片側のみの完了報告時に送る確認依頼通知は現行経路のまま残す。
- 完了通知は両当事者へ送るテキスト形式。既存Flexカードとは文面・リンク体験が異なるためLINE実機確認が必要。
- migration018は014と既存matches構成に依存。SQL未適用。ローカルチェック未実施。


## 2026-11-16 追加候補：直接依頼辞退通知Outbox

- `supabase/migrations/20261116_019_direct_invitation_rejection_notification_outbox.sql` を追加。演奏者本人のuser IDを検証する辞退wrapper RPCを追加し、既存の辞退・返金RPC成功と同じtransaction内で施設向け通知をOutbox登録する。旧方式の直接依頼手数料返金履歴がある場合と、新方式で成立前徴収がない場合の案内を分ける。退会内部処理から誤って退会者本人へ通知しないよう、汎用applications triggerは使用しない。
- `src/app/api/performer/invitations/[id]/reject/route.ts` の直接LINE Pushを撤去し、辞退・返金RPC後に共通Outbox workerをdrainする形へ変更。
- 通知形式はテキスト。SQL未適用。ローカルチェック未実施。

## 2026-11-16 追加候補：イベント全体キャンセル通知Outbox

- `supabase/migrations/20261116_020_event_cancellation_notification_outbox.sql` を追加。施設所有者をDB側で検証するwrapper RPCを設け、既存のイベント全体キャンセル・返金RPC成功後、同じtransaction内でキャンセル済みマッチングの演奏者／バンド参加者と未承認直接依頼の演奏者へOutbox登録する。
- `src/app/api/facility/requests/[id]/cancel/route.ts` の直接LINE Pushと通知先再取得処理を撤去し、wrapper RPC後に共通Outbox workerをdrainする形へ変更。
- 通知形式はテキスト。SQL未適用。ローカルチェック未実施。

## 2026-11-16 追加候補：退会通知Outbox

- `supabase/migrations/20261116_021_withdrawal_notification_outbox.sql` を追加。既存の`withdraw_user_account(text)`をwrapper内から呼び、退会・マッチング取消・直接依頼返金が成功した場合に、返却された通知対象（マッチング相手／未成立直接依頼受信者／返金先施設）を同一transaction内でOutbox登録する。
- `src/app/api/account/withdraw/route.ts` をOutbox wrapper RPC呼び出しへ切り替え、退会後の直接LINE Push処理を撤去。
- 通知形式はテキスト。SQL未適用。ローカルチェック未実施。


## 2026-11-16 追加候補：バンド招待通知Outbox

- `supabase/migrations/20261116_022_band_invitation_notification_outbox.sql` を追加。`band_invitations` INSERT時に招待先へ、`pending`から`accepted`／`rejected`への更新時に招待元へ、同じDB transaction内で通知をOutbox登録する。
- `src/app/api/bands/invitations/route.ts` の招待作成・回答の直接LINE Pushを撤去し、共通Outbox workerへ移行。
- 通知形式はテキスト。SQL未適用。ローカルチェック未実施。

## 2026-11-16 追加候補：片側完了報告通知Outbox

- `supabase/migrations/20261116_023_completion_report_notification_outbox.sql` を追加。マッチングの施設／演奏者いずれかの完了報告日時がNULLから設定され、相手側が未報告の場合に、更新transaction内で相手へ確認依頼通知をOutbox登録する。双方報告後の最終完了通知はmigration018で処理。
- 施設側・演奏者側の完了APIから片側報告通知の直接Push処理も撤去し、共通Outbox workerへ一本化。
- 通知形式はテキスト。SQL未適用。ローカルチェック未実施。

## 通知経路の現時点まとめ

- 実行対象の`src/app/api`内に直接LINE Push呼び出しは残っていない。送信処理は共通Outbox workerへ集約（`route.ts.backup`はバックアップで実行対象外）。migration017ではDB wrapper側も個人本人／バンド現役リーダーにキャンセル権限を限定。
- migration014〜023はすべて候補SQLで未適用。009〜013を含め、依存順・現行DB定義・ACL・triggerの最終確認が必要。
- 通知形式をテキストに統一したため、従来Flex通知のボタン・リンク体験は維持していない。LINE実機で送信先・文面・重複・再送を確認する。
- LINE Push成功後のDB完了記録失敗による重複可能性、日次cronによる再送遅延は残る。exactly-once配信は保証しない。

## 2026-11-16 matching-core 最終依存確認での修正
- migration009は適用時点で存在するpublicテーブルへ共通mutation gate triggerを設置するため、その後のmigration014で新設する`line_notification_outbox`には別途triggerが必要。
- migration014に009のgate関数存在確認を追加し、`line_notification_outbox`にも`trg_global_mutation_gate`を設置するよう修正。Outboxのenqueue／claim／complete／retry更新も共通トランザクションロックに従う。
- SQL未適用。アプリのbuild/lint/test/typecheck等は未実施。

## 2026-11-18 限定公開 Phase 2 Outbox追加監査（v8候補）
- [x] 退会wrapperの3種類の通知ループで、通知先LINE IDが退会対象本人のLINE IDと一致する場合は通知登録をスキップするよう修正。兼任プロフィール等で本人が相手側recipient集合に混在しても、退会後のactive recipient解決エラーで退会transaction全体が失敗しないようにする。
- [x] 直接依頼承諾時の施設コイン不足通知先を、承諾操作中の演奏者から支払者である施設アカウントへ修正。施設がactiveであることを確認してOutboxへ登録する。
- [x] Outboxの同一event_key競合について、migration014がOutboxテーブルにも共通mutation gate triggerを設置し、書き込みをtransaction advisory lockで直列化していることを再確認。追加ロックは不要。
- [ ] 退会通知の本人除外・相手方通知・直接依頼返金通知、および直接依頼承諾時の施設コイン不足通知先を、実DBおよびLINE実機で確認。
- [ ] migration014〜023とmigration004のSQL適用前レビュー、実DBのread-only preflight、PostgreSQL上での適用確認。

**状態：** v8は未適用の候補パッケージ。Tokyo Supabase、本番データ、GitHub、Vercelは未変更。build／lint／test／typecheck／ローカルチェックは未実施。公開判定はBLOCKED。

- 追加監査記録：`docs/20261118_OUTBOX_V8_FOLLOWUP_AUDIT.md`（退会自己通知の除外、直接依頼承諾時の施設コイン不足通知先修正、Outbox event key/lock再確認、適用前の残課題）。


## 2026-11-18 Outbox migration schema cache対応（v9候補）
- [x] Migration 004でclaim RPCの戻り値列を追加するため、COMMIT後のPostgREST schema cache reload通知（`NOTIFY pgrst, 'reload schema'`）を追加。
- [ ] 適用後にPostgREST経由のclaim RPCが`lease_token`列を返すことを確認。

**状態：** 候補SQLのみ。未適用・未実行。


## 2026-11-18 Phase 2 follow-up audit (v10 candidate)
- [x] Migration 004のlock-order inversionを特定。DDL/table lock取得後にglobal mutation gateを待つ構造を修正し、DDLより前に共通gateを取得するよう変更。
- [x] Migration 004 preflightにOutboxの`trg_global_mutation_gate`存在確認を追加し、gate未設置環境ではfail-closed。
- [x] 退会wrapper・キャンセルwrapper・施設住所の公開経路・Stripe購入停止経路を静的再確認。
- [ ] Outbox cronは現在日次（`5 2 * * *`）で、各drainは最大5件。高fan-out通知の残件が次回日次cronまで滞留する可能性がある。Vercel planを確認し、分単位Cronまたは外部schedulerを選定する。
- [ ] Tokyo DB read-only preflight、migration適用前のpending/processing件数確認、PostgreSQL適用検証、LINE実機通知確認。

**状態：** v10候補のみ。DB・GitHub・Vercel未変更。build／lint／test／typecheck／ローカルチェック未実施。公開判定BLOCKED。詳細は`docs/20261118_PHASE2_FOLLOWUP_AUDIT_V10.md`。


### 2026-11-18 Stripe Webhook順序性・副作用fencing監査（v11）
- [x] Stripe Webhookのclaim tokenはWebhook event行の状態更新をfenceするが、決済事故レコードの副作用は別PostgREST要求で無条件upsertされることを確認。
- [x] Stripeの`event.created`が保存・比較されず、同一refund/dispute IDの古いイベントが新しい状態を上書きし、管理者解決後に再openする可能性をP1として記録。
- [x] global mutation gateは個々のDMLを直列化するが、複数HTTP要求のread/compare/upsert全体をatomicにはしないことを確認。
- [ ] PaymentIntent紐付け・incident比較/upsertを単一SECURITY DEFINER RPC transactionへ統合し、Stripe event時刻による単調更新とadmin解決との整合を保証。
- [ ] disposable DBでrefund/disputeイベントの逆順到着、同時処理、admin解決競合を検証。
- [x] 限定公開中のコイン購入停止は維持。Webhookは既存Checkout Sessionの整合性処理のため残す。購入再有効化前に上記P1を解消する。

**状態：** v11は監査文書のみ更新。SQL・アプリソース・DB・GitHub・Vercelは未変更。SQL実行、build／lint／test／typecheck、ローカルチェックは未実施。Stripe購入再有効化は不可。公開判定BLOCKED。詳細は`docs/20261118_STRIPE_WEBHOOK_ORDERING_AUDIT_V11.md`。


### 2026-11-18 Matching Core API TOCTOU監査（v12）
- [x] Matching Coreの直接DML経路を棚卸しし、本人確認・actor IDの導出を静的確認。
- [x] バンド招待作成で、active leader確認と招待INSERTが別PostgREST要求に分離されているため、リーダー降格・バンド解散との競合で権限確認後に招待が作成され得るTOCTOUをP2として記録。
- [ ] 招待作成の全前提確認とINSERTを、global mutation gate取得後にband/memberを一定順序でロックする単一SECURITY DEFINER RPCへ統合。
- [ ] disposable DBでリーダー降格・バンド解散・同時招待の競合試験。
- [x] 完了報告は条件付きUPDATE後に`complete_match_with_fee`で最終状態・手数料を確定する構造を再確認。

**状態：** v12は監査文書のみ追加。コード・SQL・DB・GitHub・Vercel未変更。build／lint／test／typecheck／ローカルチェック未実施。Stripe Webhook P1および本件P2が未解消のため公開判定BLOCKED。詳細は`docs/20261118_MATCHING_CORE_TOCTOU_AUDIT_V12.md`。


### 2026-11-18 Chat authorization TOCTOU監査（v13）
- [x] Match chat POSTで、match status・参加者／現役バンドリーダー確認とmessages INSERTが別要求であり、キャンセル・退会・リーダー変更後に古い認可結果で送信できる競合窓をP2として記録。
- [x] Band chat POSTで、active band/member確認とband_messages INSERTが別要求であり、メンバー除外・バンド解散後に古い認可結果で送信できる競合窓をP2として記録。
- [ ] Match chatとband chatの認可確認・会話確保・メッセージINSERTを、global mutation gate取得後の単一SECURITY DEFINER RPC transactionへ統合。
- [ ] disposable DBでキャンセル／退会／リーダー変更／メンバー除外とチャット送信の同時実行を検証。
- [ ] Tokyo DB read-only schema preflightで`conversations.match_id`のunique制約、およびperformance_requests関連FKのON DELETE動作を確認。

**状態：** v13は監査文書のみ追加。コード・SQL・DB・GitHub・Vercel未変更。build／lint／test／typecheck／ローカルチェック未実施。Stripe Webhook P1、バンド招待P2、チャット認可P2が未解消のため公開判定BLOCKED。詳細は`docs/20261118_CHAT_AUTHORIZATION_TOCTOU_AUDIT_V13.md`。


### 2026-11-18 Performance Request mutation / FK監査（v14）
- [x] 募集PATCHの`id`・`facility_id`・`status='open'`条件付きUPDATEを確認。状態遷移後の古い事前確認で編集できないCAS構造。
- [x] 募集DELETEは応募件数・マッチング件数確認とDELETEが別要求であることを確認。ただしarchiveに既存applications/matches FKの元DDLがなく、ON DELETE動作を確定できないため、データ消失リスクを断定せず未判定として記録。
- [ ] Tokyo DBをread-onlyで調査し、`applications.request_id`および`matches.request_id`のFK `confdeltype`、関連dependent FK、DELETE triggerを確認。
- [ ] disposable DBで応募／マッチングINSERTと募集DELETEの競合を検証。
- [x] 完了報告APIの直接UPDATEがactive/scheduled・未報告・未紛争条件のCASであり、最終完了・手数料はDB RPCで処理されることを確認。
- [x] global mutation gateはpublic tableへの各DML statementを直列化するが、複数PostgREST要求のread/count/write全体をatomicにしないことを再確認。

**状態：** v14は監査文書・チェックリストのみ更新。新規P1/P2は追加せず。既存Stripe Webhook P1、バンド招待P2、チャット認可P2は未解消。DB・GitHub・Vercel未変更。build／lint／test／typecheck／ローカルチェック未実施。公開判定BLOCKED。詳細は`docs/20261118_REQUEST_MUTATION_AND_FK_AUDIT_V14.md`。


### 2026-11-18 Supabase catalog照合（v15）

- 2026-11-18 JSTにアップロードされた`supabase関数全体.txt`、`①②③.txt`、関数定義抽出を最新の利用可能なDBカタログ証拠として採用。これらは関数・ACL・RLS・テーブル権限・トリガーのエクスポートであり、users/coin_transactions/applications/matches等の業務行データは含まない。古いリセット前の業務データは再利用しない。
- migration 009の既存関数定義ハッシュ31件はアップロード済みDB定義と31/31一致。
- DBスナップショットではpublic 31テーブルのRLS有効を確認。一方、既存public 26テーブルにanon/authenticatedのREFERENCES・TRIGGER・TRUNCATEが残存。全権限取り消し済みという従来チェックを未完了へ訂正。
- 35 public SECURITY DEFINER関数にPUBLIC/anon/authenticated EXECUTEは確認されない。33関数はservice_role、2内部関数はpostgresのみ。search_pathは全35関数でpg_catalogを先頭に含まず、別途hardeningが必要。
- application_attempts、line_notification_outbox、trg_global_mutation_gateはアップロード済みDBスナップショットに存在せず、009/010/014-023は未反映と判断。候補SQLの適用順・preflightが必要。
- `20261118_005_revoke_public_relation_acl.sql`を候補追加。DB未適用。global default ACLの存在確認を先行する。
- 詳細：`docs/20261118_SUPABASE_CATALOG_BASELINE_AUDIT_V15.md`。


### 2026-11-18 Release-prep evidence boundary and TOCTOU reconfirmation (v16)
- [x] v15 baseline ZIP recovered from Library and used directly; no re-upload required.
- [x] Recent Supabase uploads classified: function/catalog/ACL exports, not operational row data. The read-only final-gate `.sql` files are query definitions, not query results.
- [x] No 2026-11-18 business-row snapshot found in inspected recent uploads. The only located business-row dump is dated 2026-11-13 and is stale; do not use it as current data or infer current balances/records from it.
- [x] Stripe Webhook P1 reconfirmed: Stripe `event.created` omitted; incident read/compare/upsert remains multi-request and is not fenced by webhook lease token.
- [x] Match chat and band chat P2 authorization/write TOCTOU reconfirmed from POST route source.
- [ ] Implement Stripe incident ordering as one atomic DB RPC with monotonic event ordering and admin-resolution semantics.
- [ ] Implement match-chat and band-chat authorization+insert as atomic RPCs under global mutation gate.
- [ ] Implement band invitation authorization+insert as atomic RPC under global mutation gate.
- [ ] Obtain a fresh post-reset read-only operational row snapshot from the intended Tokyo Supabase project before any production data mutation.
- [ ] Verify backup/restore, migration order, preflight, rollback and maintenance window before production upload/application.

**状態：** v16は監査文書・チェックリストのみ更新。アプリソース・SQL・Supabase・GitHub・Vercel未変更。build／lint／test／typecheck／ローカルチェック未実施。P1/P2未解消、現行業務行スナップショット未取得のため公開判定BLOCKED。詳細は`docs/20261118_RELEASE_PREP_DATA_EVIDENCE_AND_TOCTOU_AUDIT_V16.md`。


### 2026-11-18 Phase 2 atomic mutation candidate (v17)
- [x] Stripe Webhookに`event.created`を導入し、processing tokenを検証する単一incident RPC候補を追加。PaymentIntent紐付け・順序比較・incident更新を1 transactionに統合。古いevent拒否、同時刻のevent ID tie-break、同一event replay抑止、admin解決状態との整合を実装候補へ反映。
- [x] 既存のStripe refund/dispute incidentに信頼できるevent ordering metadataがない場合、migration preflightでfail-closedにする。`recorded_at`をStripe event時刻として流用しない。
- [x] バンド招待POSTをleader/account/band/member/duplicate確認とINSERTを同一RPC transactionで行う候補へ変更。既存INSERT通知Outbox triggerを維持。
- [x] Match chat POSTを現行match/account/participant/leader認可・conversation確保・messages INSERTの単一RPC候補へ変更。
- [x] Band chat POSTを現行account/band/member認可・band_messages INSERTの単一RPC候補へ変更。
- [ ] Match chat GET／Band chat GETの認可確認と履歴読み取りの競合窓を別途監査・対策。v17はPOSTのみ対象。
- [x] 新RPCは`postgres` owner、固定`pg_catalog`先頭search_path、service_role限定EXECUTEを指定。global mutation gateをrow lockより前に取得。
- [ ] Tokyo Supabaseの最新read-only preflightで009 gate trigger、022 invitation outbox trigger、`conversations(match_id)` unique index、列・制約を確認。
- [ ] 既存refund/dispute incidentのevent ordering metadataを確認。legacy行がある場合はStripe event履歴から正確なcreated時刻を取得して照合。
- [ ] disposable PostgreSQLでmigration適用・逆順Stripe event・replay・lease reclaim・admin resolution race・招待/チャット権限競合試験を実施。
- [ ] 募集削除FK/trigger調査とリセット後業務行データの最新read-only exportを取得。

**状態：** v17はアプリソース3経路とSQL候補2本を追加した未適用候補。DB適用・DB実行検証・build／lint／test／typecheck／ローカルチェック未実施。Stripe購入機能は限定公開中停止のまま。最新業務行スナップショット未取得。Supabase・GitHub・Vercel未変更。公開判定BLOCKED。詳細は`docs/20261118_PHASE2_ATOMIC_MUTATION_CANDIDATE_V17.md`、read-only preflightは`docs/20261118_PHASE2_V17_READ_ONLY_PREFLIGHT.sql`。


### 2026-11-18 Phase 2 v18 — v17再監査・証拠境界・残課題

- [x] v17 Stripe incident RPCのlease token検証を再確認し、保存済みWebhook `event_type`とRPC引数の一致検証を追加。空のStripe event IDもguardで拒否。
- [x] Stripe event IDの同一秒tie-breakは決定的順序であり、真の時間順序を保証しない点を明記。
- [x] Match chat GET／Band chat GETの認可と履歴読み取りが複数要求に分かれているため、GET側TOCTOUを残課題として明記。
- [x] 募集DELETEの応募・マッチング件数確認とDELETEが別要求である点、および`application_attempts.request_id ON DELETE CASCADE`を再確認。
- [x] アップロード済みDB資料を再点検。関数・ACL・RLS・トリガー定義はあるが、リセット後業務行データおよび全FK/制約/Indexの実行結果は含まれないことを明確化。11/13の古い業務データは現行根拠に不使用。
- [x] v18 read-only preflightに、DB identity、列、unique index、全performance_requests参照FKとON DELETE、trigger、Stripe incident metadata集計、業務行集計を追加。
- [ ] Tokyo Supabaseでv18 read-only preflightを実行し、009 global gate／022 Outbox trigger／conversations unique index／Stripe lease columns／legacy incident rows／request FK・DELETE triggerを確定。
- [ ] disposable PostgreSQLで006・007の適用と逆順Stripe event、lease reclaim、admin resolution、招待・チャットPOST競合を検証。
- [ ] Match chat GET／Band chat GETのatomic authorization+read設計・実装・競合検証。
- [ ] 募集DELETEの履歴検査・依存関係検査・DELETEを単一RPC transactionに統合し、FK/trigger実データと照合。

**状態：** v18は未適用候補。Stripe 006・invitation/chat 007はPostgreSQL実行検証未完了。最新リセット後の業務行スナップショットはアップロード済み資料に存在しないため、現行データの判断は保留。Supabase・GitHub・Vercel未変更。build／lint／test／typecheck／ローカルチェック未実施。Stripe購入停止を維持し、公開判定はBLOCKED。詳細は`docs/20261118_PHASE2_V18_STATIC_REVIEW_AND_BLOCKERS.md`、read-only preflightは`docs/20261118_PHASE2_V18_READ_ONLY_SCHEMA_AND_DATA_PREFLIGHT.sql`。


### 2026-11-18 Phase 2 v19 — atomic chat GET・候補ツリー同期修正
- [x] v17で追加したStripe Webhook、バンド招待、Match chat POST、Band chat POSTの4 APIファイルが、アーカイブ直下には反映済みだがnested `music-matching/`には未反映だった不整合を発見。4ファイルを同一内容に同期。
- [x] v17のmigration 006・007とv17/v18監査資料をnested `music-matching/`にも同期し、実リポジトリ側でAPIとSQL候補を同時に参照できるよう修正。
- [x] Stripe migration 006のpreflightに`stripe_webhook_events.event_type`およびevent identity列の型確認を追加。
- [x] Match chat GETの認可確認・会話確保・未読集計・既読更新・ページ取得を単一`get_match_chat_page_atomic` RPC候補へ統合。
- [x] Band chat GETの現役メンバー確認・最新100件取得・送信者名取得を単一`get_band_chat_messages_atomic` RPC候補へ統合。
- [x] migration 007に新GET RPCの列preflight、owner/search_path/EXECUTE ACL設定、rollback手順を追加。
- [x] 招待・チャットの全5 RPCで、検証済みLINE ID tokenのsubjectとDB上の`users.line_user_id`が一致することをtransaction内で再確認。
- [x] 募集DELETEを単一RPC transactionへ統合。応募・マッチング・応募試行履歴が1件でもあれば削除を拒否し、未知のFK/DELETE triggerがあればfail-closed。
- [ ] disposable PostgreSQLで006/007の構文・適用・権限・同時実行競合を検証。ローカルチェックはユーザー指示により未実施。
- [ ] Tokyo Supabase read-only preflightで実テーブル列、unique index、gate/outbox trigger、Stripe legacy incidents、request FK/DELETE triggerを確定。
- [ ] 募集DELETEの依存行検査とDELETEを単一transaction/RPCに統合するか、FK・trigger実態に基づいて安全性を確定。

**状態：** v19はAPIソース4経路のリポジトリ側同期と、チャットGETの原子的読取候補を追加した未適用パッケージ。Stripe・招待・チャット・募集DELETEのSQL候補はPostgreSQL実行検証未完了。リセット後業務行データは既存アップロードに含まれず、古い11/13 dumpは現行根拠に不使用。Supabase・GitHub・Vercel未変更。build／lint／test／typecheck／ローカルチェック未実施。Stripe購入停止、レッスン有効を維持。公開判定BLOCKED。詳細は`docs/20261118_PHASE2_V19_STATIC_REVIEW_AND_REPOSITORY_SYNC.md`。


## 2026-11-18 v20 follow-up audit

- Corrected exact function-signature checks for the two atomic chat GET RPCs in migration 007.
- Added migration 009 to acquire the shared mutation gate before row locks in Stripe webhook claim, coin fulfillment, and admin incident management.
- PostgreSQL execution and live DB comparison remain pending; release remains BLOCKED.

- Stripe ordering follow-up (v20): distinct events sharing the same `event.created` second are now rejected as ambiguous rather than ordered lexicographically; manual reconciliation remains required.


### 2026-11-18 Phase 2 v21 — account lifecycle guard / read-lock follow-up
- [x] v20 lock-order指摘を候補migration本文と照合。`20261116_009_global_mutation_gate.sql`内の32個のCREATE OR REPLACE FUNCTIONブロックは、明示的row/advisory lockより先にglobal gateを取得することを静的確認。アップロード済みの生関数exportはmigration適用前定義であり、候補migration後の定義と混同しないよう監査記録を訂正。
- [x] Direct API DMLを再棚卸しし、施設・演奏者プロフィール、募集作成/編集、問い合わせ、favoritesの認証読取とDMLが別要求であることを確認。global statement gateだけでは、認証読取後に退会が完了してから古い要求のDMLが実行されるTOCTOUを防げない。
- [x] 退会RPCがperformers/facilities行を保持・匿名化してからusers.account_statusをwithdrawnへ変更することを確認。stale requestがプロフィール/募集を再更新できる危険をP1として記録。
- [x] migration 010候補を追加し、performers/facilities/performance_requests/lesson_offers/lesson_applications/inquiries/favoritesのINSERT/UPDATE時に現行account_statusをDB row triggerで再確認。usersのwithdrawn avatar更新も拒否。Lesson機能は停止せず、active accountのみ利用可能にする。
- [x] create_lesson_offer / update_lesson_offer_with_levels / apply_to_lesson_offerのactive account確認不足をlesson_offers/lesson_applicationsのDB guardで補完する候補を追加。
- [x] read-onlyのget_band_chat_messages_atomicがexclusive global gateとFOR UPDATEを取得していた点を修正。shared advisory gateとFOR SHAREへ変更し、読み取り同士の不要な直列化を解消。
- [ ] profile POST/PUTのavatarとprofile複数要求を単一RPCへ統合し、部分更新を防止。
- [ ] 東京Supabase read-only preflightでmigration 009 gate、対象テーブル列/trigger、lesson schema、既存trigger名を確認。
- [ ] disposable PostgreSQLで退会と各API書込の競合、レッスン講師/応募者退会との競合、shared reader対exclusive writerを検証。

**状態：** v21は未適用SQL候補・監査資料を追加。PostgreSQL実行・競合テスト・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。リセット後業務行データは未取得。Stripe購入停止、レッスン機能有効を維持。公開判定BLOCKED。詳細は`docs/20261118_PHASE2_V21_ACCOUNT_LIFECYCLE_AND_READ_GATE_AUDIT.md`。

### 2026-11-18 Phase 2 v22 — active-account API alignment
- [x] Facility user resolver now filters `account_status='active'`; applies to facility profile GET/POST/PATCH.
- [x] Performer registration user lookup now filters `account_status='active'` before avatar/profile writes.
- [x] Performer profile GET and PATCH user lookups now filter `account_status='active'` to avoid serving retained profile data to a withdrawn LINE-linked account.
- [x] Confirmed v21 DB row guards remain the authoritative defense against stale read-then-write races; API filters are defense-in-depth only.
- [x] Added v22 read-only preflight for exact target column types and enabled guard/global-gate trigger inventory.
- [ ] Consolidate avatar + performer/facility profile writes into one RPC after exact Tokyo DB columns, unique constraints, and response contract are confirmed.
- [ ] Run v22 read-only preflight against the intended Tokyo Supabase DB and inspect the post-reset operational state.
- [ ] Run disposable PostgreSQL migration and concurrency tests; no local checks were run in this pass per instruction.

**状態：** v22はAPI層のactive-account確認を追加した候補。DB SQLは変更なし。プロフィール複数要求による部分更新はP2で残存。PostgreSQL・実DB・LINE実機検証未実施、Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。公開判定BLOCKED。詳細は`docs/20261118_PHASE2_V22_ACTIVE_ACCOUNT_API_ALIGNMENT.md`。


### 2026-11-18 Phase 2 v23 — withdrawal lesson-application lifecycle
- [x] `withdraw_user_account(text)` と v21 account guards の組合せを静的照合し、退会者が関係する pending lesson_applications が残留する可能性を確認。
- [x] active→withdrawn の直前に、本人が応募者または募集主である pending lesson_applications のみ rejected にするmigration 011候補を追加。matched lessonは変更せず、既存の退会拒否方針を維持。
- [ ] 東京Supabaseのlesson_applications.status型・CHECK/enum・global gate・active-account triggerをread-only照合。
- [ ] disposable PostgreSQLで講師退会・応募者退会・同時応募/退会・Outbox連動を検証。

**状態：** v23は未適用migration 011と監査記録を追加した候補。DB実行・競合テスト・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。公開判定BLOCKED。詳細は`docs/20261118_PHASE2_V23_WITHDRAWAL_LESSON_APPLICATION_LIFECYCLE.md`。


### 2026-11-18 Phase 2 v24 follow-up

- migration 011 preflight now checks text/varchar CHECK constraints for the `rejected` state before installing the withdrawal cleanup trigger. This is still candidate-only; Tokyo schema/domain validation and PostgreSQL execution remain pending.
- Lesson-application withdrawal cleanup does not yet produce a dedicated rejection notification for counterparties; notification behavior remains an explicit release review item.
- Release remains BLOCKED. No live DB, GitHub, Vercel, build, or local checks were performed.

### 2026-11-18 Phase 2 v25 — batch audit / Outbox and withdrawal follow-up
- [x] 約20項目をまとめた横断静的監査を実施。退会通知、レッスン応募 lifecycle、band招待/解散通知、プロフィール複数書込、role境界、Outbox worker/ACL、lesson venue編集経路を確認。
- [x] Outboxのservice_role直接テーブル権限をmigration 004候補で剥奪。アプリはSECURITY DEFINER RPCとtrigger経由のみでアクセスする設計へ。
- [x] Outboxのevent identity/payloadをINSERT後に変更できないtrigger候補を追加。
- [x] Outbox processing行のlease_token/locked_at必須、非processing行のlease情報nullをpostflightで検査するよう強化。
- [x] migration 003のACL allowlistに、後続migration 004のtrigger-only immutable guard関数を追加し、service_roleへの直接EXECUTE grant対象から除外。
- [x] migration 011でstatus domainのbase type/enum/domain CHECK制約も確認し、rejectedへの遷移が不確実ならfail-closedするよう強化。
- [ ] Performerプロフィール作成APIの二次ロール作成権限を整理。管理者設定のdual-role運用と通常ユーザーのrole境界を確定してから修正。
- [ ] migration 006のdual-role退会対応とmigration 013の現行退会処理を統合し、二次プロフィール・関連取引を残さない。
- [ ] performer/facilityプロフィール登録・更新のavatar/profile複数DMLを単一RPC transactionへ統合。
- [ ] 退会・イベントキャンセル・応募期限切れでpending applicationsをrejectedにした際、通常応募の相手側へ通知する仕様とOutbox登録を統合。
- [ ] 退会でpending lesson_applicationsをrejectedにする際、講師/応募者の相手側へ通知する。
- [ ] 退会でpending band_invitationsをcancelledにする際、相手側へ通知する。
- [ ] リーダー退会/バンド解散時、残るメンバーへ通知する。
- [ ] Outboxの5件上限と日次cronによる遅延可能性を踏まえ、少人数限定公開で許容する通知遅延・バックログ運用を決定。
- [ ] LINE pushの応答喪失時に重複通知が起こり得るat-least-once仕様を運営手順へ明記。
- [ ] レッスン募集の開催住所を作成後に編集できるようにするか決定し、必要ならAPI/RPC/UI/通知比較項目を同時修正。
- [ ] performer private-profile APIのCache-Control no-store、退会済みプロフィールの一覧表示方針、Outbox運用画面の要否を決定。
- [ ] 東京Supabaseでread-only catalog/data preflightを実行し、status domain/constraints、Outbox ACL/trigger/lease状態、dual-role関連行、pending通知backlogを確認。
- [ ] disposable PostgreSQLでmigration 003/004/011の適用、Outbox lease fencing、immutable identity、退会と通知の同一transaction rollbackを検証。

**状態：** v25は複数のOutbox/withdrawal安全性修正をまとめた未適用候補。22項目の監査結果と未解決事項は`docs/20261118_PHASE2_BATCH_AUDIT_V25.md`。DB実行・東京DB read-only preflight・LINE実機検証・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。公開判定BLOCKED。


### 2026-11-18 Phase 2 v26 — API privacy / lesson detail / lifecycle batch review
- [x] 演奏者のprivate profile GET/PATCH全レスポンスに`Cache-Control: no-store, no-cache, must-revalidate`を付与する候補を追加。
- [x] 施設プロフィールGET/POST/PATCH全レスポンスに同じno-store方針を適用。施設登録住所を含むレスポンスのキャッシュを明示的に禁止。
- [x] レッスン募集詳細APIのSELECTに既存`address`列を追加。募集一覧APIと詳細UIが利用する開催住所を詳細レスポンスにも含める。住所編集機能は追加していない。
- [x] API直接DMLを再棚卸し。favorites、inquiries、performers/facilities、performance_requests、matches完了報告、users登録、管理者機能、Stripe webhookを対象に、DB gate/row guard/compare-and-setの依存を確認。
- [x] migration 009の32関数について、明示的row lockより前にglobal mutation gateを取得することを静的確認。古いmigration内の定義を後続の現行定義と混同しないよう整理。
- [x] migration 010のactive-account row guardと、migration 011の退会時pending lesson application cleanupの実行順序を再確認。
- [ ] performer作成APIのrole境界と管理者限定dual-role設定を整合させる。
- [ ] migration 006のdual-role退会処理とmigration 013の現行課金・返金処理を統合。
- [ ] performer/facilityプロフィールとavatarの複数DMLを単一transaction RPCへ統合。
- [ ] 退会・イベントキャンセル・応募期限切れによる通常応募rejectの相手側通知を設計・実装。
- [ ] 退会時のlesson application reject、band invitation cancel、band disbandの通知対象と文面を確定。
- [ ] Outboxの5件上限、日次cron、at-least-once重複可能性、運用画面なしを限定公開の運営手順に反映するか決定。
- [ ] レッスン募集の開催住所を編集可能にするか決定。必要ならAPI/RPC/UI/通知比較項目を一括変更。
- [ ] 退会済み演奏者を公開一覧から除外するか、匿名表示で残すか決定。
- [ ] 東京Supabase read-only preflightでmigration 003/004/010/011のtrigger・ACL・status型・Outbox lease状態を確認。
- [ ] disposable PostgreSQLでOutbox lease fencing、退会時trigger rollback、プロフィールRPC、dual-role退会、通知recipientを検証。

**状態：** v26は3 APIファイルの候補修正と30項目の静的横断監査を収載。SQLは追加・実行していない。PostgreSQL・東京DB read-only preflight・LINE実機検証・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。P1未解消のため公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V26.md`。

### 2026-11-18 Phase 2 v27 — active-account API/RPC batch hardening
- [x] 非adminのLINE user lookupをAPI全体で再棚卸しし、37 route filesの`users.line_user_id` lookupに`account_status='active'`条件を追加。対象はapplications、bands、lesson offers/applications、facility/performer requests・invitations・matches・disputes・completion、chat、reviews、coins、inquiries、map search、Stripe checkout status等。
- [x] performer directory GETにactive viewer確認を追加。退会済み演奏者profileの一覧表示方針は別途未決。
- [x] migration 012候補で`create_band_with_leader`がglobal gate取得後にperformer ownerのactive状態を再確認するよう修正。
- [x] migration 012候補で`create_facility_invitation_with_coins`がglobal gate取得後に施設actorと招待先演奏者のactive状態を再確認するよう修正。
- [x] migration 013候補で個人応募・バンド応募RPCがglobal gate取得後にactorのactive状態を再確認するよう修正。API lookupだけでは閉じられない退会との競合をDB側で防ぐ。
- [ ] band invitation/message等、残りのSECURITY DEFINER write RPCについて、withdrawal後のactive membership/actor再確認がDB側で完結しているか全件確認。
- [ ] migration 012/013のPostgreSQL構文・戻り値型・ACL保持・適用順序をdisposable DBと東京DB read-only preflightで検証。
- [ ] dual-role退会、プロフィール複数DML、退会/イベントキャンセル/期限切れの通常応募通知、lesson通知、band通知、Outbox運用課題は継続BLOCKER。

**状態：** v27は37 API route filesのactive-account lookup hardeningと、3つの重要RPC（band作成、施設直接招待、個人/バンド応募）のDB側active-account guardを未適用候補として収載。全non-admin LINE subject lookupの静的走査でactive filter未設定は0件。PostgreSQL実行・東京DB read-only preflight・LINE実機検証・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。P1未解消のため公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V27.md`。

### 2026-11-18 Phase 2 v28 — discovery privacy / lifecycle / Outbox batch audit
- [x] Performer directory query now inner-joins the owning user and filters `account_status='active'`, preventing withdrawn/anonymized performer rows from appearing in discovery.
- [x] 40-item static review across v27 active-account API/RPC changes, dual-role withdrawal, profile atomicity, notifications, Outbox worker, lesson venue editing, and migration 009 lock ordering.
- [x] migration 009 SECURITY DEFINER function inventory: 32 function bodies reviewed for explicit global-gate-before-row/advisory-lock ordering. Nested trigger/row-lock ordering remains unproven.
- [x] Outbox migration 004 behavior rechecked: active account recipient binding, immutable event identity, lease-token fencing, legacy unbound backlog dead-lettering, and service_role table ACL revocation.
- [ ] Integrate migration 006 dual-role withdrawal behavior with migration 013's current cancellation/refund/accounting lifecycle without losing later fixes.
- [ ] Consolidate performer/facility profile and avatar writes into single transaction RPC after Tokyo schema/unique-constraint/response-contract preflight.
- [ ] Add transactional counterpart notifications for ordinary application rejection, lesson application rejection, band invitation cancellation, and leader band disbanding after recipient/message policy is decided.
- [ ] Decide acceptable Outbox backlog latency, five-message drain cap operations, daily cron schedule, at-least-once duplicate risk, and DB-only operations process.
- [ ] Tokyo Supabase read-only preflight: migration history, enabled trigger inventory/order, ACLs, status/domain constraints, dual-role profile rows, band memberships, Outbox backlog, and post-reset business rows.
- [ ] Disposable PostgreSQL validation for candidate migrations and concurrency/rollback scenarios.

**状態：** v28は40項目の静的監査と演奏者一覧の退会済みユーザー除外を収載。新規SQLなし。PostgreSQL・東京DB read-only preflight・LINE実機検証・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。P1未解消のため公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V28.md`。


### 2026-11-18 Phase 2 v29 — withdrawal lineage / notification / public payload batch audit
- [x] 公開演奏者一覧のnested `users.account_status`選択を削除。`users.account_status='active'`のserver-side filterとinner joinは維持し、内部状態をレスポンスへ含めない。
- [x] migration 006とmigration 013の`withdraw_user_account(text)`を直接diffし、006のdual-role両プロフィール処理が013でprimary `users.user_type`分岐に戻っていることを確認。013のglobal gate取得とapplication_attempts更新は維持が必要なため、単純な旧関数復元は行わない。
- [x] 退会Outbox wrapper、通常応募reject、lesson application reject、band invitation cancel、leader band disband、event cancellation、application expiryの通知トリガー/対象生成を横断確認。通知未対応経路を明確化。
- [x] performer/facility登録・更新のavatar/profile複数DMLを再確認。トランザクションRPC化はTokyo schema/unique constraints/role semanticsのread-only preflight後に実施する。
- [x] Outbox helperの最大5件制限、withdrawal APIのlimit=100指定が実際には5件にclampされること、daily cronを確認。
- [x] Tokyo DB向けread-only preflight SQLを追加。migration履歴、列型/制約、trigger状態、function hash/ACL、dual-role件数、Outbox/応募/招待状態のaggregateを確認する。
- [ ] 東京Supabaseでv29 read-only preflightを実行し、リセット後の現状を確認。
- [ ] migration 006/013を統合したdual-role退会処理を、現行返金・application_attempts・notification wrapperの契約を保持して設計。
- [ ] 通常応募/レッスン応募/招待取消/バンド解散/期限切れの通知先と文面を決定し、Outboxへ同一transactionで登録。
- [ ] profile/avatar登録・更新を単一RPCへ統合し、入力検証・戻り値・unique constraintを照合。
- [ ] disposable PostgreSQLでcandidate migrations/rollback/競合検証、LINE実機で通知対象を限定した確認。

**状態：** v29は公開演奏者レスポンスの内部statusフィールドを除去する候補修正1件、30項目の横断監査、Tokyo向けread-only preflight SQLを収載。DB実行・live read-only query・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。P1未解消のため公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V29.md`。

### 2026-11-18 Phase 2 v30 — active-owner visibility / personalized cache batch
- [x] Performer detail and performer review detail now require an active owning user; retained withdrawn performer rows no longer resolve through those endpoints.
- [x] Facility detail now requires an active owning user and does not expose the internal join field.
- [x] Performance request list/detail and map performance search now require active facility owners; embedded internal owner join fields are stripped from responses.
- [x] Map lesson search and lesson-offer list/detail now require active performer owners; internal owner join fields are stripped.
- [x] Favorites GET omits inactive targets; POST refuses inactive targets; DELETE intentionally remains usable to remove stale favorites.
- [x] Personalized GET responses for map search, performance request list, lesson offer list/detail, and favorites now explicitly use `Cache-Control: no-store`.
- [ ] Verify the nested PostgREST relationship paths against the intended Tokyo schema when read-only access is available.
- [ ] Integrate dual-role withdrawal while preserving migration 013 accounting/refund/application-attempt behavior.
- [ ] Consolidate profile/avatar multi-write paths into transaction RPCs after schema/unique-constraint review.
- [ ] Complete ordinary application, lesson application, band invitation cancellation, and band disband notifications through the existing Outbox.
- [ ] Define Outbox backlog operations and at-least-once duplicate notification handling.

**状態：** v30は9 API route filesのactive-owner visibility/cache修正候補と28項目の静的監査を収載。SQL migration追加・SQL実行なし。東京DB read-only preflightはユーザーが実行環境にいないため未実施。PostgreSQL・LINE実機・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。P1未解消およびDB relationship未検証のため公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V30.md`。

### 2026-11-18 Phase 2 v31 — private API cache / error minimization / dual-role lifecycle batch
- [x] 13 authenticated or role-scoped GET endpoints now explicitly set `Cache-Control: no-store, no-cache, must-revalidate` for success and error responses: facility-owned requests, band application/message/detail/transfer/directory, facility match detail, lesson applications, performer invitation detail/list, performer match detail/list, and admin disputes.
- [x] Facility request list was confirmed to return account-specific request and latest-match state without an explicit cache policy; all responses now use a private no-store helper.
- [x] Four client-facing database error leaks were replaced with stable generic Japanese messages while preserving detailed server-side logging: facility request list, performance request list, performance request creation, and performer profile creation.
- [x] Confirmed the application submission route already sanitizes errors through `getSafeApplicationError`.
- [x] Re-audited migration 006/013 dual-role withdrawal divergence and migration 011 lesson cleanup role guard. Confirmed that migration 013 still branches only on primary `users.user_type`, while the 006 dual-profile behavior is not carried forward.
- [x] Re-audited migration 021 withdrawal wrapper. It emits match/direct-invite notices but does not capture ordinary application rejection, lesson application rejection, band invitation cancellation, or band disband notices.
- [x] Rechecked Outbox worker: `drainLineNotificationOutbox` clamps to five rows even if the withdrawal API passes 100; Vercel cron is daily at 02:05 UTC (11:05 JST). Residual backlog can wait for another immediate drain or daily cron.
- [ ] Integrate dual-role withdrawal with current global gate, cancellation/refund, `application_attempts`, lesson cleanup, and notification wrapper contracts.
- [ ] Add role-aware transactional counterpart notifications for ordinary applications, lesson applications, band invitation cancellation, and band disband; do not use a generic status trigger that can notify the actor.
- [ ] Decide operationally acceptable Outbox latency/backlog recovery and at-least-once duplicate notification handling.
- [ ] Tokyo Supabase read-only preflight remains pending; the user currently has no environment to run it.
- [ ] Disposable PostgreSQL validation and controlled LINE-device checks remain pending.

**状態：** v31は15 API route filesの候補修正（private no-store response policyとDBエラー応答の一般化）および33項目の横断静的監査を収載。SQL migration追加・SQL実行なし。東京DB read-only preflightは未実施。PostgreSQL・LINE実機検証・build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。Stripe購入停止、レッスン機能有効を維持。P1未解消のため公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V31.md`。
- [x] Shared `requireAdmin` authentication failure responses now also set no-store headers; this covers admin endpoints before their route handlers begin.


### 2026-11-18 v32 cross-chat reconciliation
- [x] `/api/performers` POST success/error responses use private no-store cache policy.
- [x] Performer instrument/genre arrays are normalized before validation and the validated arrays are persisted.
- [x] Later active-account guard migration preserves deferred direct-invitation charging: configurable fee, application attempt, seven-day expiry, retry lifecycle, and no charge at invitation creation.
- [ ] Dual-role withdrawal integration remains unresolved.
- [ ] Profile/avatar atomic transaction remains unresolved.
- [ ] Band transfer and all-member active-account guards remain unresolved.
- [ ] Withdrawal, lesson, band, cancellation and expiry notification gaps remain unresolved.


## 2026-11-18 Phase 2 v33 audit update (candidate only)
- Added candidate migration 014 for active-account checks on both band-transfer participants and every active band member applying to a performance request.
- Direct invitation fee lifecycle regression correction from v32 retained: no fee at invitation creation; configured fee is charged only during match establishment; seven-day attempt expiry/retry retained.
- Remaining P1: dual-role withdrawal integration; atomic profile/avatar writes; withdrawal ordinary/lesson application notifications.
- Remaining P2: band cancellation/disband notifications; event application rejection notifications; expiry notifications; Outbox retry/monitoring operations.
- No SQL execution, build, tests, lint, typecheck, local checks, or remote changes. Release remains BLOCKED.


### 2026-11-18 Phase 2 v34 — performer profile input normalization parity
- [x] Shared required string-array normalizer added for performer profile instruments/genres.
- [x] Performer profile POST and PATCH now trim, deduplicate, drop blank strings, and reject mixed-type/non-array values before persistence.
- [x] POST/PATCH normalization behavior is aligned; root/nested source copies synchronized.
- [ ] Profile/avatar writes remain split across REST transactions; integrate only after DB schema/unique constraints/response contract are verified.
- [ ] Dual-role withdrawal, ordinary/lesson application notifications, band cancellation/disband notifications, expiry events, and Outbox operations remain unresolved.

**状態：** v34は26項目の静的横断監査と演奏者プロフィールPOST/PATCHの楽器・ジャンル入力正規化統一を収載。SQL追加・実行なし。東京DB read-only preflight未実施。build／lint／test／typecheck／ローカルチェック未実施。Supabase・GitHub・Vercel未変更。P1未解消のため公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V34.md`。


## Phase 2 v35 追記（2026-11-18）

- 直接依頼APIの説明コメントを、固定100コインではなく `direct_invitation_fee_coins` の設定料金を成立時に徴収する仕様へ修正。実処理はv32以降の候補migration 012／成立時課金migration 012（2026-11-16系列）を引き続き静的照合。
- `expire_pending_application_attempts` は期限切れ応募を `rejected` に更新するが、application UPDATE専用の通知Outbox triggerは確認できず、期限切れ通知は未解決。
- 直接依頼の作成時非徴収、設定料金のattempt snapshot、`application_attempts`、7日期限、却下後再依頼、成立トランザクションでの徴収を維持する。
- 兼任退会、プロフィール/アイコン原子保存、退会・レッスン応募通知、Outboxの定期実行・再送運用は引き続き公開前ブロッカー。
- v35はソース静的監査候補。SQL未実行、Supabase/GitHub/Vercel未変更。build/test/lint/typecheck/ローカルチェック未実施。


### 2026-11-18 Phase 2 v36 応募期限切れ通知の追加監査（候補のみ）

- `expire_pending_application_attempts` は応募試行を `expired`、応募を `rejected` に更新する一方、既存通知migrationは `application_attempts` INSERT時のみ通知し、応募status UPDATE時の期限切れ通知がないことを確認。
- `20261118_015_expired_application_notification_outbox.sql` を候補追加。最新の応募試行自体が期限切れで、応募がpendingからrejectedへ遷移した場合に限り通知をOutboxへ登録する。
- 個人応募・直接依頼は演奏者本人、バンド応募は活動中のバンドメンバーを通知対象とする。退会済み・LINE未連携アカウントは除外。イベントキーは試行・受信者単位で冪等化。手動却下はこのmigrationの通知対象外。
- Outbox処理Cronと応募期限処理Cronが現行 `vercel.json` でそれぞれ1日1回であることを再確認。通知遅延を避ける実運用頻度はデプロイ環境・プランを確認して決定する必要がある。
- 兼任アカウント退会、プロフィール/アイコン原子的保存、退会・レッスン応募通知、バンド招待取消・解散通知は未解決。
- SQL候補は未適用。Supabase・GitHub・Vercel変更なし。ビルド・テスト・lint・typecheck・ローカルチェック未実施。公開判定BLOCKED。


### 2026-11-18 Phase 2 v37 — 退会・通知・Outbox・バンド送金横断監査

- [x] 20項目のソース静的監査を実施。
- [x] migration 006が実装していた兼任プロフィール両方の検出・退会処理が、後続migration 013の`user_type`単独分岐で失われることを確認。
- [x] migration 011のレッスン応募終了処理も`user_type='performer'`に限定され、施設主ロールの兼任アカウントでは演奏者側処理が漏れることを確認。
- [x] レッスン応募却下、通常応募却下、バンド招待取消、バンド解散・メンバー離脱のOutbox通知不足を確認。
- [x] Outbox Cronは1日1回・1回5件、応募期限Cronは1日1回・1回最大5,000件であることを確認。
- [x] バンド送金の冪等リプレイは二重課金を防ぐ一方、現時点の所属・アカウント状態確認より先に過去成功を返す仕様であることを確認。
- [x] 演奏者・施設プロフィールとavatarの保存が別REST transactionであり、部分成功し得ることを再確認。
- [ ] 兼任退会関数をmigration 013の返金・attempt lifecycleを維持しつつ、両プロフィール処理へ統合。
- [ ] actor-awareな応募・レッスン・招待取消・解散通知をOutboxへ統合。
- [ ] VercelプランとLINE制約を確認し、Outbox/expiryの実行頻度・batch・監視を決定。
- [ ] 東京DBのschema/unique制約を確認後、profile/avatar atomic RPCを設計。
- [ ] PostgreSQL・LINE実機・build/test/lint/typecheck/ローカルチェック未実施。SQL未実行。Supabase/GitHub/Vercel未変更。公開判定BLOCKED。

詳細：`docs/20261118_PHASE2_BATCH_AUDIT_V37.md`。

### 2026-11-18 Phase 2 v38 — Outbox worker observability / cron lifecycle audit

- [x] 20項目のcron・応募期限・Outbox静的監査を実施。
- [x] Outbox claim RPC失敗時にゼロ件成功として扱い、CronがHTTP 200 / success=trueを返してしまう監視上の欠陥を確認。
- [x] drain helperに`claimError`を追加し、Outbox Cronはclaim失敗またはlease ack記録失敗時にHTTP 500 / success=falseを返す候補修正を収載。
- [x] Outboxのrecipient UUID binding、payload identity immutability、lease-token fencing、active-account再確認、最大8回retryをソース確認。
- [x] LINE push成功後のack失敗時は外部pushを取り消せず、再送による重複が起こり得るat-least-once動作であることを確認。
- [x] Cron Bearer認証、expiry RPC上限5,000、Outbox helper上限5件を確認。
- [ ] Vercel実行条件・LINE制約に基づくcron cadence/batch/監視設計。
- [ ] v37 P1の兼任退会統合とactor-aware通知。
- [ ] SQL・PostgreSQL・東京DB read-only preflight・LINE実機・build/test/lint/typecheck/ローカルチェック未実施。Supabase/GitHub/Vercel未変更。公開判定BLOCKED。

詳細：`docs/20261118_PHASE2_BATCH_AUDIT_V38.md`。

## 2026-11-18 Phase 2 v39 — Supabase snapshot reconciliation

- [x] Latest uploaded Supabase data/function exports inspected; a real facility-primary dual-role account is confirmed in the supplied data snapshot.
- [x] Withdrawal migration order audited: 006 dual-role behavior is overwritten by 009 and 013 single-role versions.
- [x] Candidate migration 20261118_016 integrates dual-role cleanup, deferred direct-invite fee handling, application-attempt closure, lesson cleanup, and counterpart Outbox notifications.
- [ ] Review v39 migration against the current post-migration Tokyo catalog before applying.
- [ ] Execute migration only after explicit approval and successful preflight.
- [ ] Verify dual-role withdrawal and counterpart notifications with test accounts.
- [ ] Run release build and human/device checks when authorized.

Release gate remains BLOCKED. No Supabase/GitHub/Vercel changes or local checks were performed in this audit batch.


## 2026-11-18 Phase 2 v40 — 管理者限定兼任ロール境界の是正

- [x] Supabase最新データに施設主ロール＋演奏者プロフィールのアカウントが存在することを再確認。兼任アカウントは管理者のみ設定可能という既定方針に照らし、存在自体を不具合とは扱わない。
- [x] `POST /api/performers` が一般の施設主ロールからも演奏者プロフィールをupsertできる境界不備を確認。
- [x] 公開POSTで `users.user_type='performer'` を要求し、施設主ロールによる二次プロフィール新規作成を403で拒否。既存の管理者設定済み兼任プロフィールはPATCHで更新可能。
- [x] `/api/facilities` POSTは既にfacility主ロールを要求、`/api/users` POSTは既存active accountのuser_typeを変更しないことを確認。
- [ ] 管理者による兼任設定手順を明文化。アプリ内操作が必要なら対象userを明示したrequireAdmin専用APIを別途設計。
- [ ] migration 016は完全な先行migrationと対象DB catalogの照合後にのみ適用検討。
- [ ] profile/avatar atomic write、Outbox運用、PostgreSQL/LINE実機検証は継続課題。

**状態：** v40は24項目の横断監査と公開演奏者プロフィール作成境界の修正候補を収載。兼任アカウントの存在は仕様上許可される管理者設定として扱う。SQL未実行、Supabase/GitHub/Vercel未変更、build/test/lint/typecheck/ローカルチェック未実施。公開判定BLOCKED。詳細は `docs/20261118_PHASE2_BATCH_AUDIT_V40.md`。

## 2026-11-18 Phase 2 v41 —退会通知・Cron・プロフィール整合性の追跡監査

- [x] migration 016が退会時に通常応募を却下する一方、通常応募の相手側通知Outboxを作成していないことを確認。
- [x] migration 015の応募通知triggerは最新attemptが`expired`の場合のみであり、退会による`rejected`は対象外であることを確認。
- [x] auto-complete Cronの対象検索に明示的ページネーションがなく、PostgRESTの設定行数上限に依存することを確認。
- [x] Outbox drainは最大5件に制限され、退会APIが100件を指定しても実際は5件であることを再確認。
- [x] Outbox Cronは毎日1回・最大5件であり、退会等で大量発生した通知の滞留・監視・復旧運用が未確定であることを確認。
- [x] 演奏者・施設の登録APIはavatar更新後に別REST transactionでプロフィールupsertするため、部分成功し得ることを確認。
- [ ] 通常応募の退会時通知を、個人応募・バンド応募・直接依頼の区別と受信者単位の冪等キーを含めて統合。
- [ ] Outboxの実行頻度・滞留監視・再送/失敗時運用をVercel/LINEの実環境制約に合わせて決定。
- [ ] auto-completeのページネーションまたはDB側claim方式を導入し、Cron実行時間と合わせて検証。
- [ ] avatarとプロフィールの原子保存を、対象DB schema/制約確認後に設計。

**状態：** v41は30項目の静的追跡監査。SQL追加・実行なし。Supabase/GitHub/Vercel変更なし。build/test/lint/typecheck/ローカルチェック未実施。公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V41.md`。


## 2026-11-18 Phase 2 v42 — 通常応募の退会通知候補を統合

- [x] 施設退会時、通常の個人応募・バンド応募の相手側受信者を状態変更前に取得する候補処理をmigration 016へ追加。
- [x] 演奏者退会時、個人応募と、退会するリーダーの解散対象バンド応募について施設側受信者を取得する候補処理を追加。
- [x] 直接依頼は既存の手数料返金・取消通知フローから分離し、二重通知を避ける。
- [x] 兼任アカウントの両ロール通知配列を結合し、片側の通知が上書きされないようにする。
- [x] Outbox event keyを応募ID＋受信者ユーザーIDで冪等化。
- [ ] migration 016のSQL構文・実行計画・trigger/Outbox recipient bindingを対象DB catalog確認後に検証。
- [ ] 個人応募・バンド応募・兼任退会のLINE実機テスト。
- [ ] auto-completeの安全なbounded pagination/claim方式、Outbox滞留監視・頻度、プロフィール/avatar atomic writeは継続課題。

**状態：** v42は34項目の静的追跡監査。通常応募の退会通知を未適用migration 016へ候補実装。SQL未実行、PostgreSQL検証なし、Supabase/GitHub/Vercel未変更、build/test/lint/typecheck/ローカルチェック未実施。公開判定BLOCKED。詳細は `docs/20261118_PHASE2_BATCH_AUDIT_V42.md`。



## 2026-11-18 v43 SQL Editor適用記録（手動管理）

- [ ] 2026-11-18時点の本番DBを新規バックアップし、復元ポイントの存在を確認（11/3のローカル復元テストは過去確認としてのみ扱う）。

Hakotohito独自のmigration history tableは存在しないため、Supabase SQL Editorで各ファイルを1本ずつ実行し、末尾`COMMIT;`と成功表示を確認して記録する。Supabase内部migration履歴は代用しない。

- [ ] `20261116_009`–`20261116_023`（各ファイルを個別実行）
- [ ] `20261118_001`–`20261118_003`（各ファイルを個別実行）
- [ ] `20261118_004_harden_line_notification_outbox.sql`（pending/processingゼロ・重複LINE IDゼロを確認後）
- [ ] `20261118_005`–`20261118_016`（各ファイルを個別実行）
- [ ] v43 Vercel deployment Ready・旧worker drain・processingゼロを確認
- [ ] `20261118_017_retire_legacy_outbox_acknowledgement_rpcs.sql`（最後に個別実行）

適用時刻・実行結果・エラー有無はこの節の下へ追記する。

## 2026-11-18 Phase 2 v43 — Outbox反映手順の安全化

- [x] migration 004が未送信・処理中Outbox行を一括`failed`化するため、正当な通知まで失う可能性があることを確認。
- [x] 一括`failed`更新を削除し、`pending`/`processing`が1件でもあればmigrationを中断するfail-closed preflightへ変更。
- [x] lease-token RPCと旧ack RPCを一時併存させるexpand/contract方式に変更。
- [x] v43 workerに旧RPC/lease-token RPCの両対応を追加。
- [x] 新アプリのReady・旧インスタンスdrain・processingゼロを確認してから旧RPCを削除するmigration 017とrunbookを追加。
- [x] Outbox 5件上限、日次Cron、auto-complete非ページング、公開リストAPIのrow-capリスクを再確認。
- [x] 演奏者詳細・レビュー取得APIで、LINE ID tokenだけでなく閲覧者アカウントのactive状態を確認する候補修正を追加。
- [ ] P2: 管理者作成の兼任アカウントが自分の施設案件へ応募／自分の演奏者プロフィールへ直接依頼できる可能性。自己マッチング禁止方針を確認し、API/DB RPCの両側で拒否する。解決までは兼任アカウントを両側のテストに使用しない。
- [x] 本番テスト前後でアカウント・応募・試行・マッチング・コイン・Outbox・レッスン・バンド・Stripe状態を比較するread-only集計SQLを追加。
- [x] v43のDB/app段階反映、migration 017の適用タイミング、停止条件、LINE実機テスト順をproduction rollout guideに整理。
- [x] アップロード済み2026-11-17 Supabase関数エクスポートとmigration 009の必須routine hash 31件を照合し、31/31一致。既存SECURITY DEFINER 35関数もmigration 003のallowlistで35/35捕捉。migration 003の必須53関数も既存35＋候補定義18で53/53確認（実DBのlive preflightは別途必要）。
- [x] global mutation gate migrationでpartition親triggerの自動複製と子partitionの二重作成を避けるよう修正。
- [ ] 対象Tokyo DBのread-only preflight、migration履歴、Outbox件数、active LINE ID重複を確認。
- [ ] 互換性を保ったままmigration 004・依存migrationを適用し、v43アプリ反映後にmigration 017を適用。
- [ ] lease_token付きclaim/complete/retryとLINE実機通知をテストアカウントで検証。

**状態：** v43はOutbox通知喪失防止とworker RPCの段階的切替候補を収載。SQL未実行、PostgreSQL検証なし、Supabase/GitHub/Vercel未変更、アプリbuild/test/lint/typecheck/ローカルチェック未実施（ZIP整合性とroot/nestedファイル同期のみ確認）。公開判定BLOCKED。詳細は`docs/20261118_PHASE2_BATCH_AUDIT_V43.md`と`docs/20261118_PHASE2_V43_OUTBOX_ROLLOUT_RUNBOOK.md`。


## 2026-11-19 施設側LINE実機テスト・Phase 2 v44追跡監査

- [x] 施設プロフィール編集・保存の実機成功を記録。
- [x] 演奏者検索・詳細・直接依頼画面への遷移、同一演奏者への重複直接依頼拒否を実機確認。
- [x] 限定公開中のコイン購入停止表示は既定方針と一致することを確認。購入画面のホーム戻り導線は改善候補。
- [x] 案件削除は応募履歴・マッチング履歴・応募試行履歴がある場合に拒否するfail-closed設計を再確認。実機でエラー表示と削除中状態解除の視認性を再確認する。
- [ ] 施設マッチング一覧の取得失敗を調査。`performance_requests.venue_address`（migration 002）等のDB schemaとVercel error codeを照合。
- [ ] 施設案件登録の失敗を調査。POSTが`venue_address`を含めて直接INSERTするため、migration 002未反映がNo.4と共通原因の可能性。
- [ ] 直接依頼通知未着を調査。application_attempts通知trigger（migration 015）、Outbox migration 014/004、claim/ack RPC、worker実行結果を照合。
- [ ] 直接依頼時に-100コインが記録された不一致を調査。migration 011/012/`20261118_012`の適用状態と現行DB関数定義をread-onlyで確認。
- [ ] お気に入りプロフィールモーダルに直接依頼ボタンがないため、既存invite画面への導線を追加。
- [ ] 問い合わせ履歴に取り下げ操作がなく、APIもGET/POSTのみ。取り下げ可能状態・管理者側の監査履歴を含む状態遷移を設計。
- [ ] 直接依頼返金ロジックを簡素化する方針の適用範囲を確定。確認前にイベント/レンタル等の既存返金仕様を一括変更しない。
- [x] Vercel TypeScript修正7ファイルを候補ソースのroot/nested双方へ反映。
- [ ] read-only診断SQLで対象Tokyo DBのschema/function/trigger/Outbox/ledger状態を確認。

**v44状態：** 施設側実機所見と静的コード照合を候補へ記録。`20261119_FACILITY_RUNTIME_READONLY_DIAGNOSTICS.sql`はSELECTのみで未実行。DB適用状態・Vercel runtime logs未確認。SQL実行、DB変更、build/lint/test/typecheck/ローカルチェック、Git操作、Push、Deployは未実施。公開判定BLOCKED。詳細は`docs/20261119_FACILITY_SMOKE_TEST_FOLLOWUP.md`。


## 2026-11-19 Phase 2 v45 — レッスン仮押さえ廃止・新規登録承認制候補

- [x] レッスン募集作成・編集時は必要額の残高確認のみとし、`reserved_coins=0`で保存する候補へ変更。
- [x] レッスン応募は即時マッチングの既存仕様を維持し、成立時に講師・応募者のactive状態と講師残高を再確認して同一transactionで徴収する候補を追加。
- [x] `spend_coins_legacy`とバンド送金RPCからレッスン仮押さえ控除を除去。既存仮押さえ値を0へ正規化するmigration候補を追加。
- [x] 初回登録者を`pending_approval`で登録し、ロビー待機・管理者承認後に利用開始する候補を追加。既存activeユーザーは変更しない。
- [x] 管理者承認API・承認一覧画面・通常画面からのロビー遷移を追加。
- [ ] V45 read-only preflightで本番DBの関数定義・ACL・status制約・仮押さえ件数を確認。
- [ ] migration `20261119_001`をSupabaseへ適用し、postflightで状態確認。
- [ ] V45ソースをGitHubへ反映し、Vercel deployment Readyを確認。
- [ ] LINE実機でロビー待機→管理者承認→利用開始、レッスン募集登録時残高不変、成立時徴収、残高不足時不成立を確認。

**状態：** V45は未適用候補。Supabase/GitHub/Vercelへの変更、SQL実行、build/test/lint/typecheck/ローカルチェックは未実施。公開判定BLOCKED。詳細は`docs/20261119_V45_CHANGE_AND_DATABASE_STATUS.md`と`docs/20261119_PHASE2_V45_PACKAGE_MANIFEST.md`。
