# matching core 全RPCロック取得棚卸し（2026-11-15追加）

## 判定

この文書はTokyo DBの2026-11-15 10:00 JST読み取り専用スナップショットに含まれるpublic routine 37件の定義を対象に、行ロック・advisory lock・public routine呼出しを静的抽出したもの。DBへの変更やローカルチェックは行っていない。

**結論：request単独gateを各関数へ追加するだけの実装は不可。** 現行定義ではrequest／band／lesson offer／payment order／user／application／match／coin idempotencyの複数aggregateと冪等キーが混在し、nested call内で追加ロックを取る経路もある。gate導入前に各public入口で必要なaggregate IDとoperation keyを収集し、全gateを固定順位で先取りする構造へ分離する必要がある。

## 全37 routineのロック取得一覧

表記は関数定義内で現れた順。`FOR UPDATE`等の行ロック対象は直前のSELECT/UPDATE文脈から判定。行番号はDB関数定義の行番号。

### `accept_application_with_coins(uuid,uuid,uuid)`

ロック取得：60: `FOR UPDATE OF pr;` — v_rental_fee FROM public.performance_requests pr JOIN public.facilities f ON f.id = pr.facility_id WHERE pr.id = p_request_id AND f.user_id = p_facility_user_id FOR UPDATE OF pr;; 110: `FOR UPDATE;` — -- ③ バンド応募の場合、バンド行をロック IF v_prelock_band_id IS NOT NULL THEN SELECT b.status INTO v_band_status FROM public.bands b WHERE b.id = v_prelock_band_id FOR UPDATE;; 132: `FOR UPDATE OF a;` — v_application_performer_id, v_application_status, v_application_band_id FROM public.applications a WHERE a.id = p_application_id AND a.request_id = p_request_id FOR UPDATE OF a;; 349: `FOR UPDATE OF a` — FROM public.applications a WHERE a.request_id = p_request_id AND a.status = 'pending' AND a.id <> p_application_id AND a.source = 'facility_invite' ORDER BY a.id FOR UPDATE OF a; 371: `PERFORM pg_advisory_xact_lock(` — CONTINUE; END IF; v_refund_key := 'direct_invite_refund:' || v_invite.id::text; PERFORM pg_advisory_xact_lock(; 389: `FOR UPDATE;` — v_refund_amount := -v_original_fee.amount; SELECT u.coin_balance INTO v_refund_balance FROM public.users u WHERE u.id = v_original_fee.user_id FOR UPDATE;
内部routine呼出し：spend_coins

### `accept_direct_invitation_atomic(uuid,uuid)`

ロック取得：43: `FOR UPDATE OF pr;` — FROM public.applications a JOIN public.performance_requests pr ON pr.id = a.request_id JOIN public.facilities f ON f.id = pr.facility_id WHERE a.id = p_application_id FOR UPDATE OF pr;; 85: `FOR UPDATE;` — v_application_performer_id, v_application_source, v_application_status FROM public.applications a WHERE a.id = p_application_id AND a.request_id = v_request_id FOR UPDATE;
内部routine呼出し：spend_coins

### `admin_grant_coins(uuid,integer,text,uuid,text)`

ロック取得：28: `PERFORM pg_advisory_xact_lock(` — false, NULL::integer, '付与内容が正しくありません'::text; RETURN; END IF; -- 二重実行を防ぐためのロック PERFORM pg_advisory_xact_lock(; 62: `FOR UPDATE;` —  -- 付与先ユーザーをロックして残高を取得 SELECT u.coin_balance INTO v_current_balance FROM public.users u WHERE u.id = p_user_id FOR UPDATE;

### `agree_completion_dispute(uuid,text)`

ロック取得：21: `FOR UPDATE;` —  -- 同じマッチングへの同意処理を直列化 SELECT * INTO m FROM public.matches WHERE id = p_match_id FOR UPDATE;

### `apply_to_lesson_offer(uuid,uuid,text)`

ロック取得：38: `FOR UPDATE OF lo;` — v_capacity, v_offer_status, v_reserved_coins FROM public.lesson_offers AS lo JOIN public.performers AS p ON p.id = lo.performer_id WHERE lo.id = p_lesson_offer_id FOR UPDATE OF lo;; 121: `FOR UPDATE;` — v_charge := v_reserved_coins / v_remaining_slots; SELECT u.coin_balance INTO v_balance FROM public.users AS u WHERE u.id = v_teacher_user_id FOR UPDATE;

### `apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)`

ロック取得：58: `FOR UPDATE;` —  -- ① 案件行を最初にロック SELECT * INTO v_request FROM public.performance_requests WHERE id = p_request_id FOR UPDATE;; 72: `FOR UPDATE;` —  -- ② バンド行をロック SELECT * INTO v_band FROM public.bands WHERE id = p_band_id FOR UPDATE;; 183: `FOR UPDATE;` — -- ③ 既存応募レコードをロック SELECT * INTO v_application FROM public.applications a WHERE a.request_id = p_request_id AND a.band_id = p_band_id FOR UPDATE;; 190: `FOR SHARE;` —  -- コイン設定を取得 SELECT COALESCE(s.application_fee_coins, 10) INTO v_required_coins FROM public.coin_rate_settings s WHERE s.id = 1 FOR SHARE;; 210: `FOR UPDATE;` —  -- ④ リーダーのユーザー残高をロック SELECT COALESCE(u.coin_balance, 0) INTO v_balance FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
内部routine呼出し：spend_coins

### `apply_to_performance_request(uuid,uuid,uuid,text,uuid)`

ロック取得：59: `FOR UPDATE;` —  -- 案件をロックして同時応募・募集状態変更を制御 SELECT * INTO v_request FROM public.performance_requests pr WHERE pr.id = p_request_id FOR UPDATE;; 134: `FOR UPDATE;` — SELECT a.id, a.status INTO v_existing_id, v_existing_status FROM public.applications a WHERE a.request_id = p_request_id AND a.performer_id = p_performer_id AND a.band_id IS NULL FOR UPDATE;
内部routine呼出し：spend_coins

### `cancel_event_request_with_refund_internal(uuid,uuid,boolean)`

ロック取得：49: `FOR UPDATE;` —  -- 1. 案件を最初にロック SELECT * INTO v_request FROM public.performance_requests WHERE id = p_request_id FOR UPDATE;; 124: `FOR UPDATE;` —  -- 2. 施設ユーザーの残高行をロック SELECT u.coin_balance INTO v_balance FROM public.users u WHERE u.id = v_facility_user_id FOR UPDATE;; 139: `FOR UPDATE;` — WHERE m.request_id = p_request_id AND m.status = 'active' AND m.performance_status IS DISTINCT FROM 'cancelled' AND m.performance_status IS DISTINCT FROM 'completed' AND m.completed_at IS NULL ORDER BY m.id FOR UPDATE;; 146: `FOR UPDATE;` —  -- 4. 対象応募をID順にロック PERFORM 1 FROM public.applications a WHERE a.request_id = p_request_id ORDER BY a.id FOR UPDATE;; 170: `PERFORM pg_advisory_xact_lock(` — v_fee_type := 'event_participation_fee'; v_fee_refund_key := 'event_participation_refund:' || v_match.id::text; END IF; -- 実際の参加手数料だけ返金 PERFORM pg_advisory_xact_lock(; 242: `PERFORM pg_advisory_xact_lock(` — AND a.source = 'facility_invite'; IF FOUND THEN v_direct_refund_key := 'direct_invite_refund:' || v_application.id::text; PERFORM pg_advisory_xact_lock(; 347: `PERFORM pg_advisory_xact_lock(` — ON u.id = p.user_id WHERE p.id = v_application.performer_id AND u.account_status = 'active' AND u.line_user_id IS NOT NULL AND u.line_user_id NOT LIKE 'withdrawn:%'; PERFORM pg_advisory_xact_lock(; 437: `PERFORM pg_advisory_xact_lock(` — WHERE id = v_application.id AND status = 'pending'; END LOOP; -- 7. 初回成立手数料は完了済みマッチングがない場合だけ返金 IF NOT v_has_completed_match THEN PERFORM pg_advisory_xact_lock(

### `cancel_event_request_with_refund(uuid,uuid)`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし
内部routine呼出し：cancel_event_request_with_refund_internal

### `cancel_match_with_direct_invite_refund(uuid,uuid)`

ロック取得：62: `FOR UPDATE;` — INTO v_request_type, v_request_status, v_request_facility_id FROM public.performance_requests pr WHERE pr.id = v_request_id FOR UPDATE;; 96: `FOR UPDATE;` —  -- 3. 施設ユーザー残高をロック SELECT u.coin_balance INTO v_balance FROM public.users u WHERE u.id = v_facility_user_id FOR UPDATE;; 108: `FOR UPDATE;` — -- 4. マッチングをロック SELECT m.* INTO v_match FROM public.matches m WHERE m.id = p_match_id AND m.request_id = v_request_id FOR UPDATE;; 156: `FOR UPDATE;` — SELECT a.* INTO v_application FROM public.applications a WHERE a.id = v_match.application_id AND a.request_id = v_request_id AND a.source = 'facility_invite' FOR UPDATE;; 249: `PERFORM pg_advisory_xact_lock(` — v_fee_refund_key := NULL; v_has_event_fee := false; END IF; -- 7. 直接依頼の送信手数料を返金 IF v_has_direct_fee THEN PERFORM pg_advisory_xact_lock(; 288: `PERFORM pg_advisory_xact_lock(` — v_refund_amount + v_direct_fee_refund_amount; END IF; END IF; -- 8. 通常案件の成立手数料を返金 IF NOT v_event AND v_has_match_fee THEN PERFORM pg_advisory_xact_lock(; 338: `PERFORM pg_advisory_xact_lock(` — v_refund_amount + v_match_fee_refund_amount; END IF; END IF; -- 9. イベント・レンタルの参加費を返金 IF v_event AND v_has_event_fee THEN PERFORM pg_advisory_xact_lock(

### `complete_match_with_fee(uuid,text)`

ロック取得：53: `FOR UPDATE;` — END IF; SELECT m.* INTO v_match FROM public.matches m WHERE m.id = p_match_id FOR UPDATE;; 122: `FOR UPDATE;` — END IF; SELECT pr.* INTO v_request FROM public.performance_requests pr WHERE pr.id = v_match.request_id FOR UPDATE;; 241: `PERFORM pg_advisory_xact_lock(` — || trim(to_char(v_completion_fee_percent, 'FM990.00')) || '%）'; IF v_fee_amount > 0 THEN v_fee_key := 'completion_fee:' || v_match.id::text; PERFORM pg_advisory_xact_lock(; 281: `FOR UPDATE;` — v_fee_charged := true; ELSE SELECT u.coin_balance INTO v_balance FROM public.users u WHERE u.id = v_payer_user_id FOR UPDATE;

### `complete_stripe_coin_purchase(uuid,text,text,integer,text)`

ロック取得：27: `FOR UPDATE;` — RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が不正です'); END IF; SELECT * INTO v_order FROM public.payment_orders WHERE id = p_order_id FOR UPDATE;; 70: `FOR UPDATE;` —  Serialize fulfillment against account-status changes that update this row. SELECT COALESCE(coin_balance, 0), account_status INTO v_balance, v_account_status FROM public.users WHERE id = v_order.payer_user_id FOR UPDATE;

### `configured_coin_fee(text,integer)`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし

### `configured_lesson_fee(integer)`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし

### `create_band_with_leader(uuid,text,text)`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし

### `create_facility_invitation_with_coins(uuid,uuid,uuid,text)`

ロック取得：21: `FOR UPDATE OF pr;` — INTO v_request_status FROM public.performance_requests pr INNER JOIN public.facilities f ON f.id = pr.facility_id WHERE pr.id = p_request_id AND f.user_id = p_facility_user_id FOR UPDATE OF pr;
内部routine呼出し：spend_coins

### `create_lesson_offer_with_levels_and_address(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[],text)`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし
内部routine呼出し：create_lesson_offer

### `create_lesson_offer_with_levels(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし
内部routine呼出し：create_lesson_offer

### `create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)`

ロック取得：64: `FOR UPDATE;` — END IF; SELECT u.coin_balance INTO v_balance FROM public.users AS u WHERE u.id = v_user_id FOR UPDATE;
内部routine呼出し：configured_lesson_fee

### `create_review_with_reward(uuid,uuid,uuid,integer,text)`

ロック取得：40: `FOR UPDATE OF m;` — ON p.id = m.performer_id JOIN public.performance_requests pr ON pr.id = m.request_id JOIN public.facilities f ON f.id = pr.facility_id WHERE m.id = p_match_id FOR UPDATE OF m;; 119: `FOR UPDATE;` —  -- 残高をロック SELECT COALESCE(coin_balance, 0) INTO v_balance FROM public.users WHERE id = v_reward_user_id FOR UPDATE;

### `digest(text,text)`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし

### `disband_band(uuid,uuid)`

ロック取得：21: `FOR UPDATE;` —  -- バンドをロックし、同時実行による競合を防ぐ SELECT b.status INTO v_status FROM public.bands b WHERE b.id = p_band_id FOR UPDATE;

### `manage_completion_dispute_case(uuid,text,text,text)`

ロック取得：42: `FOR UPDATE;` —  -- 合意解決関数とロック順を統一するため、matchを先にロック SELECT * INTO v_match FROM public.matches WHERE id = v_match_id FOR UPDATE;; 53: `FOR UPDATE;` —  -- 続いて案件をロック SELECT * INTO v_case FROM public.completion_dispute_admin_cases WHERE id = p_case_id FOR UPDATE;

### `manage_stripe_payment_incident(uuid,text,text,text)`

ロック取得：21: `FOR UPDATE;` — RETURN jsonb_build_object('success', false, 'errorMessage', '入力内容が不正です'); END IF; SELECT * INTO v_incident FROM public.stripe_payment_incidents WHERE id = p_incident_id FOR UPDATE;

### `prevent_disputed_match_cancellation()`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし

### `register_completion_dispute(uuid,text,text,uuid)`

ロック取得：34: `FOR UPDATE;` —  -- 対象マッチングをロック SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;

### `reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)`

ロック取得：39: `FOR UPDATE OF pr;` — SELECT f.user_id INTO v_facility_user_id FROM public.performance_requests pr JOIN public.facilities f ON f.id = pr.facility_id WHERE pr.id = v_request_id FOR UPDATE OF pr;; 81: `FOR UPDATE;` —  -- 2. 施設ユーザーの残高行をロック SELECT u.coin_balance INTO v_balance FROM public.users u WHERE u.id = v_facility_user_id FOR UPDATE;; 101: `FOR UPDATE;` — a.source, a.status INTO v_app FROM public.applications a WHERE a.id = p_application_id AND a.request_id = v_request_id FOR UPDATE;; 124: `PERFORM pg_advisory_xact_lock(` —  v_refund_amount := -v_fee.amount; v_refund_key := 'direct_invite_refund:' || v_app.id::text; -- 4. 返金キーをロック PERFORM pg_advisory_xact_lock(

### `reject_direct_invitation_with_refund(uuid,uuid)`

ロック取得：54: `FOR UPDATE OF pr;` — v_request_status, v_facility_user_id FROM public.performance_requests pr JOIN public.facilities f ON f.id = pr.facility_id WHERE pr.id = v_request_id FOR UPDATE OF pr;; 102: `FOR UPDATE;` —  -- 2. 施設ユーザーの残高行をロック SELECT u.coin_balance INTO v_balance FROM public.users u WHERE u.id = v_facility_user_id FOR UPDATE;; 122: `FOR UPDATE;` — a.source, a.status INTO v_app FROM public.applications a WHERE a.id = p_application_id AND a.request_id = v_request_id FOR UPDATE;; 145: `PERFORM pg_advisory_xact_lock(` —  v_refund_amount := -v_fee.amount; v_refund_key := 'direct_invite_refund:' || v_app.id::text; -- 4. 返金キーをロックして二重返金を防止 PERFORM pg_advisory_xact_lock(

### `respond_to_band_invitation(uuid,uuid,text)`

ロック取得：40: `FOR UPDATE;` —  -- ② ユーザー行を先にロック（退会処理と順序を統一） SELECT u.account_status, u.user_type INTO v_account_status, v_user_type FROM public.users AS u WHERE u.id = v_user_id FOR UPDATE;; 69: `FOR UPDATE;` —  -- ④ バンドをロック SELECT b.status INTO v_band_status FROM public.bands AS b WHERE b.id = v_prelock_band_id FOR UPDATE;; 80: `FOR UPDATE;` —  -- ⑤ 招待をロック SELECT bi.* INTO invitation_row FROM public.band_invitations AS bi WHERE bi.id = p_invitation_id FOR UPDATE;

### `set_initial_coin_balance()`

ロック取得：明示的なFOR UPDATE／FOR SHARE／pg_advisory_xact_lockなし
内部routine呼出し：digest

### `spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)`

ロック取得：24: `PERFORM pg_advisory_xact_lock(` — RETURN QUERY SELECT false, NULL::integer, 'コイン消費の指定が正しくありません'::text; RETURN; END IF; PERFORM pg_advisory_xact_lock(; 56: `FOR UPDATE;` —  -- ユーザー残高をロックして取得 SELECT u.coin_balance INTO v_current_balance FROM public.users u WHERE u.id = p_user_id FOR UPDATE;

### `spend_coins(uuid,integer,text,text,text,uuid,uuid,uuid)`

ロック取得：27: `PERFORM pg_advisory_xact_lock(` — false, NULL::integer, 'コイン消費の指定が正しくありません'::text; RETURN; END IF; PERFORM pg_advisory_xact_lock(
内部routine呼出し：configured_coin_fee, spend_coins_legacy

### `submit_band_application_idempotent(uuid,uuid,uuid,uuid,uuid,text)`

ロック取得：24: `PERFORM pg_advisory_xact_lock(hashtextextended('application-operation:' || p_operation_id::text, 0));` — er_id', p_performer_id, 'band_id', p_band_id, 'request_id', p_request_id, 'message', COALESCE(p_message, '') )::text); PERFORM pg_advisory_xact_lock(hashtextextended('application-operation:' || p_operation_id::text, 0));; 29: `FOR UPDATE;` —  PERFORM pg_advisory_xact_lock(hashtextextended('application-operation:' || p_operation_id::text, 0)); SELECT * INTO v_existing FROM public.idempotency_operations WHERE operation_id = p_operation_id FOR UPDATE;
内部routine呼出し：apply_to_performance_request_as_band

### `submit_personal_application_idempotent(uuid,uuid,uuid,uuid,text)`

ロック取得：23: `PERFORM pg_advisory_xact_lock(hashtextextended('application-operation:' || p_operation_id::text, 0));` — build_object( 'request_id', p_request_id, 'performer_id', p_performer_id, 'message', COALESCE(p_message, '') )::text); PERFORM pg_advisory_xact_lock(hashtextextended('application-operation:' || p_operation_id::text, 0));; 28: `FOR UPDATE;` —  PERFORM pg_advisory_xact_lock(hashtextextended('application-operation:' || p_operation_id::text, 0)); SELECT * INTO v_existing FROM public.idempotency_operations WHERE operation_id = p_operation_id FOR UPDATE;
内部routine呼出し：apply_to_performance_request

### `transfer_band_coins(uuid,uuid,uuid,integer,text,text)`

ロック取得：64: `PERFORM pg_advisory_xact_lock(` — 'band_transfer:' || p_idempotency_key || ':sender'; v_recipient_key := 'band_transfer:' || p_idempotency_key || ':recipient'; -- 同じ送金リクエストの同時実行を防ぐ PERFORM pg_advisory_xact_lock(; 133: `FOR SHARE;` —  -- バンドが活動中であることを確認 SELECT b.status INTO v_band_status FROM public.bands b WHERE b.id = p_band_id FOR SHARE;; 152: `FOR SHARE OF bm;` — FROM public.band_members bm JOIN public.performers p ON p.id = bm.performer_id WHERE bm.band_id = p_band_id AND p.user_id = p_sender_user_id AND bm.status = 'active' FOR SHARE OF bm;; 171: `FOR SHARE OF bm;` — FROM public.band_members bm JOIN public.performers p ON p.id = bm.performer_id WHERE bm.band_id = p_band_id AND p.user_id = p_recipient_user_id AND bm.status = 'active' FOR SHARE OF bm;; 187: `FOR UPDATE;` — -- 2人の残高をUUID順にロックし、同時送金の競合を軽減 IF p_sender_user_id < p_recipient_user_id THEN SELECT u.coin_balance INTO v_sender_balance FROM public.users u WHERE u.id = p_sender_user_id FOR UPDATE;; 193: `FOR UPDATE;` — FOR UPDATE; SELECT u.coin_balance INTO v_recipient_balance FROM public.users u WHERE u.id = p_recipient_user_id FOR UPDATE;; 199: `FOR UPDATE;` — FOR UPDATE; ELSE SELECT u.coin_balance INTO v_recipient_balance FROM public.users u WHERE u.id = p_recipient_user_id FOR UPDATE;; 205: `FOR UPDATE;` — FOR UPDATE; SELECT u.coin_balance INTO v_sender_balance FROM public.users u WHERE u.id = p_sender_user_id FOR UPDATE;

### `update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])`

ロック取得：58: `FOR UPDATE OF lo;` — ved_coins INTO v_user_id, v_status, v_current_reserved FROM public.lesson_offers AS lo JOIN public.performers AS p ON p.id = lo.performer_id WHERE lo.id = p_offer_id AND lo.performer_id = p_performer_id FOR UPDATE OF lo;; 78: `FOR UPDATE;` — END IF; SELECT u.coin_balance INTO v_balance FROM public.users AS u WHERE u.id = v_user_id FOR UPDATE;
内部routine呼出し：configured_lesson_fee

### `withdraw_user_account(text)`

ロック取得：30: `FOR UPDATE;` — -- 退会対象ユーザーをロック SELECT * INTO v_user FROM public.users WHERE line_user_id = p_line_user_id AND account_status = 'active' FOR UPDATE;; 42: `FOR UPDATE;` — -- プロフィールIDと演奏者名を取得 IF v_user.user_type = 'performer' THEN SELECT id, name INTO v_performer_id, v_performer_name FROM public.performers WHERE user_id = v_user.id FOR UPDATE;; 53: `FOR UPDATE;` —  ELSIF v_user.user_type = 'facility' THEN SELECT id INTO v_facility_id FROM public.facilities WHERE user_id = v_user.id FOR UPDATE;; 163: `FOR UPDATE OF m` — ARRAY[]::uuid[] ) @> ARRAY[v_performer_id]::uuid[] ) ) ) ORDER BY m.matched_at FOR UPDATE OF m
内部routine呼出し：digest, cancel_match_with_direct_invite_refund

## ドメイン横断で先取りが必要なgate候補

| ドメイン | 関連routine・状態 | 事前収集と再検証が必要な理由 |
|---|---|---|
| request | 応募、採用、直接招待、キャンセル、完了、異議、募集編集・削除、退会 | match/applicationからrequestを逆引きする入口があり、無ロック読取→gate→再検証が必要 |
| band | バンド応募、招待応答、解散、バンドコイン移動、退会 | requestとbandの双方を更新する処理があり、band→user／user→bandの逆順を解消する必要 |
| lesson offer | レッスン応募、募集作成・編集、コイン予約、退会 | offer→userとuser→offerが混在。レッスン停止中でも退会処理との競合は残る |
| payment order | Stripe購入完了・Webhook・管理操作 | order／incident／user残高／ledgerの順序とWebhook claim fencingが必要。購入停止を維持し、別領域として扱う |
| user/account | 退会、コイン残高、返金、プロフィール、band transfer | 複数ドメイン横断。user行を先に取る入口が他ドメインと循環する |
| operation/idempotency | 応募操作、coin spend/refund、band transfer、Stripe event | advisory keyを途中で取得するnested callがある。キー順序と公開入口での先取りが未統一 |

## 実装前に解消する具体的な循環

1. `complete_match_with_fee`: match → request → coin idempotency → user。cancel系はrequest → user → match/application → refund idempotency。match/requestの循環が成立する。
2. `withdraw_user_account`: user → profile → match → nested `cancel_match_with_direct_invite_refund`。nested cancelはrequestを先に取得するため、退会とcancelの相互待ちが成立する。
3. `respond_to_band_invitation`: user → band → invitation。band関連応募／解散／transfer側のband→user順と逆転する。
4. `apply_to_lesson_offer`／`update_lesson_offer_with_levels`: offer → user。退会はuserを先に取ってofferを更新するため逆転する。
5. `spend_coins`／`spend_coins_legacy`: advisory idempotency → user。呼出元の中にはrequest/application/band等を既にロックしてからspend_coinsへ進むものがあるため、coin keyをnested helperだけで先取りする設計は不十分。

## 次の実装単位（安全な一括切替）

1. 37 routineの完全定義に加え、API routeの直接書込、trigger、Cron／Edge Function／外部schedulerを含むmutation入口一覧を確定する。
2. 各入口で必要なaggregate IDとidempotency keyを非ロック読取で収集する。
3. 全入口共通の固定ドメイン順位＋ID昇順でadvisory gateを先取りし、対象集合・所有権・状態を再検証する。
4. gate取得後の行ロックをテーブル順位＋主キー昇順へ統一する。内部helperはgateを取らない`*_internal_no_gate`へ分離し、gate後取りを禁止する。
5. application rejected遷移、once料金、返金台帳、Outbox insertを同一transactionへまとめる。
6. API直接更新を新public RPCへ切り替え、DB直書きの迂回を閉じる。
7. preflight／postflight／rollback SQLをTokyo現行定義とACLに合わせて生成し、テストDBの同時実行シナリオを通してから個別承認を得る。

## この時点で実装しないもの

- request gate単独追加、`complete_match_with_fee`だけの順序変更、退会関数だけの順序変更など、部分導入。
- 既存の006／007／005候補の適用。
- Stripeコイン購入の有効化。
- Lesson機能の再有効化。

## 変更境界

- 作業用パッケージ内にこの監査文書のみ追加。
- Supabase Mumbai／Tokyo、実リポジトリ、GitHub、Vercelは変更していない。
- SQL実行、build／lint／test／typecheck／ローカルチェック、commit／push／deployは実施していない。
- 公開判定：BLOCKED。安全な一括切替SQLとAPI差し替えが完成するまで公開可とは判定しない。
