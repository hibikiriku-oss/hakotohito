CREATE OR REPLACE FUNCTION public.withdraw_user_account(p_line_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  IF v_user.user_type = 'performer' THEN

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
    'notifications', v_notifications
  );
END;
$function$