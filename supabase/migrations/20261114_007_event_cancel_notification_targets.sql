-- Hakotohito: return the exact match IDs cancelled by the event-wide RPC.
-- Candidate only. Verify the full current function body and project schema first.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'cancel_event_request_with_refund_internal(uuid,uuid,boolean) is missing; stop and inspect the target database.';
  END IF;
  IF to_regprocedure('public.cancel_event_request_with_refund(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'The public cancel_event_request_with_refund wrapper is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'matches'
      AND column_name = 'participant_performer_ids'
  ) THEN
    RAISE EXCEPTION 'matches.participant_performer_ids is required for band notifications.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.cancel_event_request_with_refund_internal(p_request_id uuid, p_facility_id uuid, p_allow_closed boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
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
        v_direct_refund_key :=
          'direct_invite_refund:' || v_application.id::text;

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

        -- 実際に返金した場合だけ通知対象に追加
        IF v_pending_direct_line_user_id IS NOT NULL THEN
          v_pending_direct_notifications :=
            v_pending_direct_notifications ||
            jsonb_build_array(
              jsonb_build_object(
                'lineUserId', v_pending_direct_line_user_id,
                'applicationId', v_application.id,
                'requestId', p_request_id,
                'requestTitle', v_request.title,
                'facilityName', v_facility_name,
                'performerName', v_pending_direct_performer_name,
                'refundAmount', v_direct_fee_amount
              )
            );
        END IF;
      END IF;
    END IF;

    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_application.id
      AND status = 'pending';
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
    'cancelledMatchIds', to_jsonb(v_cancelled_match_ids),
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
$$;

COMMIT;
