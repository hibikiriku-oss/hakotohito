-- Close active-account TOCTOU gaps while preserving deferred direct-invitation fees and attempt expiry.
-- Candidate only: no SQL has been executed against any Supabase project.
BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL
     OR to_regprocedure('public.create_band_with_leader(uuid,text,text)') IS NULL
     OR to_regprocedure('public.create_facility_invitation_with_coins(uuid,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Required global gate or target RPC is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users'
      AND column_name='account_status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='performers'
      AND column_name='user_id'
  ) THEN
    RAISE EXCEPTION 'Required account ownership columns are missing';
  END IF;
  IF to_regclass('public.application_attempts') IS NULL THEN
    RAISE EXCEPTION 'application_attempts is missing; deferred-fee direct invitations cannot be installed';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='application_attempts'
        AND column_name IN ('id','application_id','request_id','performer_id','band_id','payer_user_id','source','fee_type','fee_amount','fee_due','status','started_at','expires_at')) <> 13 THEN
    RAISE EXCEPTION 'application_attempts does not match the deferred-fee direct-invitation contract';
  END IF;
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN
      pg_get_functiondef(to_regprocedure('public.create_band_with_leader(uuid,text,text)'))) = 0
     OR position('pg_advisory_xact_lock(2147483000, 20261116)' IN
      pg_get_functiondef(to_regprocedure('public.create_facility_invitation_with_coins(uuid,uuid,uuid,text)'))) = 0 THEN
    RAISE EXCEPTION 'Target RPC no longer acquires the expected global mutation gate';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.create_band_with_leader(p_performer_id uuid, p_name text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(band_id uuid, band_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_band_id uuid;
  v_name text;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_performer_id IS NULL
     OR p_name IS NULL
     OR char_length(trim(p_name)) < 1
     OR char_length(trim(p_name)) > 100 THEN
    RAISE EXCEPTION 'バンド名が正しくありません';
  END IF;

  -- Resolve the profile owner after the shared gate and reject withdrawn accounts.
  IF NOT EXISTS (
    SELECT 1
    FROM public.performers p
    JOIN public.users u ON u.id = p.user_id
    WHERE p.id = p_performer_id
      AND u.account_status = 'active'
  ) THEN
    RAISE EXCEPTION '有効な演奏者プロフィールが見つかりません';
  END IF;

  INSERT INTO public.bands (
    name,
    description,
    created_by_performer_id
  )
  VALUES (
    trim(p_name),
    NULLIF(trim(COALESCE(p_description, '')), ''),
    p_performer_id
  )
  RETURNING id, name
  INTO v_band_id, v_name;

  INSERT INTO public.band_members (
    band_id,
    performer_id,
    role,
    status
  )
  VALUES (
    v_band_id,
    p_performer_id,
    'leader',
    'active'
  );

  RETURN QUERY SELECT v_band_id, v_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_facility_invitation_with_coins(p_facility_user_id uuid, p_request_id uuid, p_performer_id uuid, p_message text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, application_id uuid, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_application_id uuid;
  v_coin_result record;
  v_idempotency_key text;
  v_facility_balance integer;
  v_required_fee integer := 100;
  v_attempt_id uuid := gen_random_uuid();
  v_existing_id uuid;
  v_existing_status text;
  v_request_status text;
BEGIN
    PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- Re-read both account states after the shared gate to close stale-auth races.
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_facility_user_id
      AND u.account_status = 'active'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '有効な施設アカウントが必要です'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.performers p
    JOIN public.users u ON u.id = p.user_id
    WHERE p.id = p_performer_id
      AND u.account_status = 'active'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '指定された演奏者は有効ではありません'::text;
    RETURN;
  END IF;
-- 1. 案件をロックし、施設の所有権を確認
  SELECT pr.status
    INTO v_request_status
  FROM public.performance_requests pr
  INNER JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE pr.id = p_request_id
    AND f.user_id = p_facility_user_id
  FOR UPDATE OF pr;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      false,
      NULL::uuid,
      NULL::integer,
      '案件が存在しないか、操作する権限がありません'::text;
    RETURN;
  END IF;

  -- 2. 募集中の案件だけ許可
  IF v_request_status <> 'open' THEN
    RETURN QUERY
    SELECT
      false,
      NULL::uuid,
      NULL::integer,
      'この案件は現在、直接オファーを受け付けていません'::text;
    RETURN;
  END IF;

  -- 3. 演奏者の存在を確認
  IF NOT EXISTS (
    SELECT 1
    FROM public.performers p
    WHERE p.id = p_performer_id
  ) THEN
    RETURN QUERY
    SELECT
      false,
      NULL::uuid,
      NULL::integer,
      '指定された演奏者が存在しません'::text;
    RETURN;
  END IF;

  -- 依頼時は徴収せず、施設の残高だけを確認する。
  SELECT COALESCE(s.direct_invitation_fee_coins, 100)
  INTO v_required_fee
  FROM public.coin_rate_settings s
  WHERE s.id = 1;
  IF NOT FOUND THEN v_required_fee := 100; END IF;
  IF v_required_fee < 1 OR v_required_fee > 1000000 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '直接依頼手数料の設定値が不正です'::text;
    RETURN;
  END IF;

  SELECT u.coin_balance INTO v_facility_balance
  FROM public.users u WHERE u.id = p_facility_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '施設ユーザー情報が見つかりません'::text;
    RETURN;
  END IF;

  IF COALESCE(v_facility_balance, 0) < v_required_fee THEN
    RETURN QUERY SELECT false, NULL::uuid, v_facility_balance,
      'コイン不足のため直接依頼できません'::text;
    RETURN;
  END IF;

  -- 4. 同じ案件・演奏者の既存応募を確認。期限切れ／却下済みなら再依頼可能。
  SELECT a.id, a.status
  INTO v_existing_id, v_existing_status
  FROM public.applications a
  WHERE a.request_id = p_request_id
    AND a.performer_id = p_performer_id
  FOR UPDATE;

  IF v_existing_id IS NOT NULL AND v_existing_status = 'pending' AND EXISTS (
    SELECT 1 FROM public.application_attempts aa
    WHERE aa.application_id = v_existing_id
      AND aa.status = 'pending' AND aa.expires_at <= now()
  ) THEN
    UPDATE public.application_attempts
    SET status = 'expired', updated_at = now()
    WHERE application_id = v_existing_id
      AND status = 'pending' AND expires_at <= now();
    UPDATE public.applications SET status = 'rejected'
    WHERE id = v_existing_id AND status = 'pending';
    v_existing_status := 'rejected';
  END IF;

  IF v_existing_id IS NOT NULL AND v_existing_status IN ('pending', 'accepted') THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      'この演奏者にはすでに応募または依頼済みです'::text;
    RETURN;
  END IF;

  -- 5. 既存の冪等性キーを維持
  v_idempotency_key :=
    'direct_invite_fee:'
    || p_request_id::text
    || ':'
    || p_performer_id::text;

  -- 6. 直接オファーを登録。既存の却下済み応募は同じ行を再利用する。
  BEGIN
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.applications
      SET message = NULLIF(p_message, ''), status = 'pending',
          source = 'facility_invite', band_id = NULL
      WHERE id = v_existing_id
      RETURNING id INTO v_application_id;

      UPDATE public.application_attempts
      SET status = 'rejected', updated_at = now()
      WHERE application_id = v_application_id AND status = 'pending';
    ELSE
      INSERT INTO public.applications (
        request_id, performer_id, message, status, source, band_id
      ) VALUES (
        p_request_id, p_performer_id, NULLIF(p_message, ''),
        'pending', 'facility_invite', NULL
      ) RETURNING id INTO v_application_id;
    END IF;

  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      'この演奏者にはすでに応募または依頼済みです'::text;
    RETURN;
  END;

  -- 依頼作成時には徴収しない。成立時の原子処理で徴収する。
  INSERT INTO public.application_attempts (
    id, application_id, request_id, performer_id, band_id, payer_user_id,
    source, fee_type, fee_amount, fee_due, status, started_at, expires_at
  ) VALUES (
    v_attempt_id, v_application_id, p_request_id, p_performer_id, NULL,
    p_facility_user_id, 'facility_invite', 'direct_invite_fee',
    v_required_fee, true, 'pending', now(), now() + interval '7 days'
  );

  RETURN QUERY
  SELECT
    true,
    v_application_id,
    v_facility_balance,
    NULL::text;
END;
$function$;

DO $postflight$
BEGIN
  IF position('account_status' IN
      pg_get_functiondef(to_regprocedure('public.create_band_with_leader(uuid,text,text)'))) = 0
     OR position('account_status' IN
      pg_get_functiondef(to_regprocedure('public.create_facility_invitation_with_coins(uuid,uuid,uuid,text)'))) = 0 THEN
    RAISE EXCEPTION 'Active-account checks are missing from the updated RPC definitions';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
