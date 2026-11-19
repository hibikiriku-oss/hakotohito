-- Integrated withdrawal repair: preserve deferred-fee semantics, dual profiles,
-- application-attempt lifecycle, and counterpart notifications in one transaction.
-- Prerequisites: 20261116 migrations 009-014 and 021, plus 20261118 migrations 001-015.
-- Apply only after those migrations in order; this migration intentionally fails closed otherwise.
-- Candidate only; not executed against Supabase.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL
     OR to_regprocedure('public.cancel_match_with_direct_invite_refund(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)') IS NULL
     OR to_regprocedure('public.withdraw_user_account_with_notification_outbox(text)') IS NULL
     OR to_regclass('public.application_attempts') IS NULL
     OR to_regclass('public.line_notification_outbox') IS NULL THEN
    RAISE EXCEPTION 'Required global-gate, withdrawal, attempt, or Outbox object is missing';
  END IF;
  IF pg_get_function_result(to_regprocedure('public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)'))
       IS DISTINCT FROM 'TABLE(success boolean, balance_after integer, error_message text)' THEN
    RAISE EXCEPTION 'Withdrawal refund helper return contract changed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'users','performers','facilities','performance_requests','matches','applications',
      'coin_transactions','line_registration_history','application_attempts',
      'lesson_applications','lesson_offers','band_invitations','band_members','bands',
      'line_notification_outbox'
    ]) AS required(table_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('public.' || required.table_name)
        AND t.tgname='trg_global_mutation_gate'
        AND NOT t.tgisinternal AND t.tgenabled <> 'D'
        AND t.tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')
    )
  ) THEN
    RAISE EXCEPTION 'A required table is missing the global mutation gate trigger';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass
    AND tgname='trg_close_pending_lesson_applications_on_withdrawal'
    AND NOT tgisinternal AND tgenabled <> 'D'
    AND tgfoid=to_regprocedure('public.close_pending_lesson_applications_on_withdrawal()')) THEN
    RAISE EXCEPTION 'Lesson withdrawal cleanup trigger is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('users','id'),('users','line_user_id'),('users','user_type'),('users','account_status'),('users','withdrawn_at'),('users','display_name'),('users','picture_url'),('users','avatar_type'),('users','avatar_emoji'),
      ('performers','id'),('performers','user_id'),('performers','name'),
      ('facilities','id'),('facilities','user_id'),('facilities','name'),('facilities','address'),('facilities','description'),('facilities','facility_type'),
      ('performance_requests','id'),('performance_requests','facility_id'),('performance_requests','title'),('performance_requests','status'),
      ('matches','id'),('matches','request_id'),('matches','performer_id'),('matches','participant_performer_ids'),('matches','status'),('matches','performance_status'),('matches','completed_at'),('matches','completion_disputed_at'),('matches','matched_at'),('matches','application_id'),
      ('coin_transactions','id'),('coin_transactions','user_id'),('coin_transactions','amount'),('coin_transactions','transaction_type'),('coin_transactions','request_id'),('coin_transactions','application_id'),('coin_transactions','idempotency_key'),
      ('line_registration_history','line_user_id_hash'),('line_registration_history','last_withdrawn_at'),('line_registration_history','updated_at'),
      ('applications','id'),('applications','request_id'),('applications','performer_id'),('applications','status'),('applications','source'),('applications','band_id'),
      ('application_attempts','application_id'),('application_attempts','performer_id'),('application_attempts','band_id'),('application_attempts','status'),('application_attempts','updated_at'),
      ('lesson_applications','id'),('lesson_applications','lesson_offer_id'),('lesson_applications','applicant_performer_id'),('lesson_applications','status'),
      ('lesson_offers','id'),('lesson_offers','performer_id'),('lesson_offers','title'),('lesson_offers','status'),('lesson_offers','reserved_coins'),
      ('band_invitations','id'),('band_invitations','band_id'),('band_invitations','inviter_performer_id'),('band_invitations','invitee_performer_id'),('band_invitations','status'),('band_invitations','responded_at'),
      ('band_members','band_id'),('band_members','performer_id'),('band_members','role'),('band_members','status'),
      ('bands','id'),('bands','name'),('bands','status'),('bands','updated_at'),
      ('line_notification_outbox','event_key'),('line_notification_outbox','recipient_line_user_id'),('line_notification_outbox','messages')
    ) AS required(table_name,column_name)
    LEFT JOIN information_schema.columns c ON c.table_schema='public'
      AND c.table_name=required.table_name AND c.column_name=required.column_name
    WHERE c.column_name IS NULL
  ) THEN RAISE EXCEPTION 'A required withdrawal/lesson/band/Outbox column is missing'; END IF;
  IF pg_get_function_result(to_regprocedure('public.withdraw_user_account(text)')) IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'withdraw_user_account(text) return contract changed';
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
  v_pending_lesson_notifications jsonb := '[]'::jsonb;
  v_pending_application_notifications jsonb := '[]'::jsonb;
  v_application_notification_batch jsonb := '[]'::jsonb;
  v_pending_band_invitation_notifications jsonb := '[]'::jsonb;
  v_pending_band_disband_notifications jsonb := '[]'::jsonb;
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

  -- Capture counterpart notifications before the account-status trigger closes pending lessons.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'applicationId', q.application_id,
        'recipientUserId', q.recipient_user_id,
        'lineUserId', q.line_user_id,
        'lessonTitle', q.lesson_title
      ) ORDER BY q.application_id, q.recipient_user_id
    ),
    '[]'::jsonb
  )
  INTO v_pending_lesson_notifications
  FROM (
    SELECT DISTINCT
      la.id AS application_id,
      recipient.id AS recipient_user_id,
      recipient.line_user_id,
      lo.title AS lesson_title
    FROM public.lesson_applications la
    JOIN public.lesson_offers lo ON lo.id = la.lesson_offer_id
    JOIN public.performers teacher ON teacher.id = lo.performer_id
    JOIN public.users teacher_user ON teacher_user.id = teacher.user_id
    JOIN public.performers applicant ON applicant.id = la.applicant_performer_id
    JOIN public.users applicant_user ON applicant_user.id = applicant.user_id
    CROSS JOIN LATERAL (
      SELECT applicant_user.id, applicant_user.line_user_id, applicant_user.account_status
      WHERE teacher.user_id = v_user.id
      UNION ALL
      SELECT teacher_user.id, teacher_user.line_user_id, teacher_user.account_status
      WHERE applicant.user_id = v_user.id
    ) AS recipient(id, line_user_id, account_status)
    WHERE la.status = 'pending'
      AND (teacher.user_id = v_user.id OR applicant.user_id = v_user.id)
      AND recipient.id <> v_user.id
      AND recipient.account_status = 'active'
      AND NULLIF(recipient.line_user_id, '') IS NOT NULL
      AND recipient.line_user_id NOT LIKE 'withdrawn:%'
  ) q;

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
        UPDATE public.application_attempts
        SET status = 'rejected', updated_at = now()
        WHERE application_id = v_invite.application_id AND status = 'pending';
        IF v_invite.recipient_line_user_id IS NOT NULL
           AND v_invite.recipient_line_user_id NOT LIKE 'withdrawn:%'
           AND v_invite.recipient_line_user_id <> p_line_user_id THEN
          v_pending_direct_notifications := v_pending_direct_notifications || jsonb_build_array(
            jsonb_build_object('lineUserId', v_invite.recipient_line_user_id,
              'applicationId', v_invite.application_id, 'requestId', v_invite.request_id,
              'requestTitle', v_invite.request_title, 'facilityName', v_invite.facility_name,
              'performerName', v_invite.performer_name, 'refundAmount', 0)
          );
        END IF;
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

      UPDATE public.application_attempts
      SET status = 'rejected', updated_at = now()
      WHERE application_id = v_invite.application_id AND status = 'pending';
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
        UPDATE public.application_attempts
        SET status = 'rejected', updated_at = now()
        WHERE application_id = v_invite.application_id AND status = 'pending';
        IF v_invite.recipient_line_user_id IS NOT NULL
           AND v_invite.recipient_line_user_id NOT LIKE 'withdrawn:%'
           AND v_invite.recipient_line_user_id <> p_line_user_id THEN
          v_pending_direct_refund_notifications := v_pending_direct_refund_notifications || jsonb_build_array(
            jsonb_build_object('lineUserId', v_invite.recipient_line_user_id,
              'applicationId', v_invite.application_id, 'requestId', v_invite.request_id,
              'requestTitle', v_invite.request_title, 'facilityName', v_invite.facility_name,
              'performerName', v_invite.performer_name, 'refundAmount', 0)
          );
        END IF;
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

      UPDATE public.application_attempts
      SET status = 'rejected', updated_at = now()
      WHERE application_id = v_invite.application_id AND status = 'pending';
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
    -- Capture ordinary solo/band applicants before their pending rows are rejected.
    -- Direct invitations are handled above by the fee-aware dedicated flow.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'applicationId', q.application_id,
          'recipientUserId', q.recipient_user_id,
          'lineUserId', q.line_user_id,
          'requestTitle', q.request_title,
          'withdrawnUserType', 'facility',
          'applicationSource', q.application_source,
          'bandName', q.band_name
        ) ORDER BY q.application_id, q.recipient_user_id
      ), '[]'::jsonb
    )
    INTO v_application_notification_batch
    FROM (
      SELECT DISTINCT
        a.id AS application_id,
        recipient.id AS recipient_user_id,
        recipient.line_user_id,
        pr.title AS request_title,
        a.source AS application_source,
        CASE WHEN a.source = 'band_apply' THEN COALESCE(NULLIF(b.name, ''), 'バンド') ELSE NULL END AS band_name
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      LEFT JOIN public.bands b ON b.id = a.band_id
      JOIN LATERAL (
        SELECT u.id, u.line_user_id
        FROM public.performers p
        JOIN public.users u ON u.id = p.user_id
        WHERE a.source = 'performer_apply'
          AND p.id = a.performer_id
          AND u.account_status = 'active'
        UNION ALL
        SELECT u.id, u.line_user_id
        FROM public.band_members bm
        JOIN public.performers p ON p.id = bm.performer_id
        JOIN public.users u ON u.id = p.user_id
        WHERE a.source = 'band_apply'
          AND bm.band_id = a.band_id
          AND bm.status = 'active'
          AND u.account_status = 'active'
      ) recipient ON true
      WHERE pr.facility_id = v_facility_id
        AND a.status = 'pending'
        AND a.source IN ('performer_apply', 'band_apply')
        AND recipient.id <> v_user.id
        AND NULLIF(recipient.line_user_id, '') IS NOT NULL
        AND recipient.line_user_id NOT LIKE 'withdrawn:%'
    ) q;
    v_pending_application_notifications := v_pending_application_notifications || v_application_notification_batch;

    UPDATE public.applications a
    SET status = 'rejected'
    FROM public.performance_requests pr
    WHERE a.request_id = pr.id
      AND pr.facility_id = v_facility_id
      AND a.status = 'pending';

    UPDATE public.application_attempts aa
    SET status = 'rejected', updated_at = now()
    WHERE aa.status = 'pending'
      AND aa.application_id IN (
        SELECT a.id
        FROM public.applications a
        JOIN public.performance_requests pr ON pr.id = a.request_id
        WHERE pr.facility_id = v_facility_id
      );

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
    -- Determine leader-owned bands before capturing/rejecting their pending applications.
    SELECT COALESCE(
      array_agg(DISTINCT bm.band_id),
      ARRAY[]::uuid[]
    )
    INTO v_withdrawn_band_ids
    FROM public.band_members bm
    JOIN public.bands b ON b.id = bm.band_id
    WHERE bm.performer_id = v_performer_id
      AND bm.status = 'active'
      AND bm.role = 'leader'
      AND b.status = 'active';

    -- Capture facilities affected by this performer's solo applications and by
    -- applications of leader-owned bands that will be disbanded.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'applicationId', q.application_id,
          'recipientUserId', q.recipient_user_id,
          'lineUserId', q.line_user_id,
          'requestTitle', q.request_title,
          'withdrawnUserType', 'performer',
          'applicationSource', q.application_source,
          'bandName', q.band_name
        ) ORDER BY q.application_id, q.recipient_user_id
      ), '[]'::jsonb
    )
    INTO v_application_notification_batch
    FROM (
      SELECT DISTINCT
        a.id AS application_id,
        recipient.id AS recipient_user_id,
        recipient.line_user_id,
        pr.title AS request_title,
        a.source AS application_source,
        CASE WHEN a.source = 'band_apply' THEN COALESCE(NULLIF(b.name, ''), 'バンド') ELSE NULL END AS band_name
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      LEFT JOIN public.bands b ON b.id = a.band_id
      JOIN public.facilities f ON f.id = pr.facility_id
      JOIN public.users recipient ON recipient.id = f.user_id
      WHERE a.status = 'pending'
        AND recipient.id <> v_user.id
        AND recipient.account_status = 'active'
        AND NULLIF(recipient.line_user_id, '') IS NOT NULL
        AND recipient.line_user_id NOT LIKE 'withdrawn:%'
        AND (
          (a.source = 'performer_apply' AND a.performer_id = v_performer_id)
          OR (a.source = 'band_apply' AND a.band_id = ANY(v_withdrawn_band_ids))
        )
    ) q;
    v_pending_application_notifications := v_pending_application_notifications || v_application_notification_batch;

    -- 本人の未処理応募を終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE performer_id = v_performer_id
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE performer_id = v_performer_id AND status = 'pending';

    -- レッスン募集を終了。予約コインは残高に加算しない
    UPDATE public.lesson_offers
    SET
      status = 'closed',
      reserved_coins = 0
    WHERE performer_id = v_performer_id
      AND status = 'open';

    -- Capture the other party for pending invitations affected by withdrawal or band disband.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'invitationId', q.invitation_id,
          'recipientUserId', q.recipient_user_id,
          'lineUserId', q.line_user_id,
          'bandName', q.band_name
        ) ORDER BY q.invitation_id, q.recipient_user_id
      ),
      '[]'::jsonb
    )
    INTO v_pending_band_invitation_notifications
    FROM (
      SELECT DISTINCT
        bi.id AS invitation_id,
        recipient_user.id AS recipient_user_id,
        recipient_user.line_user_id,
        COALESCE(NULLIF(b.name, ''), 'バンド') AS band_name
      FROM public.band_invitations bi
      JOIN public.bands b ON b.id = bi.band_id
      JOIN public.performers recipient_performer
        ON recipient_performer.id = CASE
          WHEN bi.invitee_performer_id = v_performer_id
            THEN bi.inviter_performer_id
          ELSE bi.invitee_performer_id
        END
      JOIN public.users recipient_user ON recipient_user.id = recipient_performer.user_id
      WHERE bi.status = 'pending'
        AND (
          bi.inviter_performer_id = v_performer_id
          OR bi.invitee_performer_id = v_performer_id
          OR bi.band_id = ANY(v_withdrawn_band_ids)
        )
        AND recipient_user.id <> v_user.id
        AND recipient_user.account_status = 'active'
        AND NULLIF(recipient_user.line_user_id, '') IS NOT NULL
        AND recipient_user.line_user_id NOT LIKE 'withdrawn:%'
    ) q;

    -- Capture active members who need to know their leader's band was disbanded.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bandId', q.band_id,
          'recipientUserId', q.recipient_user_id,
          'lineUserId', q.line_user_id,
          'bandName', q.band_name
        ) ORDER BY q.band_id, q.recipient_user_id
      ),
      '[]'::jsonb
    )
    INTO v_pending_band_disband_notifications
    FROM (
      SELECT DISTINCT
        b.id AS band_id,
        u.id AS recipient_user_id,
        u.line_user_id,
        COALESCE(NULLIF(b.name, ''), 'バンド') AS band_name
      FROM public.band_members bm
      JOIN public.bands b ON b.id = bm.band_id
      JOIN public.performers p ON p.id = bm.performer_id
      JOIN public.users u ON u.id = p.user_id
      WHERE bm.band_id = ANY(v_withdrawn_band_ids)
        AND bm.status = 'active'
        AND u.id <> v_user.id
        AND u.account_status = 'active'
        AND NULLIF(u.line_user_id, '') IS NOT NULL
        AND u.line_user_id NOT LIKE 'withdrawn:%'
    ) q;

    -- Cancel invitations involving the withdrawing performer and all pending invitations in disbanded bands.
    UPDATE public.band_invitations
    SET status = 'cancelled', responded_at = now()
    WHERE status = 'pending'
      AND (
        inviter_performer_id = v_performer_id
        OR invitee_performer_id = v_performer_id
        OR band_id = ANY(v_withdrawn_band_ids)
      );

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

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
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
    'pendingDirectInviteRefundNotifications', v_pending_direct_refund_notifications,
    'pendingLessonNotifications', v_pending_lesson_notifications,
    'pendingApplicationNotifications', v_pending_application_notifications,
    'pendingBandInvitationNotifications', v_pending_band_invitation_notifications,
    'pendingBandDisbandNotifications', v_pending_band_disband_notifications
  );
END;
$function$;
ALTER FUNCTION public.withdraw_user_account(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.withdraw_user_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_user_account(text) TO service_role;

CREATE OR REPLACE FUNCTION public.close_pending_lesson_applications_on_withdrawal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_performer_id uuid;
BEGIN
  IF OLD.account_status IS DISTINCT FROM 'active'
     OR NEW.account_status IS DISTINCT FROM 'withdrawn' THEN
    RETURN NEW;
  END IF;

  SELECT p.id INTO v_performer_id
  FROM public.performers p
  WHERE p.user_id = OLD.id;

  -- Facility-only accounts have no lesson persona; dual-role accounts do.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.lesson_applications la
  SET status = 'rejected'
  WHERE la.status = 'pending'
    AND (
      la.applicant_performer_id = v_performer_id
      OR la.lesson_offer_id IN (
        SELECT lo.id FROM public.lesson_offers lo
        WHERE lo.performer_id = v_performer_id
      )
    );

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.close_pending_lesson_applications_on_withdrawal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_pending_lesson_applications_on_withdrawal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_pending_lesson_applications_on_withdrawal() TO service_role;

CREATE OR REPLACE FUNCTION public.withdraw_user_account_with_notification_outbox(
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_item jsonb;
  v_line_user_id text;
  v_match_id text;
  v_application_id text;
  v_band_id text;
  v_recipient_user_id text;
  v_text text;
  v_user_type text;
  v_refund_amount integer;
  v_withdrawn_user_type text;
  v_application_source text;
  v_band_name text;
BEGIN
  v_result := public.withdraw_user_account(p_line_user_id);
  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'notifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_match_id := v_item->>'matchId';
    v_user_type := v_item->>'withdrawnUserType';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_match_id, '') IS NULL THEN
      CONTINUE;
    END IF;
    v_text := CASE WHEN v_user_type = 'facility'
      THEN '施設が退会したため、マッチングは中止されました。'
      ELSE '演奏者が退会したため、マッチングは中止されました。'
    END || ' 案件：' || COALESCE(v_item->>'requestTitle', '案件') ||
      E'\nLINEミニアプリから最新状況をご確認ください。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES (
      'withdrawal_match:' || v_match_id || ':' || v_line_user_id,
      v_line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    ) ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingDirectInviteNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'applicationId';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := '施設が退会したため、ダイレクトオファーは取り消されました。案件：' ||
      COALESCE(v_item->>'requestTitle', '案件') || E'\nこの依頼は無効になっています。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_direct_cancel:' || v_application_id || ':' || v_line_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingDirectInviteRefundNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'applicationId';
    v_refund_amount := COALESCE((v_item->>'refundAmount')::integer, 0);
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := '演奏者が退会したため、ダイレクトオファーは取り消されました。案件：' ||
      COALESCE(v_item->>'requestTitle', '案件') ||
      CASE WHEN v_refund_amount > 0
        THEN E'\n直接依頼手数料' || v_refund_amount::text || 'コインを施設へ返金しました。'
        ELSE E'\nマッチング成立前の手数料徴収はなく、返金はありません。' END;
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_direct_refund:' || v_application_id || ':' || v_line_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingApplicationNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'applicationId';
    v_recipient_user_id := v_item->>'recipientUserId';
    v_withdrawn_user_type := v_item->>'withdrawnUserType';
    v_application_source := v_item->>'applicationSource';
    v_band_name := v_item->>'bandName';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL OR NULLIF(v_recipient_user_id, '') IS NULL
       OR v_withdrawn_user_type IS NULL
       OR v_withdrawn_user_type NOT IN ('facility', 'performer') THEN
      CONTINUE;
    END IF;
    IF v_withdrawn_user_type = 'facility' THEN
      v_text := CASE WHEN v_application_source = 'band_apply'
        THEN '応募先施設の退会に伴い、バンド「' || COALESCE(v_band_name, 'バンド') || '」の応募は取り消されました。'
        ELSE '応募先施設の退会に伴い、演奏応募は取り消されました。' END;
    ELSE
      v_text := CASE WHEN v_application_source = 'band_apply'
        THEN '応募バンドのリーダー退会・解散に伴い、バンド「' || COALESCE(v_band_name, 'バンド') || '」の応募は取り消されました。'
        ELSE '応募者の退会に伴い、演奏応募は取り消されました。' END;
    END IF;
    v_text := v_text || ' 案件：' || COALESCE(v_item->>'requestTitle', '案件') ||
      E'\nLINEミニアプリから最新状況をご確認ください。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES (
      'withdrawal_application:' || v_application_id || ':' || v_recipient_user_id,
      v_line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    ) ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingLessonNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'applicationId';
    v_recipient_user_id := v_item->>'recipientUserId';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL OR NULLIF(v_recipient_user_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := '相手ユーザーの退会に伴い、レッスン応募は取り消されました。募集：' ||
      COALESCE(v_item->>'lessonTitle', 'レッスン');
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_lesson_application:' || v_application_id || ':' || v_recipient_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingBandInvitationNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'invitationId';
    v_recipient_user_id := v_item->>'recipientUserId';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL OR NULLIF(v_recipient_user_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := '退会またはバンド解散に伴い、バンド「' || COALESCE(v_item->>'bandName','バンド') ||
      '」への参加招待は取り消されました。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_band_invitation:' || v_application_id || ':' || v_recipient_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingBandDisbandNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_band_id := v_item->>'bandId';
    v_recipient_user_id := v_item->>'recipientUserId';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_band_id, '') IS NULL OR NULLIF(v_recipient_user_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := 'リーダーの退会に伴い、バンド「' || COALESCE(v_item->>'bandName','バンド') || '」は解散しました。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_band_disband:' || v_band_id || ':' || v_recipient_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.withdraw_user_account_with_notification_outbox(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.withdraw_user_account_with_notification_outbox(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_user_account_with_notification_outbox(text) TO service_role;


NOTIFY pgrst, 'reload schema';
COMMIT;
