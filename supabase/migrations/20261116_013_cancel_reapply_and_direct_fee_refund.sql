-- Preserve direct-invite refunds after deferred charging; reopen individual applications.
-- Depends on migrations 009-012. Candidate only.
BEGIN;

-- Serialize this migration with every application mutation using the shared gate.
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$ BEGIN IF to_regclass('public.application_attempts') IS NULL OR to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN RAISE EXCEPTION 'Apply migrations 009 and 010 first'; END IF; END; $preflight$;

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
  v_attempt_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

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
    -- 新方式はattempt_id単位で返金キーを分離し、同じ応募行の再依頼でも
    -- 過去の返金履歴に阻まれないようにする。旧方式は従来キーを維持する。
    SELECT aa.id INTO v_attempt_id
    FROM public.application_attempts aa
    WHERE aa.match_id = v_match.id
      AND aa.application_id = v_application.id
      AND aa.source = 'facility_invite'
      AND aa.fee_type = 'direct_invite_fee'
    ORDER BY aa.matched_at DESC NULLS LAST, aa.started_at DESC
    LIMIT 1;

    IF v_attempt_id IS NOT NULL THEN
      v_direct_refund_key :=
        'direct_invite_refund_attempt:' || v_attempt_id::text;

      SELECT -ct.amount
      INTO v_direct_fee_refund_amount
      FROM public.coin_transactions ct
      WHERE ct.application_id = v_application.id
        AND ct.match_id = v_match.id
        AND ct.request_id = v_request_id
        AND ct.user_id = v_facility_user_id
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
      ORDER BY ct.created_at DESC
      LIMIT 1;

      IF NOT FOUND THEN
        -- 既存方式では依頼作成時に徴収しmatch_idがNULLのため旧キーで照合する。
        v_direct_refund_key := 'direct_invite_refund:' || v_application.id::text;
        SELECT -ct.amount
        INTO v_direct_fee_refund_amount
        FROM public.coin_transactions ct
        WHERE ct.application_id = v_application.id
          AND ct.request_id = v_request_id
          AND ct.user_id = v_facility_user_id
          AND ct.transaction_type = 'direct_invite_fee'
          AND ct.amount < 0
          AND ct.idempotency_key = 'direct_invite_fee:' || v_request_id::text || ':' ||
            v_application.performer_id::text
        ORDER BY ct.created_at
        LIMIT 1;
      END IF;
    ELSE
      v_direct_refund_key :=
        'direct_invite_refund:' || v_application.id::text;

      SELECT -ct.amount
      INTO v_direct_fee_refund_amount
      FROM public.coin_transactions ct
      WHERE ct.application_id = v_application.id
        AND ct.request_id = v_request_id
        AND ct.user_id = v_facility_user_id
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.idempotency_key =
          'direct_invite_fee:' || v_request_id::text || ':' ||
          v_application.performer_id::text
      ORDER BY ct.created_at
      LIMIT 1;
    END IF;

    v_has_direct_fee := COALESCE(v_direct_fee_refund_amount, 0) > 0;
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

  -- 10. マッチングをキャンセル
  UPDATE public.matches
  SET status = 'cancelled',
      performance_status = 'cancelled'
  WHERE id = v_match.id;

  -- 個別キャンセル後は応募を却下状態へ戻し、再応募可能にする。
  IF v_match.application_id IS NOT NULL THEN
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_match.application_id
      AND status = 'accepted';

    UPDATE public.application_attempts
    SET status = 'cancelled', updated_at = now()
    WHERE match_id = v_match.id
      AND status = 'matched';
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
$function$;

-- Additional pending-invitation and whole-event refund compatibility.
CREATE OR REPLACE FUNCTION public.reject_direct_invitation_with_refund(p_application_id uuid, p_performer_id uuid)
 RETURNS TABLE(success boolean, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_initial_performer_id uuid;
  v_initial_source text;
  v_request_status text;
  v_facility_user_id uuid;

  v_app record;
  v_fee record;

  v_balance integer;
  v_new_balance integer;
  v_refund_key text;
  v_refund_amount integer;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  -- 応募情報を読み取る（まだロックしない）
  SELECT
    a.request_id,
    a.performer_id,
    a.source
  INTO
    v_request_id,
    v_initial_performer_id,
    v_initial_source
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF NOT FOUND
     OR v_initial_performer_id IS DISTINCT FROM p_performer_id
     OR v_initial_source IS DISTINCT FROM 'facility_invite' THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '直接依頼が見つかりません'::text;
    RETURN;
  END IF;

  -- 1. 案件行を最初にロック
  SELECT
    pr.status,
    f.user_id
  INTO
    v_request_status,
    v_facility_user_id
  FROM public.performance_requests pr
  JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE pr.id = v_request_id
  FOR UPDATE OF pr;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '案件または施設ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  IF v_request_status <> 'open' THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      'この案件はすでに締め切られています'::text;
    RETURN;
  END IF;

  -- 元の手数料履歴を取得
  SELECT ct.*
  INTO v_fee
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key =
      'direct_invite_fee:'
      || v_request_id::text
      || ':'
      || p_performer_id::text
    AND ct.transaction_type = 'direct_invite_fee'
    AND ct.amount < 0
    AND ct.application_id = p_application_id;

  IF NOT FOUND THEN
    -- 新方式では依頼時に徴収していない。返金は行わず、依頼と試行だけ却下する。
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = p_application_id
      AND performer_id = p_performer_id
      AND source = 'facility_invite'
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE application_id = p_application_id
      AND source = 'facility_invite'
      AND status = 'pending';

    SELECT u.coin_balance INTO v_balance
    FROM public.users u WHERE u.id = v_facility_user_id;

    RETURN QUERY SELECT true, v_balance, NULL::text;
    RETURN;
  END IF;

  IF v_fee.user_id IS DISTINCT FROM v_facility_user_id THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '手数料の引き落とし元と施設所有者が一致しません'::text;
    RETURN;
  END IF;

  -- 2. 施設ユーザーの残高行をロック
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '施設ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  -- 3. 応募行をロック
  SELECT
    a.id,
    a.request_id,
    a.performer_id,
    a.source,
    a.status
  INTO v_app
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.request_id = v_request_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_app.performer_id IS DISTINCT FROM p_performer_id
     OR v_app.source IS DISTINCT FROM 'facility_invite' THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '直接依頼が見つかりません'::text;
    RETURN;
  END IF;

  IF v_app.status NOT IN ('pending', 'rejected') THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      'この依頼は辞退できない状態です'::text;
    RETURN;
  END IF;

  v_refund_amount := -v_fee.amount;
  v_refund_key :=
    'direct_invite_refund:' || v_app.id::text;

  -- 4. 返金キーをロックして二重返金を防止
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_refund_key, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.coin_transactions ct
    WHERE ct.idempotency_key = v_refund_key
  ) THEN
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_app.id
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE application_id = v_app.id
      AND status = 'pending';

    SELECT u.coin_balance
    INTO v_new_balance
    FROM public.users u
    WHERE u.id = v_facility_user_id;

    RETURN QUERY
    SELECT true, v_new_balance, NULL::text;
    RETURN;
  END IF;

  -- 5. 応募を辞退済みに変更
  UPDATE public.applications
  SET status = 'rejected'
  WHERE id = v_app.id;

  UPDATE public.application_attempts
  SET status = 'rejected', updated_at = now()
  WHERE application_id = v_app.id AND status = 'pending';

  -- 6. 元の徴収額を返金
  v_new_balance := v_balance + v_refund_amount;

  UPDATE public.users
  SET coin_balance = v_new_balance
  WHERE id = v_facility_user_id;

  INSERT INTO public.coin_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    balance_after,
    request_id,
    application_id,
    match_id,
    created_by_user_id,
    idempotency_key
  )
  VALUES (
    v_facility_user_id,
    v_refund_amount,
    'admin_adjustment',
    '直接依頼の辞退による手数料返金',
    v_new_balance,
    v_app.request_id,
    v_app.id,
    NULL,
    v_facility_user_id,
    v_refund_key
  );

  RETURN QUERY
  SELECT true, v_new_balance, NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_direct_invitation_with_refund_for_withdrawal(p_application_id uuid, p_performer_id uuid)
 RETURNS TABLE(success boolean, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_facility_user_id uuid;
  v_app record;
  v_fee record;
  v_balance integer;
  v_new_balance integer;
  v_refund_amount integer;
  v_refund_key text;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  -- 初期情報取得。まだロックしない
  SELECT a.request_id
  INTO v_request_id
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.performer_id = p_performer_id
    AND a.source = 'facility_invite';

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '直接依頼が見つかりません'::text;
    RETURN;
  END IF;

  -- 1. 案件をロック
  SELECT f.user_id
  INTO v_facility_user_id
  FROM public.performance_requests pr
  JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE pr.id = v_request_id
  FOR UPDATE OF pr;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '案件または施設ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  -- 元の手数料履歴を確認
  SELECT ct.*
  INTO v_fee
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key =
      'direct_invite_fee:'
      || v_request_id::text
      || ':'
      || p_performer_id::text
    AND ct.transaction_type = 'direct_invite_fee'
    AND ct.amount < 0
    AND ct.application_id = p_application_id
    AND ct.request_id = v_request_id;

  IF NOT FOUND THEN
    -- 新方式では依頼時に徴収していない。返金は行わず、依頼と試行だけ却下する。
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = p_application_id
      AND performer_id = p_performer_id
      AND source = 'facility_invite'
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE application_id = p_application_id
      AND source = 'facility_invite'
      AND status = 'pending';

    SELECT u.coin_balance INTO v_balance
    FROM public.users u WHERE u.id = v_facility_user_id;

    RETURN QUERY SELECT true, v_balance, NULL::text;
    RETURN;
  END IF;

  IF v_fee.user_id IS DISTINCT FROM v_facility_user_id THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '手数料の引き落とし元と施設所有者が一致しません'::text;
    RETURN;
  END IF;

  -- 2. 施設ユーザーの残高行をロック
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '施設ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  -- 3. 応募行をロック
  SELECT
    a.id,
    a.request_id,
    a.performer_id,
    a.source,
    a.status
  INTO v_app
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.request_id = v_request_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_app.performer_id IS DISTINCT FROM p_performer_id
     OR v_app.source IS DISTINCT FROM 'facility_invite' THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '直接依頼が見つかりません'::text;
    RETURN;
  END IF;

  IF v_app.status NOT IN ('pending', 'rejected') THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      'この依頼は返金対象の状態ではありません'::text;
    RETURN;
  END IF;

  v_refund_amount := -v_fee.amount;
  v_refund_key :=
    'direct_invite_refund:' || v_app.id::text;

  -- 4. 返金キーをロック
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_refund_key, 0)
  );

  -- 既に返金済みなら残高を変えず成功扱い
  IF EXISTS (
    SELECT 1
    FROM public.coin_transactions ct
    WHERE ct.idempotency_key = v_refund_key
  ) THEN
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_app.id
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE application_id = v_app.id
      AND status = 'pending';

    SELECT u.coin_balance
    INTO v_new_balance
    FROM public.users u
    WHERE u.id = v_facility_user_id;

    RETURN QUERY
    SELECT true, v_new_balance, NULL::text;
    RETURN;
  END IF;

  -- 5. 応募を辞退済みにする
  UPDATE public.applications
  SET status = 'rejected'
  WHERE id = v_app.id;

  UPDATE public.application_attempts
  SET status = 'rejected', updated_at = now()
  WHERE application_id = v_app.id AND status = 'pending';

  -- 6. 実際の徴収額を返金
  v_new_balance := v_balance + v_refund_amount;

  UPDATE public.users
  SET coin_balance = v_new_balance
  WHERE id = v_facility_user_id;

  INSERT INTO public.coin_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    balance_after,
    request_id,
    application_id,
    match_id,
    created_by_user_id,
    idempotency_key
  )
  VALUES (
    v_facility_user_id,
    v_refund_amount,
    'admin_adjustment',
    '演奏者退会によるダイレクトオファー手数料返金',
    v_new_balance,
    v_app.request_id,
    v_app.id,
    NULL,
    v_facility_user_id,
    v_refund_key
  );

  RETURN QUERY
  SELECT true, v_new_balance, NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_event_request_with_refund_internal(p_request_id uuid, p_facility_id uuid, p_allow_closed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.performance_requests%ROWTYPE;
  v_facility_user_id uuid;
  v_match public.matches%ROWTYPE;
  v_application public.applications%ROWTYPE;

  v_fee_type text;
  v_fee_refund_key text;
  v_direct_refund_key text;
  v_initial_refund_key text :=
    'event_match_refund:' || p_request_id::text;

  v_balance integer;
  v_refund_amount integer := 0;
  v_fee_refund_amount integer := 0;
  v_direct_refund_amount integer := 0;
  v_direct_fee_amount integer := 0;
  v_initial_refund_amount integer := 0;
  v_initial_fee_amount integer := 0;
  v_pending_direct_refund integer := 0;
  v_cancelled_count integer := 0;
  v_cancelled_match_ids uuid[] := ARRAY[]::uuid[];
  v_has_initial_fee boolean := false;
  v_has_completed_match boolean := false;

  -- 未承認の直接依頼の通知情報
  v_pending_direct_notifications jsonb := '[]'::jsonb;
  v_pending_direct_line_user_id text;
  v_pending_direct_performer_name text;
  v_facility_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  IF p_request_id IS NULL OR p_facility_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '案件IDまたは施設IDが指定されていません'
    );
  END IF;

  -- 1. 案件を最初にロック
  SELECT *
  INTO v_request
  FROM public.performance_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '案件が見つかりません'
    );
  END IF;

  IF v_request.facility_id IS DISTINCT FROM p_facility_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'この案件をキャンセルする権限がありません'
    );
  END IF;

  IF v_request.request_type NOT IN (
    'live', 'festival', 'session', 'rental'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'イベント・レンタル案件のみ全体キャンセルできます'
    );
  END IF;

  IF v_request.status = 'closed'
     AND COALESCE(p_allow_closed, false) IS NOT TRUE
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'この案件はすでに募集終了しています'
    );
  END IF;

  -- 完了済みマッチングの有無を記録
  SELECT EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.request_id = p_request_id
      AND m.status = 'active'
      AND (
        m.performance_status = 'completed'
        OR m.completed_at IS NOT NULL
      )
  )
  INTO v_has_completed_match;

  -- 通常キャンセルでは完了済みがあれば中断
  -- 施設退会時だけ、完了済みを維持して続行
  IF v_has_completed_match
     AND COALESCE(p_allow_closed, false) IS NOT TRUE
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '演奏完了済みのマッチングがあるため全体キャンセルできません'
    );
  END IF;

  SELECT f.user_id, f.name
  INTO v_facility_user_id, v_facility_name
  FROM public.facilities f
  WHERE f.id = p_facility_id;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '施設ユーザーが見つかりません'
    );
  END IF;

  -- 2. 施設ユーザーの残高行をロック
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '施設ユーザーのコイン情報が見つかりません';
  END IF;

  -- 3. 未完了の対象マッチングだけをID順にロック
  PERFORM 1
  FROM public.matches m
  WHERE m.request_id = p_request_id
    AND m.status = 'active'
    AND m.performance_status IS DISTINCT FROM 'cancelled'
    AND m.performance_status IS DISTINCT FROM 'completed'
    AND m.completed_at IS NULL
  ORDER BY m.id
  FOR UPDATE;

  -- 4. 対象応募をID順にロック
  PERFORM 1
  FROM public.applications a
  WHERE a.request_id = p_request_id
  ORDER BY a.id
  FOR UPDATE;

  -- 5. 未完了マッチングだけ返金・キャンセル
  FOR v_match IN
    SELECT m.*
    FROM public.matches m
    WHERE m.request_id = p_request_id
      AND m.status = 'active'
      AND m.performance_status IS DISTINCT FROM 'cancelled'
      AND m.performance_status IS DISTINCT FROM 'completed'
      AND m.completed_at IS NULL
    ORDER BY m.id
  LOOP
    IF v_request.request_type = 'rental' THEN
      v_fee_type := 'rental_match_fee';
      v_fee_refund_key :=
        'rental_match_refund:' || v_match.id::text;
    ELSE
      v_fee_type := 'event_participation_fee';
      v_fee_refund_key :=
        'event_participation_refund:' || v_match.id::text;
    END IF;

    -- 実際の参加手数料だけ返金
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_fee_refund_key, 0)
    );

    v_fee_refund_amount := 0;

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_fee_refund_key
    ) THEN
      SELECT -ct.amount
      INTO v_fee_refund_amount
      FROM public.coin_transactions ct
      WHERE ct.user_id = v_facility_user_id
        AND ct.request_id = p_request_id
        AND ct.match_id = v_match.id
        AND ct.transaction_type = v_fee_type
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
          user_id,
          amount,
          transaction_type,
          description,
          balance_after,
          request_id,
          match_id,
          idempotency_key
        )
        VALUES (
          v_facility_user_id,
          v_fee_refund_amount,
          'admin_adjustment',
          CASE
            WHEN v_request.request_type = 'rental'
              THEN 'レンタル案件全体キャンセルによる手数料返金'
            ELSE 'イベント全体キャンセルによる参加手数料返金'
          END,
          v_balance,
          p_request_id,
          v_match.id,
          v_fee_refund_key
        );

        v_refund_amount :=
          v_refund_amount + v_fee_refund_amount;
      END IF;
    END IF;

    -- 成立済み直接依頼の手数料を確認
    IF v_match.application_id IS NOT NULL THEN
      SELECT a.*
      INTO v_application
      FROM public.applications a
      WHERE a.id = v_match.application_id
        AND a.request_id = p_request_id
        AND a.source = 'facility_invite';

      IF FOUND THEN
        SELECT aa.id INTO v_attempt_id
        FROM public.application_attempts aa
        WHERE aa.match_id = v_match.id
          AND aa.application_id = v_application.id
          AND aa.source = 'facility_invite'
          AND aa.fee_type = 'direct_invite_fee'
        ORDER BY aa.matched_at DESC NULLS LAST, aa.started_at DESC
        LIMIT 1;

        IF v_attempt_id IS NOT NULL THEN
          v_direct_refund_key :=
            'direct_invite_refund_attempt:' || v_attempt_id::text;
        ELSE
          v_direct_refund_key :=
            'direct_invite_refund:' || v_application.id::text;
        END IF;

        PERFORM pg_advisory_xact_lock(
          hashtextextended(v_direct_refund_key, 0)
        );

        v_direct_fee_amount := 0;

        IF NOT EXISTS (
          SELECT 1
          FROM public.coin_transactions ct
          WHERE ct.idempotency_key = v_direct_refund_key
        ) THEN
          IF v_attempt_id IS NOT NULL THEN
            SELECT -ct.amount
            INTO v_direct_fee_amount
            FROM public.coin_transactions ct
            WHERE ct.user_id = v_facility_user_id
              AND ct.request_id = p_request_id
              AND ct.application_id = v_application.id
              AND ct.match_id = v_match.id
              AND ct.transaction_type = 'direct_invite_fee'
              AND ct.amount < 0
            ORDER BY ct.created_at DESC
            LIMIT 1;

            IF NOT FOUND THEN
              v_direct_refund_key := 'direct_invite_refund:' || v_application.id::text;
              SELECT -ct.amount
              INTO v_direct_fee_amount
              FROM public.coin_transactions ct
              WHERE ct.user_id = v_facility_user_id
                AND ct.request_id = p_request_id
                AND ct.application_id = v_application.id
                AND ct.transaction_type = 'direct_invite_fee'
                AND ct.amount < 0
                AND ct.idempotency_key = 'direct_invite_fee:' || p_request_id::text || ':' ||
                  v_application.performer_id::text
              ORDER BY ct.created_at
              LIMIT 1;
            END IF;
          ELSE
            SELECT -ct.amount
            INTO v_direct_fee_amount
            FROM public.coin_transactions ct
            WHERE ct.user_id = v_facility_user_id
              AND ct.request_id = p_request_id
              AND ct.application_id = v_application.id
              AND ct.transaction_type = 'direct_invite_fee'
              AND ct.amount < 0
              AND ct.idempotency_key =
                'direct_invite_fee:' || p_request_id::text || ':' ||
                v_application.performer_id::text
            ORDER BY ct.created_at
            LIMIT 1;
          END IF;

          IF COALESCE(v_direct_fee_amount, 0) > 0 THEN
            UPDATE public.users
            SET coin_balance =
              COALESCE(coin_balance, 0) + v_direct_fee_amount
            WHERE id = v_facility_user_id
            RETURNING coin_balance INTO v_balance;

            INSERT INTO public.coin_transactions (
              user_id,
              amount,
              transaction_type,
              description,
              balance_after,
              request_id,
              application_id,
              match_id,
              idempotency_key
            )
            VALUES (
              v_facility_user_id,
              v_direct_fee_amount,
              'admin_adjustment',
              'イベント全体キャンセルによる直接依頼手数料返金',
              v_balance,
              p_request_id,
              v_application.id,
              v_match.id,
              v_direct_refund_key
            );

            v_refund_amount :=
              v_refund_amount + v_direct_fee_amount;

            v_direct_refund_amount :=
              v_direct_refund_amount + v_direct_fee_amount;
          END IF;
        END IF;
      END IF;
    END IF;

    UPDATE public.matches
    SET
      status = 'cancelled',
      performance_status = 'cancelled'
    WHERE id = v_match.id;

    v_cancelled_match_ids := array_append(v_cancelled_match_ids, v_match.id);

    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_match.application_id AND status = 'accepted';

    UPDATE public.application_attempts
    SET status = 'cancelled', updated_at = now()
    WHERE match_id = v_match.id
      AND status = 'matched';

    v_cancelled_count := v_cancelled_count + 1;
  END LOOP;

  -- 6. 未承認の直接依頼を返金して却下
  FOR v_application IN
    SELECT a.*
    FROM public.applications a
    WHERE a.request_id = p_request_id
      AND a.source = 'facility_invite'
      AND a.status = 'pending'
    ORDER BY a.id
  LOOP
    v_direct_refund_key :=
      'direct_invite_refund:' || v_application.id::text;

    -- 通知先のLINE IDと演奏者名を取得
    v_pending_direct_line_user_id := NULL;
    v_pending_direct_performer_name := NULL;

    SELECT
      u.line_user_id,
      p.name
    INTO
      v_pending_direct_line_user_id,
      v_pending_direct_performer_name
    FROM public.performers p
    JOIN public.users u
      ON u.id = p.user_id
    WHERE p.id = v_application.performer_id
      AND u.account_status = 'active'
      AND u.line_user_id IS NOT NULL
      AND u.line_user_id NOT LIKE 'withdrawn:%';

    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_direct_refund_key, 0)
    );

    v_direct_fee_amount := 0;

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_direct_refund_key
    ) THEN
      SELECT -ct.amount
      INTO v_direct_fee_amount
      FROM public.coin_transactions ct
      WHERE ct.user_id = v_facility_user_id
        AND ct.request_id = p_request_id
        AND ct.application_id = v_application.id
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.idempotency_key =
          'direct_invite_fee:' ||
          p_request_id::text || ':' ||
          v_application.performer_id::text
      ORDER BY ct.created_at
      LIMIT 1;

      IF COALESCE(v_direct_fee_amount, 0) > 0 THEN
        UPDATE public.users
        SET coin_balance =
          COALESCE(coin_balance, 0) + v_direct_fee_amount
        WHERE id = v_facility_user_id
        RETURNING coin_balance INTO v_balance;

        INSERT INTO public.coin_transactions (
          user_id,
          amount,
          transaction_type,
          description,
          balance_after,
          request_id,
          application_id,
          idempotency_key
        )
        VALUES (
          v_facility_user_id,
          v_direct_fee_amount,
          'admin_adjustment',
          '案件全体キャンセルによる未承認直接依頼手数料返金',
          v_balance,
          p_request_id,
          v_application.id,
          v_direct_refund_key
        );

        v_refund_amount :=
          v_refund_amount + v_direct_fee_amount;

        v_direct_refund_amount :=
          v_direct_refund_amount + v_direct_fee_amount;

        v_pending_direct_refund :=
          v_pending_direct_refund + v_direct_fee_amount;

      END IF;
    END IF;

    -- 新方式の未徴収依頼も、返金額0として取消通知を送る。
    IF v_pending_direct_line_user_id IS NOT NULL THEN
      v_pending_direct_notifications := v_pending_direct_notifications ||
        jsonb_build_array(jsonb_build_object(
          'lineUserId', v_pending_direct_line_user_id,
          'applicationId', v_application.id,
          'requestId', p_request_id,
          'requestTitle', v_request.title,
          'facilityName', v_facility_name,
          'performerName', v_pending_direct_performer_name,
          'refundAmount', COALESCE(v_direct_fee_amount, 0)
        ));
    END IF;

    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_application.id
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE application_id = v_application.id AND status = 'pending';
  END LOOP;

  -- 7. 初回成立手数料は完了済みマッチングがない場合だけ返金
  IF NOT v_has_completed_match THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_initial_refund_key, 0)
    );

    SELECT -ct.amount
    INTO v_initial_fee_amount
    FROM public.coin_transactions ct
    WHERE ct.user_id = v_facility_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'match_fee'
      AND ct.amount < 0
      AND ct.idempotency_key =
        'event_match_fee:' || p_request_id::text
    ORDER BY ct.created_at
    LIMIT 1;

    v_has_initial_fee :=
      COALESCE(v_initial_fee_amount, 0) > 0;

    IF v_has_initial_fee
       AND NOT EXISTS (
         SELECT 1
         FROM public.coin_transactions ct
         WHERE ct.idempotency_key = v_initial_refund_key
       )
    THEN
      UPDATE public.users
      SET coin_balance =
        COALESCE(coin_balance, 0) + v_initial_fee_amount
      WHERE id = v_facility_user_id
      RETURNING coin_balance INTO v_balance;

      INSERT INTO public.coin_transactions (
        user_id,
        amount,
        transaction_type,
        description,
        balance_after,
        request_id,
        idempotency_key
      )
      VALUES (
        v_facility_user_id,
        v_initial_fee_amount,
        'admin_adjustment',
        'イベント全体キャンセルによる初回マッチング手数料返金',
        v_balance,
        p_request_id,
        v_initial_refund_key
      );

      v_refund_amount :=
        v_refund_amount + v_initial_fee_amount;

      v_initial_refund_amount := v_initial_fee_amount;
    END IF;
  END IF;

  -- 8. 残った未処理応募を却下
  UPDATE public.applications
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND status = 'pending';

  UPDATE public.application_attempts
  SET status = 'rejected', updated_at = now()
  WHERE request_id = p_request_id AND status = 'pending';

  -- 9. 案件を募集終了にする
  UPDATE public.performance_requests
  SET status = 'closed'
  WHERE id = p_request_id;

  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'requestId', p_request_id,
    'cancelledMatches', v_cancelled_count,
    'cancelledMatchIds', v_cancelled_match_ids,
    'completedMatchesPreserved', v_has_completed_match,
    'refundAmount', v_refund_amount,
    'initialFeeRefund', v_initial_refund_amount,
    'directInviteRefund', v_direct_refund_amount,
    'pendingDirectInviteRefund', v_pending_direct_refund,
    'pendingDirectInviteNotifications', v_pending_direct_notifications,
    'balanceAfter', v_balance,
    'errorMessage', NULL
  );
END;
$function$;

-- Withdrawal integration for pending direct-invitation fee refunds and attempt closure.
CREATE OR REPLACE FUNCTION public.withdraw_user_account(p_line_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user public.users%ROWTYPE;
  v_performer_id uuid;
  v_facility_id uuid;
  v_performer_name text;
  v_match record;
  v_cancel_result jsonb;
  v_match_notifications jsonb;
  v_notifications jsonb := '[]'::jsonb;
  v_direct_invite record;
  v_invite_refund record;
  v_refund_amount integer;
  v_refund_key text;
  v_refund_exists_before boolean;
  v_pending_direct_notifications jsonb := '[]'::jsonb;
  v_pending_direct_refund_notifications jsonb := '[]'::jsonb;
  v_cancelled_count integer := 0;
  v_withdrawn_band_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  IF p_line_user_id IS NULL OR btrim(p_line_user_id) = '' THEN
    RAISE EXCEPTION 'LINEユーザーIDが指定されていません';
  END IF;

  -- 退会対象ユーザーをロック
  SELECT *
  INTO v_user
  FROM public.users
  WHERE line_user_id = p_line_user_id
    AND account_status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '有効なユーザーが見つからないか、既に退会しています';
  END IF;

  -- プロフィールIDと演奏者名を取得
  IF v_user.user_type = 'performer' THEN
    SELECT id, name
    INTO v_performer_id, v_performer_name
    FROM public.performers
    WHERE user_id = v_user.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '演奏者プロフィールが見つからないため退会できません';
    END IF;

  ELSIF v_user.user_type = 'facility' THEN
    SELECT id
    INTO v_facility_id
    FROM public.facilities
    WHERE user_id = v_user.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '施設プロフィールが見つからないため退会できません';
    END IF;

  ELSE
    RAISE EXCEPTION 'ユーザー種別が不正なため退会できません';
  END IF;

  -- 登録履歴の存在確認
  IF NOT EXISTS (
    SELECT 1
    FROM public.line_registration_history
    WHERE line_user_id_hash =
      encode(public.digest(p_line_user_id, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'LINE登録履歴が見つからないため退会できません';
  END IF;

  -- 成立済みレッスンがあれば中断
  IF EXISTS (
    SELECT 1
    FROM public.lesson_applications la
    JOIN public.lesson_offers lo
      ON lo.id = la.lesson_offer_id
    JOIN public.performers teacher
      ON teacher.id = lo.performer_id
    JOIN public.performers applicant
      ON applicant.id = la.applicant_performer_id
    WHERE la.status = 'matched'
      AND (
        teacher.user_id = v_user.id
        OR applicant.user_id = v_user.id
      )
  ) THEN
    RAISE EXCEPTION
      '成立済みレッスンが存在します。実施状況を確認してから退会してください';
  END IF;

  -- 異議申し立て中のマッチングがあれば中断
  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.performance_requests pr
      ON pr.id = m.request_id
    WHERE m.status = 'active'
      AND m.performance_status NOT IN ('completed', 'cancelled')
      AND m.completed_at IS NULL
      AND m.completion_disputed_at IS NOT NULL
      AND (
        (
          v_user.user_type = 'facility'
          AND pr.facility_id = v_facility_id
        )
        OR
        (
          v_user.user_type = 'performer'
          AND (
            m.performer_id = v_performer_id
            OR COALESCE(
              m.participant_performer_ids,
              ARRAY[]::uuid[]
            ) @> ARRAY[v_performer_id]::uuid[]
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      '異議申し立て中のマッチングがあります。対応完了後に退会してください';
  END IF;

  -- 進行中マッチングを既存RPCでキャンセル
  FOR v_match IN
    SELECT
      m.id AS match_id,
      m.performer_id,
      m.participant_performer_ids,
      pr.title AS request_title,
      pr.facility_id,
      facility.name AS facility_name,
      facility_user.line_user_id AS facility_line_user_id
    FROM public.matches m
    JOIN public.performance_requests pr
      ON pr.id = m.request_id
    JOIN public.facilities facility
      ON facility.id = pr.facility_id
    JOIN public.users facility_user
      ON facility_user.id = facility.user_id
    WHERE m.status = 'active'
      AND m.performance_status NOT IN ('completed', 'cancelled')
      AND m.completed_at IS NULL
      AND (
        (
          v_user.user_type = 'facility'
          AND pr.facility_id = v_facility_id
        )
        OR
        (
          v_user.user_type = 'performer'
          AND (
            m.performer_id = v_performer_id
            OR COALESCE(
              m.participant_performer_ids,
              ARRAY[]::uuid[]
            ) @> ARRAY[v_performer_id]::uuid[]
          )
        )
      )
    ORDER BY m.matched_at
    FOR UPDATE OF m
  LOOP
    -- 既存のキャンセル・返金処理を再利用
    v_cancel_result :=
      public.cancel_match_with_direct_invite_refund(
        v_match.match_id,
        v_match.facility_id
      );

    IF COALESCE(
      (v_cancel_result->>'success')::boolean,
      false
    ) IS NOT TRUE THEN
      RAISE EXCEPTION
        'マッチングのキャンセルに失敗しました: %',
        COALESCE(
          v_cancel_result->>'errorMessage',
          v_match.match_id::text
        );
    END IF;

    v_refund_amount :=
      COALESCE(
        (v_cancel_result->>'refundAmount')::integer,
        0
      );

    -- 施設退会：参加演奏者全員分の通知情報を作成
    IF v_user.user_type = 'facility' THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'lineUserId', recipients.line_user_id,
            'matchId', v_match.match_id,
            'requestTitle', v_match.request_title,
            'facilityName', v_match.facility_name,
            'performerName', recipients.performer_name,
            'withdrawnUserType', 'facility',
            'refundAmount', v_refund_amount
          )
        ),
        '[]'::jsonb
      )
      INTO v_match_notifications
      FROM (
        SELECT DISTINCT
          u.line_user_id,
          p.name AS performer_name
        FROM unnest(
          COALESCE(
            v_match.participant_performer_ids,
            ARRAY[]::uuid[]
          ) || ARRAY[v_match.performer_id]::uuid[]
        ) AS participant(performer_id)
        JOIN public.performers p
          ON p.id = participant.performer_id
        JOIN public.users u
          ON u.id = p.user_id
        WHERE u.account_status = 'active'
          AND u.line_user_id IS NOT NULL
          AND u.line_user_id NOT LIKE 'withdrawn:%'
      ) recipients;

    -- 演奏者退会：相手の施設に通知情報を作成
    ELSE
      v_match_notifications :=
        CASE
          WHEN v_match.facility_line_user_id IS NOT NULL
            AND v_match.facility_line_user_id NOT LIKE 'withdrawn:%'
          THEN jsonb_build_array(
            jsonb_build_object(
              'lineUserId', v_match.facility_line_user_id,
              'matchId', v_match.match_id,
              'requestTitle', v_match.request_title,
              'facilityName', v_match.facility_name,
              'performerName', v_performer_name,
              'withdrawnUserType', 'performer',
              'refundAmount', v_refund_amount
            )
          )
          ELSE '[]'::jsonb
        END;
    END IF;

    v_notifications :=
      v_notifications || v_match_notifications;

    v_cancelled_count := v_cancelled_count + 1;
  END LOOP;

  -- 施設退会処理
  IF v_user.user_type = 'facility' THEN

    -- 未承認の直接依頼は、旧方式で既に徴収済みなら返金し、
    -- 新方式で未徴収なら返金なしで却下する。
    FOR v_direct_invite IN
      SELECT a.id, a.performer_id, pr.id AS request_id,
             pr.title AS request_title, f.name AS facility_name,
             p.name AS performer_name, pu.line_user_id AS performer_line_user_id
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      JOIN public.facilities f ON f.id = pr.facility_id
      JOIN public.performers p ON p.id = a.performer_id
      JOIN public.users pu ON pu.id = p.user_id
      WHERE pr.facility_id = v_facility_id
        AND a.source = 'facility_invite'
        AND a.status = 'pending'
      ORDER BY a.id
    LOOP
      v_refund_key := 'direct_invite_refund:' || v_direct_invite.id::text;
      SELECT EXISTS (
        SELECT 1 FROM public.coin_transactions ct
        WHERE ct.idempotency_key = v_refund_key
      ) INTO v_refund_exists_before;

      SELECT * INTO v_invite_refund
      FROM public.reject_direct_invitation_with_refund_for_withdrawal(
        v_direct_invite.id, v_direct_invite.performer_id
      );
      IF NOT COALESCE(v_invite_refund.success, false) THEN
        RAISE EXCEPTION '未承認直接依頼の退会処理に失敗しました: %',
          COALESCE(v_invite_refund.error_message, '返金・却下処理失敗');
      END IF;

      IF NOT v_refund_exists_before THEN
        SELECT COALESCE(ct.amount, 0) INTO v_refund_amount
        FROM public.coin_transactions ct
        WHERE ct.idempotency_key = v_refund_key AND ct.amount > 0;
        v_refund_amount := COALESCE(v_refund_amount, 0);
      ELSE
        v_refund_amount := 0;
      END IF;

      IF v_direct_invite.performer_line_user_id IS NOT NULL
         AND v_direct_invite.performer_line_user_id NOT LIKE 'withdrawn:%' THEN
        v_pending_direct_notifications := v_pending_direct_notifications ||
          jsonb_build_array(jsonb_build_object(
            'lineUserId', v_direct_invite.performer_line_user_id,
            'applicationId', v_direct_invite.id,
            'requestId', v_direct_invite.request_id,
            'requestTitle', v_direct_invite.request_title,
            'facilityName', v_direct_invite.facility_name,
            'performerName', v_direct_invite.performer_name,
            'refundAmount', v_refund_amount
          ));
      END IF;
    END LOOP;

    UPDATE public.applications a
    SET status = 'rejected'
    FROM public.performance_requests pr
    WHERE a.request_id = pr.id
      AND pr.facility_id = v_facility_id
      AND a.status = 'pending';

    UPDATE public.application_attempts aa
    SET status = 'rejected', updated_at = now()
    FROM public.applications a
    WHERE aa.application_id = a.id
      AND a.request_id IN (
        SELECT pr.id FROM public.performance_requests pr
        WHERE pr.facility_id = v_facility_id
      )
      AND aa.status = 'pending';

    UPDATE public.performance_requests
    SET status = 'closed'
    WHERE facility_id = v_facility_id
      AND status IN ('open', 'matched');

    UPDATE public.facilities
    SET
      name = NULL,
      address = NULL,
      description = NULL,
      facility_type = NULL
    WHERE id = v_facility_id;
  END IF;

  -- 演奏者退会処理
  IF v_user.user_type = 'performer' THEN

    -- 本人宛ての未承認直接依頼は、旧方式の徴収済み料金だけ返金する。
    FOR v_direct_invite IN
      SELECT a.id, a.performer_id, pr.id AS request_id,
             pr.title AS request_title, f.name AS facility_name,
             fu.line_user_id AS facility_line_user_id, p.name AS performer_name
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      JOIN public.facilities f ON f.id = pr.facility_id
      JOIN public.users fu ON fu.id = f.user_id
      JOIN public.performers p ON p.id = a.performer_id
      WHERE a.performer_id = v_performer_id
        AND a.source = 'facility_invite'
        AND a.status = 'pending'
      ORDER BY a.id
    LOOP
      v_refund_key := 'direct_invite_refund:' || v_direct_invite.id::text;
      SELECT EXISTS (
        SELECT 1 FROM public.coin_transactions ct
        WHERE ct.idempotency_key = v_refund_key
      ) INTO v_refund_exists_before;

      SELECT * INTO v_invite_refund
      FROM public.reject_direct_invitation_with_refund_for_withdrawal(
        v_direct_invite.id, v_direct_invite.performer_id
      );
      IF NOT COALESCE(v_invite_refund.success, false) THEN
        RAISE EXCEPTION '未承認直接依頼の退会処理に失敗しました: %',
          COALESCE(v_invite_refund.error_message, '返金・却下処理失敗');
      END IF;

      IF NOT v_refund_exists_before THEN
        SELECT COALESCE(ct.amount, 0) INTO v_refund_amount
        FROM public.coin_transactions ct
        WHERE ct.idempotency_key = v_refund_key AND ct.amount > 0;
        v_refund_amount := COALESCE(v_refund_amount, 0);
      ELSE
        v_refund_amount := 0;
      END IF;

      IF v_direct_invite.facility_line_user_id IS NOT NULL
         AND v_direct_invite.facility_line_user_id NOT LIKE 'withdrawn:%' THEN
        v_pending_direct_refund_notifications := v_pending_direct_refund_notifications ||
          jsonb_build_array(jsonb_build_object(
            'lineUserId', v_direct_invite.facility_line_user_id,
            'applicationId', v_direct_invite.id,
            'requestId', v_direct_invite.request_id,
            'requestTitle', v_direct_invite.request_title,
            'facilityName', v_direct_invite.facility_name,
            'performerName', v_direct_invite.performer_name,
            'refundAmount', v_refund_amount
          ));
      END IF;
    END LOOP;

    -- 本人の未処理応募を終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE performer_id = v_performer_id
      AND status = 'pending';

    UPDATE public.application_attempts aa
    SET status = 'rejected', updated_at = now()
    FROM public.applications a
    WHERE aa.application_id = a.id
      AND a.performer_id = v_performer_id
      AND aa.status = 'pending';

    -- レッスン募集を終了。予約コインは残高に加算しない
    UPDATE public.lesson_offers
    SET
      status = 'closed',
      reserved_coins = 0
    WHERE performer_id = v_performer_id
      AND status = 'open';

    -- 本人が送信・受信した未回答の招待を終了
    UPDATE public.band_invitations
    SET
      status = 'cancelled',
      responded_at = now()
    WHERE status = 'pending'
      AND (
        inviter_performer_id = v_performer_id
        OR invitee_performer_id = v_performer_id
      );

    -- 現在のリーダー所属バンドだけを解散対象にする
    SELECT COALESCE(
      array_agg(DISTINCT bm.band_id),
      ARRAY[]::uuid[]
    )
    INTO v_withdrawn_band_ids
    FROM public.band_members bm
    JOIN public.bands b
      ON b.id = bm.band_id
    WHERE bm.performer_id = v_performer_id
      AND bm.status = 'active'
      AND bm.role = 'leader'
      AND b.status = 'active';

    -- リーダーのバンドを解散
    UPDATE public.bands
    SET
      status = 'disbanded',
      updated_at = now()
    WHERE id = ANY(v_withdrawn_band_ids);

    -- 解散したバンドの全メンバーを所属終了
    UPDATE public.band_members
    SET status = 'left'
    WHERE band_id = ANY(v_withdrawn_band_ids)
      AND status = 'active';

    -- 解散したバンドの未処理応募を終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE band_id = ANY(v_withdrawn_band_ids)
      AND status = 'pending';

    UPDATE public.application_attempts aa
    SET status = 'rejected', updated_at = now()
    FROM public.applications a
    WHERE aa.application_id = a.id
      AND a.band_id = ANY(v_withdrawn_band_ids)
      AND aa.status = 'pending';

    -- リーダー以外は本人だけ所属終了
    UPDATE public.band_members
    SET status = 'left'
    WHERE performer_id = v_performer_id
      AND status = 'active'
      AND NOT (
        band_id = ANY(v_withdrawn_band_ids)
      );

    -- 演奏者プロフィールを匿名化
    UPDATE public.performers
    SET
      name = NULL,
      instruments = '{}',
      genres = '{}',
      area = NULL,
      areas = '{}',
      bio = NULL,
      status_level = NULL
    WHERE id = v_performer_id;
  END IF;

  -- LINE登録履歴の退会日時を更新
  UPDATE public.line_registration_history
  SET
    last_withdrawn_at = now(),
    updated_at = now()
  WHERE line_user_id_hash =
    encode(public.digest(p_line_user_id, 'sha256'), 'hex');

  -- 旧アカウントを匿名化し、LINE IDを解放
  UPDATE public.users
  SET
    line_user_id = 'withdrawn:' || id::text,
    account_status = 'withdrawn',
    withdrawn_at = now(),
    display_name = NULL,
    picture_url = NULL,
    avatar_type = 'line',
    avatar_emoji = NULL
  WHERE id = v_user.id;

  RETURN jsonb_build_object(
    'success', true,
    'userId', v_user.id,
    'userType', v_user.user_type,
    'cancelledMatchCount', v_cancelled_count,
    'notifications', v_notifications,
    'pendingDirectInviteNotifications', v_pending_direct_notifications,
    'pendingDirectInviteRefundNotifications', v_pending_direct_refund_notifications
  );
END;
$function$;

COMMIT;
