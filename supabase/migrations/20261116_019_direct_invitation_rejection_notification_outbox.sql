-- Atomically enqueue the facility notice for a performer-initiated direct-invite rejection.
-- Withdrawal uses its own wrapper in migration 021 and must not notify the withdrawing user.
-- Candidate only; requires migration 014 and cancellation policy migration 013.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.reject_direct_invitation_with_refund(uuid,uuid)') IS NULL
     OR to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.applications') IS NULL THEN
    RAISE EXCEPTION 'Required direct-invitation/outbox objects are missing';
  END IF;
  IF to_regprocedure('public.reject_direct_invitation_with_notification_outbox(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Direct invitation rejection Outbox wrapper already exists';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.reject_direct_invitation_with_notification_outbox(
  p_application_id uuid,
  p_performer_id uuid,
  p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_application public.applications%ROWTYPE;
  v_facility_user_id uuid;
  v_line_user_id text;
  v_title text;
  v_was_refunded boolean := false;
  v_performer_name text;
  v_text text;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.performers p
    WHERE p.id = p_performer_id AND p.user_id = p_actor_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_message', 'この依頼を辞退する権限がありません');
  END IF;

  SELECT * INTO v_application
  FROM public.applications
  WHERE id = p_application_id
    AND performer_id = p_performer_id
    AND source = 'facility_invite';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_message', '依頼が見つかりません');
  END IF;

  SELECT f.user_id, u.line_user_id, pr.title
  INTO v_facility_user_id, v_line_user_id, v_title
  FROM public.performance_requests pr
  JOIN public.facilities f ON f.id = pr.facility_id
  JOIN public.users u ON u.id = f.user_id
  WHERE pr.id = v_application.request_id
    AND u.account_status = 'active';

  SELECT COALESCE(NULLIF(p.name, ''), NULLIF(u.display_name, ''), '演奏者')
  INTO v_performer_name
  FROM public.performers p JOIN public.users u ON u.id = p.user_id
  WHERE p.id = p_performer_id;

  SELECT to_jsonb(r) INTO v_result
  FROM public.reject_direct_invitation_with_refund(p_application_id, p_performer_id) r;

  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN COALESCE(v_result, jsonb_build_object('success', false, 'error_message', '依頼を辞退できませんでした'));
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.coin_transactions ct
    WHERE ct.application_id = p_application_id
      AND ct.transaction_type = 'admin_adjustment'
      AND ct.amount > 0
      AND ct.idempotency_key = 'direct_invite_refund:' || p_application_id::text
  ) INTO v_was_refunded;

  v_text := COALESCE(v_performer_name, '演奏者') || 'さんが依頼を辞退しました。案件：' ||
    COALESCE(v_title, '案件') ||
    CASE WHEN v_was_refunded
      THEN E'\n旧方式で徴収されていた直接依頼手数料は返金されました。'
      ELSE E'\n今回の依頼ではマッチング成立前の手数料徴収はありません。'
    END;

  IF v_facility_user_id IS NOT NULL
     AND v_facility_user_id IS DISTINCT FROM p_actor_user_id
     AND NULLIF(v_line_user_id, '') IS NOT NULL THEN
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES (
      'direct_invitation_rejected:' || p_application_id::text || ':' || v_line_user_id,
      v_line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    ) ON CONFLICT (event_key) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.reject_direct_invitation_with_notification_outbox(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_direct_invitation_with_notification_outbox(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_direct_invitation_with_notification_outbox(uuid,uuid,uuid) TO service_role;

COMMIT;
