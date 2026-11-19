-- Enqueue all withdrawal counterpart notices inside the withdrawal transaction.
-- Candidate only; depends on migration 014 and withdrawal policy migration 013.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.withdraw_user_account(text)') IS NULL
     OR to_regclass('public.line_notification_outbox') IS NULL THEN
    RAISE EXCEPTION 'Required withdrawal/outbox objects are missing';
  END IF;
  IF to_regprocedure('public.withdraw_user_account_with_notification_outbox(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawal Outbox wrapper already exists';
  END IF;
END;
$preflight$;

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
  v_text text;
  v_user_type text;
  v_refund_amount integer;
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
       OR NULLIF(v_application_id, '') IS NULL THEN
      CONTINUE;
    END IF;
    v_text := '施設が退会したため、ダイレクトオファーは取り消されました。案件：' ||
      COALESCE(v_item->>'requestTitle', '案件') || E'\nこの依頼は無効になっています。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES (
      'withdrawal_direct_cancel:' || v_application_id || ':' || v_line_user_id,
      v_line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    ) ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingDirectInviteRefundNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'applicationId';
    v_refund_amount := COALESCE((v_item->>'refundAmount')::integer, 0);
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL THEN
      CONTINUE;
    END IF;
    v_text := '演奏者が退会したため、ダイレクトオファーは取り消されました。案件：' ||
      COALESCE(v_item->>'requestTitle', '案件') ||
      CASE WHEN v_refund_amount > 0
        THEN E'\n直接依頼手数料' || v_refund_amount::text || 'コインを施設へ返金しました。'
        ELSE E'\nマッチング成立前の手数料徴収はなく、返金はありません。'
      END;
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES (
      'withdrawal_direct_refund:' || v_application_id || ':' || v_line_user_id,
      v_line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    ) ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.withdraw_user_account_with_notification_outbox(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.withdraw_user_account_with_notification_outbox(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_user_account_with_notification_outbox(text) TO service_role;

COMMIT;
