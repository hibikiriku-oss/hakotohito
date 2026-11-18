-- Hakotohito: known audit fixes (based on DB snapshot 2026-11-11)
-- Confirm live function signatures and matches.participant_count before applying.
BEGIN;
CREATE OR REPLACE FUNCTION public.cancel_match_with_direct_invite_refund(p_match_id uuid, p_facility_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_match public.matches%ROWTYPE;
  v_application public.applications%ROWTYPE;

  v_facility_user_id uuid;
  v_request_facility_id uuid;
  v_request_type text;
  v_request_status text;

  v_balance integer;
  v_refund_amount integer := 0;
  v_direct_fee_refund_amount integer := 0;
  v_match_fee_refund_amount integer := 0;
  v_fee_refund_amount integer := 0;
  v_active_count integer;

  v_direct_refund_key text;
  v_match_refund_key text;
  v_fee_refund_key text;

  v_has_direct_application boolean := false;
  v_has_direct_fee boolean := false;
  v_has_match_fee boolean := false;
  v_has_event_fee boolean := false;

  v_match_fee_application_id uuid;
  v_event_fee_type text;
  v_event_fee_description text;
  v_event boolean;
BEGIN
  -- 事前に案件IDだけ取得。ここではロックしない
  SELECT m.request_id
  INTO v_request_id
  FROM public.matches m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'マッチングが見つかりません'
    );
  END IF;

  -- 1. 案件を最初にロック
  SELECT
    pr.request_type,
    pr.status,
    pr.facility_id
  INTO
    v_request_type,
    v_request_status,
    v_request_facility_id
  FROM public.performance_requests pr
  WHERE pr.id = v_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '案件が見つかりません'
    );
  END IF;

  IF v_request_facility_id IS DISTINCT FROM p_facility_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'この案件をキャンセルする権限がありません'
    );
  END IF;

  -- 2. 施設ユーザーを確認
  SELECT f.user_id
  INTO v_facility_user_id
  FROM public.facilities f
  WHERE f.id = p_facility_id;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '施設ユーザーが見つかりません'
    );
  END IF;

  -- 3. 施設ユーザー残高をロック
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '施設ユーザーのコイン情報が見つかりません';
  END IF;

  -- 4. マッチングをロック
  SELECT m.*
  INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.request_id = v_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'マッチングが見つかりません'
    );
  END IF;

  -- ロック取得後に状態を再確認
  IF v_match.status = 'cancelled'
     OR v_match.performance_status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'このマッチングはすでにキャンセルされています'
    );
  END IF;

  IF v_match.performance_status = 'completed'
     OR v_match.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '演奏完了後のマッチングはキャンセルできません'
    );
  END IF;

  -- APIの事前確認だけに依存せず、ロック取得後のDB状態で紛争中を拒否する。
  IF v_match.completion_disputed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '異議申し立ての対応が完了するまでキャンセルできません'
    );
  END IF;

  IF v_match.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'このマッチングは現在キャンセルできません'
    );
  END IF;

  v_event := v_request_type IN (
    'live', 'festival', 'session', 'rental'
  );

  -- 5. 直接依頼の応募を特定してロック
  v_application := NULL;
  v_has_direct_application := false;

  IF v_match.application_id IS NOT NULL THEN
    SELECT a.*
    INTO v_application
    FROM public.applications a
    WHERE a.id = v_match.application_id
      AND a.request_id = v_request_id
      AND a.source = 'facility_invite'
    FOR UPDATE;

    IF FOUND THEN
      v_has_direct_application := true;
    END IF;
  END IF;

  IF v_has_direct_application THEN
    v_direct_refund_key :=
      'direct_invite_refund:' || v_application.id::text;

    -- 元の直接依頼手数料を厳密に特定
    SELECT -ct.amount
    INTO v_direct_fee_refund_amount
    FROM public.coin_transactions ct
    WHERE ct.application_id = v_application.id
      AND ct.request_id = v_request_id
      AND ct.user_id = v_facility_user_id
      AND ct.transaction_type = 'direct_invite_fee'
      AND ct.amount < 0
      AND ct.idempotency_key =
        'direct_invite_fee:'
        || v_request_id::text
        || ':'
        || v_application.performer_id::text
    ORDER BY ct.created_at
    LIMIT 1;

    v_has_direct_fee :=
      COALESCE(v_direct_fee_refund_amount, 0) > 0;
  ELSE
    v_direct_refund_key := NULL;
    v_direct_fee_refund_amount := 0;
    v_has_direct_fee := false;
  END IF;

  -- 6. マッチング成立手数料の実際の引き落とし額
  SELECT
    ct.application_id,
    -ct.amount
  INTO
    v_match_fee_application_id,
    v_match_fee_refund_amount
  FROM public.coin_transactions ct
  WHERE ct.match_id = v_match.id
    AND ct.user_id = v_facility_user_id
    AND ct.transaction_type = 'match_fee'
    AND ct.amount < 0
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_event THEN
    v_match_refund_key := NULL;
    v_has_match_fee := false;

    IF v_request_type = 'rental' THEN
      v_event_fee_type := 'rental_match_fee';
      v_event_fee_description := 'レンタル料手数料の返金';
      v_fee_refund_key :=
        'rental_match_refund:' || v_match.id::text;
    ELSE
      v_event_fee_type := 'event_participation_fee';
      v_event_fee_description := 'イベント参加手数料の返金';
      v_fee_refund_key :=
        'event_participation_refund:' || v_match.id::text;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.match_id = v_match.id
        AND ct.user_id = v_facility_user_id
        AND ct.transaction_type = v_event_fee_type
        AND ct.amount < 0
    )
    INTO v_has_event_fee;
  ELSE
    v_match_refund_key :=
      CASE
        WHEN v_has_direct_application AND v_has_direct_fee
          THEN 'direct_invite_match_refund:' || v_match.id::text
        ELSE 'match_fee_refund:' || v_match.id::text
      END;

    v_has_match_fee :=
      COALESCE(v_match_fee_refund_amount, 0) > 0;

    v_fee_refund_key := NULL;
    v_has_event_fee := false;
  END IF;

  -- 7. 直接依頼の送信手数料を返金
  IF v_has_direct_fee THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_direct_refund_key, 0)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_direct_refund_key
    ) THEN
      UPDATE public.users
      SET coin_balance =
        COALESCE(coin_balance, 0) + v_direct_fee_refund_amount
      WHERE id = v_facility_user_id
      RETURNING coin_balance INTO v_balance;

      INSERT INTO public.coin_transactions (
        user_id, amount, transaction_type, description,
        balance_after, request_id, application_id,
        match_id, idempotency_key
      )
      VALUES (
        v_facility_user_id,
        v_direct_fee_refund_amount,
        'admin_adjustment',
        '直接依頼のマッチングキャンセルによる直接依頼手数料返金',
        v_balance,
        v_match.request_id,
        v_application.id,
        v_match.id,
        v_direct_refund_key
      );

      v_refund_amount :=
        v_refund_amount + v_direct_fee_refund_amount;
    END IF;
  END IF;

  -- 8. 通常案件の成立手数料を返金
  IF NOT v_event AND v_has_match_fee THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_match_refund_key, 0)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_match_refund_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.match_id = v_match.id
        AND ct.amount > 0
        AND ct.transaction_type = 'admin_adjustment'
        AND ct.description LIKE '%成立手数料返金%'
    ) THEN
      UPDATE public.users
      SET coin_balance =
        COALESCE(coin_balance, 0) + v_match_fee_refund_amount
      WHERE id = v_facility_user_id
      RETURNING coin_balance INTO v_balance;

      INSERT INTO public.coin_transactions (
        user_id, amount, transaction_type, description,
        balance_after, request_id, application_id,
        match_id, idempotency_key
      )
      VALUES (
        v_facility_user_id,
        v_match_fee_refund_amount,
        'admin_adjustment',
        'マッチングキャンセルによる成立手数料返金',
        v_balance,
        v_match.request_id,
        CASE
          WHEN v_has_direct_application THEN v_application.id
          ELSE v_match_fee_application_id
        END,
        v_match.id,
        v_match_refund_key
      );

      v_refund_amount :=
        v_refund_amount + v_match_fee_refund_amount;
    END IF;
  END IF;

  -- 9. イベント・レンタルの参加費を返金
  IF v_event AND v_has_event_fee THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_fee_refund_key, 0)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_fee_refund_key
    ) THEN
      SELECT -ct.amount
      INTO v_fee_refund_amount
      FROM public.coin_transactions ct
      WHERE ct.match_id = v_match.id
        AND ct.request_id = v_request_id
        AND ct.user_id = v_facility_user_id
        AND ct.transaction_type = v_event_fee_type
        AND ct.amount < 0
      ORDER BY ct.created_at
      LIMIT 1;

      IF COALESCE(v_fee_refund_amount, 0) > 0 THEN
        UPDATE public.users
        SET coin_balance =
          COALESCE(coin_balance, 0) + v_fee_refund_amount
        WHERE id = v_facility_user_id
        RETURNING coin_balance INTO v_balance;

        INSERT INTO public.coin_transactions (
          user_id, amount, transaction_type, description,
          balance_after, request_id, application_id,
          match_id, idempotency_key
        )
        VALUES (
          v_facility_user_id,
          v_fee_refund_amount,
          'admin_adjustment',
          v_event_fee_description,
          v_balance,
          v_match.request_id,
          CASE
            WHEN v_has_direct_application THEN v_application.id
            ELSE v_match.application_id
          END,
          v_match.id,
          v_fee_refund_key
        );

        v_refund_amount :=
          v_refund_amount + v_fee_refund_amount;
      END IF;
    END IF;
  END IF;

-- 10. マッチングをキャンセルし、採用済み応募を再応募可能な状態へ戻す
  UPDATE public.matches
  SET status = 'cancelled',
      performance_status = 'cancelled'
  WHERE id = v_match.id;

  IF v_match.application_id IS NOT NULL THEN
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_match.application_id
      AND status = 'accepted';
  END IF;

  -- 11. 募集状態を更新
  -- 手動で closed にした募集は再開しない
  IF v_request_status IS DISTINCT FROM 'closed' THEN
    IF v_event THEN
      SELECT COUNT(*)::integer
      INTO v_active_count
      FROM public.matches m
      WHERE m.request_id = v_match.request_id
        AND m.status = 'active'
        AND m.performance_status IS DISTINCT FROM 'cancelled';

      UPDATE public.performance_requests
      SET status = CASE
        WHEN v_active_count > 0 THEN 'matched'
        ELSE 'open'
      END
      WHERE id = v_match.request_id;
    ELSE
      UPDATE public.performance_requests
      SET status = 'open'
      WHERE id = v_match.request_id;
    END IF;
  END IF;

  -- 12. 最新残高
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'matchId', v_match.id,
    'refundAmount', v_refund_amount,
    'balanceAfter', v_balance,
    'errorMessage', NULL
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.accept_direct_invitation_atomic(p_application_id uuid, p_performer_id uuid)
 RETURNS TABLE(success boolean, match_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_request_status text;
  v_request_type text;
  v_max_participants integer;
  v_facility_user_id uuid;
  v_application_performer_id uuid;
  v_application_source text;
  v_application_status text;
  v_match_id uuid;
  v_updated_count integer;
  v_active_count integer;
  v_coin_result record;
  v_idempotency_key text;
  v_event boolean;
  v_first_event_match boolean;
BEGIN
  -- 案件をロックして取得
  SELECT
    pr.id,
    pr.status,
    pr.request_type,
    pr.max_participants,
    f.user_id
  INTO
    v_request_id,
    v_request_status,
    v_request_type,
    v_max_participants,
    v_facility_user_id
  FROM public.applications a
  JOIN public.performance_requests pr
    ON pr.id = a.request_id
  JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE a.id = p_application_id
  FOR UPDATE OF pr;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      '案件または施設情報が見つかりません'::text;
    RETURN;
  END IF;

  v_event := v_request_type IN (
    'live', 'festival', 'session', 'rental'
  );

  -- 募集状態を確認
  IF v_event THEN
    IF v_request_status NOT IN ('open', 'matched') THEN
      RETURN QUERY SELECT
        false, NULL::uuid,
        'この募集は終了しています'::text;
      RETURN;
    END IF;
  ELSE
    IF v_request_status <> 'open' THEN
      RETURN QUERY SELECT
        false, NULL::uuid,
        'この募集は終了しています'::text;
      RETURN;
    END IF;
  END IF;

  -- 直接依頼の対象者・状態を確認
  SELECT
    a.performer_id,
    a.source,
    a.status
  INTO
    v_application_performer_id,
    v_application_source,
    v_application_status
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.request_id = v_request_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_application_performer_id <> p_performer_id THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      '依頼が見つかりません'::text;
    RETURN;
  END IF;

  IF v_application_source <> 'facility_invite' THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      '直接依頼ではありません'::text;
    RETURN;
  END IF;

  IF v_application_status <> 'pending' THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      'この依頼はすでに処理されています'::text;
    RETURN;
  END IF;

  -- 同じ演奏者の有効なマッチングを防止
  IF EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.request_id = v_request_id
      AND m.performer_id = p_performer_id
      AND m.status = 'active'
  ) THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      'この演奏者はすでにマッチング済みです'::text;
    RETURN;
  END IF;

  -- イベント・レンタルは定員を確認
  IF v_event THEN
    SELECT COALESCE(SUM(GREATEST(COALESCE(m.participant_count, 1), 1)), 0)::integer
    INTO v_active_count
    FROM public.matches m
    WHERE m.request_id = v_request_id
      AND m.status = 'active'
      AND m.performance_status IS DISTINCT FROM 'cancelled';

    IF v_max_participants IS NOT NULL
       AND v_active_count >= v_max_participants THEN
      UPDATE public.performance_requests
      SET status = 'matched'
      WHERE id = v_request_id;

      RETURN QUERY SELECT
        false, NULL::uuid,
        '募集定員に達しています'::text;
      RETURN;
    END IF;
  ELSE
    -- 通常案件は1人のみ
    IF EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.request_id = v_request_id
        AND m.status = 'active'
    ) THEN
      RETURN QUERY SELECT
        false, NULL::uuid,
        'この案件はすでにマッチング済みです'::text;
      RETURN;
    END IF;
  END IF;

  -- 新規マッチングを作成
  -- application_id に承諾した直接依頼のIDを保存する
  INSERT INTO public.matches (
    request_id,
    application_id,
    performer_id,
    status,
    completion_fee_eligible
  )
  VALUES (
    v_request_id,
    p_application_id,
    p_performer_id,
    'active',
    true
  )
  RETURNING id INTO v_match_id;

  UPDATE public.applications
  SET status = 'accepted'
  WHERE id = p_application_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION
      '承諾した依頼の状態を更新できませんでした';
  END IF;

  IF v_event THEN
    -- イベントは定員到達時のみ募集を終了
    SELECT COALESCE(SUM(GREATEST(COALESCE(m.participant_count, 1), 1)), 0)::integer
    INTO v_active_count
    FROM public.matches m
    WHERE m.request_id = v_request_id
      AND m.status = 'active'
      AND m.performance_status IS DISTINCT FROM 'cancelled';

    IF v_max_participants IS NOT NULL
       AND v_active_count >= v_max_participants THEN
      UPDATE public.performance_requests
      SET status = 'matched'
      WHERE id = v_request_id;
    END IF;

    -- 初回成立料100コインは案件につき1回
    v_idempotency_key :=
      'event_match_fee:' || v_request_id::text;

    SELECT NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_idempotency_key
    )
    INTO v_first_event_match;

    IF v_first_event_match THEN
      SELECT *
      INTO v_coin_result
      FROM public.spend_coins(
        v_facility_user_id,
        100,
        'match_fee',
        'イベント・レンタル初回マッチング成立手数料',
        v_idempotency_key,
        v_request_id,
        p_application_id,
        v_match_id
      );

      IF NOT COALESCE(v_coin_result.success, false) THEN
        RAISE EXCEPTION '%',
          COALESCE(
            v_coin_result.error_message,
            '施設側のコインが不足しています'
          );
      END IF;
    END IF;

    -- 参加費・レンタル料の1%は
    -- 演奏完了時に徴収するため、ここでは徴収しない。

  ELSE
    -- 通常案件：他の応募・依頼を却下して募集終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE request_id = v_request_id
      AND status = 'pending'
      AND id <> p_application_id;

    UPDATE public.performance_requests
    SET status = 'matched'
    WHERE id = v_request_id
      AND status = 'open';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count <> 1 THEN
      RAISE EXCEPTION
        '案件の状態をmatchedに更新できませんでした';
    END IF;

    -- 通常案件の成立手数料100コインは維持
    v_idempotency_key :=
      'match_fee:' || v_request_id::text ||
      ':' || p_application_id::text;

    SELECT *
    INTO v_coin_result
    FROM public.spend_coins(
      v_facility_user_id,
      100,
      'match_fee',
      'マッチング成立手数料',
      v_idempotency_key,
      v_request_id,
      p_application_id,
      v_match_id
    );

    IF NOT COALESCE(v_coin_result.success, false) THEN
      RAISE EXCEPTION '%',
        COALESCE(
          v_coin_result.error_message,
          '施設側のコインが不足しています'
        );
    END IF;

    -- 施設負担の謝礼1%は演奏完了時に徴収する。
  END IF;

  RETURN QUERY SELECT
    true,
    v_match_id,
    NULL::text;
END;
$function$

COMMIT;


-- 退会RPCの置換は別バッチへ分離。旧候補はdual-role・ロック順序・手数料履歴なしの
-- pending invite処理が未解決のため、このmigrationでは適用しない。
