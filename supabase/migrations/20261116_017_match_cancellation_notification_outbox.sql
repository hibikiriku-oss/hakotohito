-- Atomically enqueue the counterparty notification with match cancellation/refunds.
-- Candidate only; requires 014 and 013. Does not modify the legacy RPC signature
-- protected by migration 009's routine-definition preflight.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.cancel_match_with_direct_invite_refund(uuid,uuid)') IS NULL
     OR to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.matches') IS NULL THEN
    RAISE EXCEPTION 'Required cancellation/outbox objects are missing';
  END IF;
  IF to_regprocedure('public.cancel_match_with_notification_outbox(uuid,uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Cancellation Outbox wrapper already exists';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.cancel_match_with_notification_outbox(
  p_match_id uuid,
  p_facility_id uuid,
  p_actor_user_id uuid,
  p_actor_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_match public.matches%ROWTYPE;
  v_request public.performance_requests%ROWTYPE;
  v_result jsonb;
  v_is_facility_actor boolean := false;
  v_is_performer_actor boolean := false;
  v_text text;
BEGIN
  -- Use the shared mutation gate before authorization reads and nested RPC calls.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_actor_user_id IS NULL OR p_actor_role IS NULL
     OR p_actor_role NOT IN ('facility', 'performer') THEN
    RAISE EXCEPTION 'A valid actor user ID and role are required';
  END IF;

  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'マッチングが見つかりません');
  END IF;

  SELECT * INTO v_request
  FROM public.performance_requests
  WHERE id = v_match.request_id;
  IF NOT FOUND OR v_request.facility_id IS DISTINCT FROM p_facility_id THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'この案件をキャンセルする権限がありません');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = p_facility_id AND f.user_id = p_actor_user_id
  ) INTO v_is_facility_actor;

  SELECT EXISTS (
    SELECT 1
    FROM public.performers p
    WHERE p.user_id = p_actor_user_id
      AND (
        (
          v_match.band_id IS NULL
          AND p.id = v_match.performer_id
        )
        OR (
          v_match.band_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.band_members bm
            WHERE bm.band_id = v_match.band_id
              AND bm.performer_id = p.id
              AND bm.status = 'active'
              AND bm.role = 'leader'
          )
        )
      )
  ) INTO v_is_performer_actor;

  IF p_actor_role = 'facility' AND NOT v_is_facility_actor THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'この施設のキャンセル権限がありません');
  ELSIF p_actor_role = 'performer' AND NOT v_is_performer_actor THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'この演奏者のキャンセル権限がありません');
  END IF;

  v_is_facility_actor := p_actor_role = 'facility';
  v_is_performer_actor := p_actor_role = 'performer';

  v_result := public.cancel_match_with_direct_invite_refund(p_match_id, p_facility_id);
  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_text := CASE WHEN v_is_facility_actor
    THEN '施設がマッチングをキャンセルしました。案件：' || COALESCE(v_request.title, '案件') || E'\nLINEミニアプリから詳細をご確認ください。'
    ELSE '演奏者がマッチングをキャンセルしました。案件：' || COALESCE(v_request.title, '案件') || E'\nLINEミニアプリから詳細をご確認ください。'
  END;

  IF v_is_facility_actor THEN
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    SELECT DISTINCT
      'match_cancelled:' || p_match_id::text || ':' || p_actor_user_id::text || ':' || u.line_user_id,
      u.line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    FROM (
      SELECT v_match.performer_id AS performer_id
      UNION
      SELECT unnest(COALESCE(v_match.participant_performer_ids, ARRAY[]::uuid[]))
    ) ids
    JOIN public.performers p ON p.id = ids.performer_id
    JOIN public.users u ON u.id = p.user_id
    WHERE u.account_status = 'active'
      AND NULLIF(u.line_user_id, '') IS NOT NULL
      AND u.id IS DISTINCT FROM p_actor_user_id
    ON CONFLICT (event_key) DO NOTHING;
  ELSE
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    SELECT
      'match_cancelled:' || p_match_id::text || ':' || p_actor_user_id::text || ':' || u.line_user_id,
      u.line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    FROM public.facilities f
    JOIN public.users u ON u.id = f.user_id
    WHERE f.id = p_facility_id
      AND u.account_status = 'active'
      AND NULLIF(u.line_user_id, '') IS NOT NULL
      AND u.id IS DISTINCT FROM p_actor_user_id
    ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.cancel_match_with_notification_outbox(uuid,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_match_with_notification_outbox(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_match_with_notification_outbox(uuid,uuid,uuid,text) TO service_role;

COMMIT;
