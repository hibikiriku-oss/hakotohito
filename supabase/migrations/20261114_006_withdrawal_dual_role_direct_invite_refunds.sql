-- Hakotohito: dual-profile withdrawal + pending direct-invite refunds.
-- Candidate replacement based on the 2026-11-14 read-only DB function snapshot.
-- Not applied. Re-audit locks, current helper body, and exact project schema first.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.withdraw_user_account(text)') IS NULL THEN
    RAISE EXCEPTION 'withdraw_user_account(text) is missing; stop and inspect the target database.';
  END IF;
  IF to_regprocedure('public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'The withdrawal direct-invite refund helper is missing; stop and inspect the target database.';
  END IF;
  IF pg_get_function_result(to_regprocedure('public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)'))
       IS DISTINCT FROM 'TABLE(success boolean, balance_after integer, error_message text)' THEN
    RAISE EXCEPTION 'The withdrawal refund helper return contract differs from the candidate source.';
  END IF;
END;
$preflight$;

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
  v_refund_amount integer;
  v_cancelled_count integer := 0;
  v_withdrawn_band_ids uuid[] := ARRAY[]::uuid[];
  v_is_performer boolean := false;
  v_is_facility boolean := false;
  v_invite record;
  v_refund_result record;
  v_actual_fee integer;
  v_refund_key text;
  v_refund_exists boolean;
  v_processed_application_ids uuid[] := ARRAY[]::uuid[];
  v_pending_direct_notifications jsonb := '[]'::jsonb;
  v_pending_direct_refund_notifications jsonb := '[]'::jsonb;
BEGIN
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

  -- user_typeは主プロフィール種別として維持しつつ、実在する両プロフィールを取得する。
  SELECT id, name
  INTO v_performer_id, v_performer_name
  FROM public.performers
  WHERE user_id = v_user.id
  FOR UPDATE;
  v_is_performer := FOUND;

  SELECT id
  INTO v_facility_id
  FROM public.facilities
  WHERE user_id = v_user.id
  FOR UPDATE;
  v_is_facility := FOUND;

  IF NOT v_is_performer AND NOT v_is_facility THEN
    RAISE EXCEPTION '演奏者・施設プロフィールが見つからないため退会できません';
  END IF;

  IF (v_user.user_type = 'performer' AND NOT v_is_performer)
     OR (v_user.user_type = 'facility' AND NOT v_is_facility) THEN
    RAISE EXCEPTION 'ユーザー種別とプロフィール情報が一致しないため退会できません';
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
          v_is_facility
          AND pr.facility_id = v_facility_id
        )
        OR
        (
          v_is_performer
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
      (v_is_facility AND pr.facility_id = v_facility_id) AS is_facility_match,
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
          v_is_facility
          AND pr.facility_id = v_facility_id
        )
        OR
        (
          v_is_performer
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
    IF v_match.is_facility_match THEN
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
          AND u.id <> v_user.id
      ) recipients;

    -- 演奏者退会：相手の施設に通知情報を作成
    ELSE
      v_match_notifications :=
        CASE
          WHEN v_match.facility_line_user_id IS NOT NULL
            AND v_match.facility_line_user_id NOT LIKE 'withdrawn:%'
            AND v_match.facility_line_user_id <> p_line_user_id
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

  -- 施設退会：施設が送信した未成立の直接依頼を実際の徴収額で返金し、演奏者へ通知する。
  IF v_is_facility THEN
    FOR v_invite IN
      SELECT
        a.id AS application_id,
        a.request_id,
        a.performer_id,
        pr.title AS request_title,
        facility.name AS facility_name,
        performer.name AS performer_name,
        performer_user.line_user_id AS recipient_line_user_id
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      JOIN public.facilities facility ON facility.id = pr.facility_id
      JOIN public.performers performer ON performer.id = a.performer_id
      JOIN public.users performer_user ON performer_user.id = performer.user_id
      WHERE pr.facility_id = v_facility_id
        AND a.source = 'facility_invite'
        AND a.status = 'pending'
      ORDER BY a.id
    LOOP
      IF v_invite.application_id = ANY(v_processed_application_ids) THEN
        CONTINUE;
      END IF;

      v_refund_key := 'direct_invite_refund:' || v_invite.application_id::text;
      SELECT EXISTS (
        SELECT 1 FROM public.coin_transactions ct
        WHERE ct.idempotency_key = v_refund_key
      ) INTO v_refund_exists;

      SELECT -ct.amount
      INTO v_actual_fee
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key =
          'direct_invite_fee:' || v_invite.request_id::text || ':' || v_invite.performer_id::text
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.request_id = v_invite.request_id
        AND ct.application_id = v_invite.application_id;

      IF v_actual_fee IS NULL THEN
        -- No debit exists: cancel the pending invite without inventing a refund.
        UPDATE public.applications
        SET status = 'rejected'
        WHERE id = v_invite.application_id AND status = 'pending';
        v_processed_application_ids := array_append(v_processed_application_ids, v_invite.application_id);
        CONTINUE;
      END IF;

      SELECT * INTO v_refund_result
      FROM public.reject_direct_invitation_with_refund_for_withdrawal(
        v_invite.application_id, v_invite.performer_id
      );

      IF NOT COALESCE(v_refund_result.success, false) THEN
        RAISE EXCEPTION '退会時の未成立直接依頼返金に失敗しました: %',
          COALESCE(v_refund_result.error_message, v_invite.application_id::text);
      END IF;

      v_processed_application_ids := array_append(v_processed_application_ids, v_invite.application_id);
      IF NOT v_refund_exists AND COALESCE(v_actual_fee, 0) > 0
         AND v_invite.recipient_line_user_id IS NOT NULL
         AND v_invite.recipient_line_user_id NOT LIKE 'withdrawn:%'
         AND v_invite.recipient_line_user_id <> p_line_user_id THEN
        v_pending_direct_notifications := v_pending_direct_notifications || jsonb_build_array(
          jsonb_build_object(
            'lineUserId', v_invite.recipient_line_user_id,
            'applicationId', v_invite.application_id,
            'requestId', v_invite.request_id,
            'requestTitle', v_invite.request_title,
            'facilityName', v_invite.facility_name,
            'performerName', v_invite.performer_name,
            'refundAmount', v_actual_fee
          )
        );
      END IF;
    END LOOP;
  END IF;

  -- 演奏者退会：本人が受信した未成立の直接依頼を返金し、元の施設ユーザーへ通知する。
  IF v_is_performer THEN
    FOR v_invite IN
      SELECT
        a.id AS application_id,
        a.request_id,
        a.performer_id,
        pr.title AS request_title,
        facility.name AS facility_name,
        facility_user.line_user_id AS recipient_line_user_id,
        performer.name AS performer_name
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      JOIN public.facilities facility ON facility.id = pr.facility_id
      JOIN public.users facility_user ON facility_user.id = facility.user_id
      JOIN public.performers performer ON performer.id = a.performer_id
      WHERE a.performer_id = v_performer_id
        AND a.source = 'facility_invite'
        AND a.status = 'pending'
      ORDER BY a.id
    LOOP
      IF v_invite.application_id = ANY(v_processed_application_ids) THEN
        CONTINUE;
      END IF;

      v_refund_key := 'direct_invite_refund:' || v_invite.application_id::text;
      SELECT EXISTS (
        SELECT 1 FROM public.coin_transactions ct
        WHERE ct.idempotency_key = v_refund_key
      ) INTO v_refund_exists;

      SELECT -ct.amount
      INTO v_actual_fee
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key =
          'direct_invite_fee:' || v_invite.request_id::text || ':' || v_invite.performer_id::text
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.request_id = v_invite.request_id
        AND ct.application_id = v_invite.application_id;

      IF v_actual_fee IS NULL THEN
        -- No debit exists: cancel the pending invite without inventing a refund.
        UPDATE public.applications
        SET status = 'rejected'
        WHERE id = v_invite.application_id AND status = 'pending';
        v_processed_application_ids := array_append(v_processed_application_ids, v_invite.application_id);
        CONTINUE;
      END IF;

      SELECT * INTO v_refund_result
      FROM public.reject_direct_invitation_with_refund_for_withdrawal(
        v_invite.application_id, v_invite.performer_id
      );

      IF NOT COALESCE(v_refund_result.success, false) THEN
        RAISE EXCEPTION '退会時の未成立直接依頼返金に失敗しました: %',
          COALESCE(v_refund_result.error_message, v_invite.application_id::text);
      END IF;

      v_processed_application_ids := array_append(v_processed_application_ids, v_invite.application_id);
      IF NOT v_refund_exists AND COALESCE(v_actual_fee, 0) > 0
         AND v_invite.recipient_line_user_id IS NOT NULL
         AND v_invite.recipient_line_user_id NOT LIKE 'withdrawn:%'
         AND v_invite.recipient_line_user_id <> p_line_user_id THEN
        v_pending_direct_refund_notifications := v_pending_direct_refund_notifications || jsonb_build_array(
          jsonb_build_object(
            'lineUserId', v_invite.recipient_line_user_id,
            'applicationId', v_invite.application_id,
            'requestId', v_invite.request_id,
            'requestTitle', v_invite.request_title,
            'facilityName', v_invite.facility_name,
            'performerName', v_invite.performer_name,
            'refundAmount', v_actual_fee
          )
        );
      END IF;
    END LOOP;
  END IF;

  -- 施設退会処理
  IF v_is_facility THEN

    UPDATE public.applications a
    SET status = 'rejected'
    FROM public.performance_requests pr
    WHERE a.request_id = pr.id
      AND pr.facility_id = v_facility_id
      AND a.status = 'pending';

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
  IF v_is_performer THEN

    -- 本人の未処理応募を終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE performer_id = v_performer_id
      AND status = 'pending';

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
