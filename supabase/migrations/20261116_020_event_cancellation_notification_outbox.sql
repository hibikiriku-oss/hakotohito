-- Atomically enqueue event-wide cancellation notices with refunds and closure.
-- Candidate only; depends on migration 014 and cancellation policy migration 013.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)') IS NULL
     OR to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.matches') IS NULL THEN
    RAISE EXCEPTION 'Required event-cancellation/outbox objects are missing';
  END IF;
  IF to_regprocedure('public.cancel_event_request_with_notification_outbox(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Event cancellation Outbox wrapper already exists';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.cancel_event_request_with_notification_outbox(
  p_request_id uuid,
  p_facility_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_request public.performance_requests%ROWTYPE;
  v_actor_line_user_id text;
  v_match_id uuid;
  v_title text;
  v_text text;
  v_notification jsonb;
BEGIN
  -- Use the shared mutation gate before authorization reads and nested RPC calls.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Actor user ID is required';
  END IF;

  SELECT * INTO v_request
  FROM public.performance_requests
  WHERE id = p_request_id;
  IF NOT FOUND OR v_request.facility_id IS DISTINCT FROM p_facility_id THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'この案件をキャンセルする権限がありません');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = p_facility_id AND f.user_id = p_actor_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '施設のキャンセル権限がありません');
  END IF;

  SELECT line_user_id INTO v_actor_line_user_id
  FROM public.users WHERE id = p_actor_user_id;

  v_result := public.cancel_event_request_with_refund_internal(
    p_request_id, p_facility_id, false
  );
  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_title := COALESCE(v_request.title, '案件');

  FOR v_match_id IN
    SELECT value::uuid
    FROM jsonb_array_elements_text(COALESCE(v_result->'cancelledMatchIds', '[]'::jsonb))
  LOOP
    v_text := '施設によってイベント全体がキャンセルされました。案件：' || v_title ||
      E'\n詳細については施設へご確認ください。';

    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    SELECT DISTINCT
      'event_cancelled:' || p_request_id::text || ':' || v_match_id::text || ':' || u.line_user_id,
      u.line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    FROM public.matches m
    CROSS JOIN LATERAL unnest(
      CASE
        WHEN COALESCE(cardinality(m.participant_performer_ids), 0) > 0
          THEN m.participant_performer_ids
        ELSE ARRAY[m.performer_id]::uuid[]
      END
    ) performer_ids(performer_id)
    JOIN public.performers p ON p.id = performer_ids.performer_id
    JOIN public.users u ON u.id = p.user_id
    WHERE m.id = v_match_id
      AND u.account_status = 'active'
      AND NULLIF(u.line_user_id, '') IS NOT NULL
      AND u.line_user_id IS DISTINCT FROM v_actor_line_user_id
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_notification IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_result->'pendingDirectInviteNotifications', '[]'::jsonb))
  LOOP
    IF NULLIF(v_notification->>'lineUserId', '') IS NOT NULL
       AND v_notification->>'lineUserId' IS DISTINCT FROM v_actor_line_user_id
       AND (v_notification->>'lineUserId') NOT LIKE 'withdrawn:%' THEN
      v_text := CASE
        WHEN COALESCE((v_notification->>'refundAmount')::integer, 0) > 0
          THEN '案件「' || COALESCE(v_notification->>'requestTitle', v_title) ||
            '」のダイレクトオファーは施設による案件全体キャンセルのため取り消されました。施設には' ||
            (v_notification->>'refundAmount') || 'コインが返金されました。'
        ELSE '案件「' || COALESCE(v_notification->>'requestTitle', v_title) ||
            '」のダイレクトオファーは施設による案件全体キャンセルのため取り消されました。マッチング未成立のため料金は徴収されておらず、返金はありません。'
      END;

      INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
      VALUES (
        'event_cancelled_direct_invite:' || COALESCE(v_notification->>'applicationId', 'unknown') || ':' ||
          (v_notification->>'lineUserId'),
        v_notification->>'lineUserId',
        jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
      ) ON CONFLICT (event_key) DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.cancel_event_request_with_notification_outbox(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_event_request_with_notification_outbox(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_request_with_notification_outbox(uuid,uuid,uuid) TO service_role;

COMMIT;
