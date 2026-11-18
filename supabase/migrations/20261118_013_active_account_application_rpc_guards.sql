-- Close the stale-auth race in individual and band application RPCs.
-- The shared mutation gate serializes withdrawal and application writes; these
-- checks re-read account_status after acquiring that gate.
BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL
     OR to_regprocedure('public.apply_to_performance_request(uuid,uuid,uuid,text,uuid)') IS NULL
     OR to_regprocedure('public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Required application RPC or global gate is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users'
      AND column_name='account_status'
  ) THEN
    RAISE EXCEPTION 'users.account_status is missing';
  END IF;
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN
      pg_get_functiondef(to_regprocedure('public.apply_to_performance_request(uuid,uuid,uuid,text,uuid)'))) = 0
     OR position('pg_advisory_xact_lock(2147483000, 20261116)' IN
      pg_get_functiondef(to_regprocedure('public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)'))) = 0 THEN
    RAISE EXCEPTION 'Application RPC global gate definition differs from expected';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.apply_to_performance_request(p_user_id uuid, p_request_id uuid, p_performer_id uuid, p_message text, p_attempt_id uuid)
 RETURNS TABLE(success boolean, application_id uuid, balance_after integer, error_message text, is_reapply boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.performance_requests%ROWTYPE;
  v_performer public.performers%ROWTYPE;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_found boolean := false;
  v_application_id uuid;
  v_balance_after integer;
  v_required_fee integer := 10;
  v_error_message text;
  v_is_reapply boolean := false;
BEGIN
    PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND u.account_status = 'active'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '有効なアカウントが必要です'::text, false;
    RETURN;
  END IF;
-- 入力値確認
  IF p_user_id IS NULL
     OR p_request_id IS NULL
     OR p_performer_id IS NULL
     OR p_attempt_id IS NULL THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      '応募情報が正しくありません'::text, false;
    RETURN;
  END IF;

  IF p_message IS NOT NULL
     AND char_length(p_message) > 2000 THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      '応募メッセージは2000文字以内で入力してください'::text,
      false;
    RETURN;
  END IF;

  -- 演奏者とLINEユーザーの紐付けをDB側でも確認
  SELECT *
  INTO v_performer
  FROM public.performers p
  WHERE p.id = p_performer_id
    AND p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      '応募する権限がありません'::text, false;
    RETURN;
  END IF;

  -- 案件をロックして同時応募・募集状態変更を制御
  SELECT *
  INTO v_request
  FROM public.performance_requests pr
  WHERE pr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      '案件が見つかりません'::text, false;
    RETURN;
  END IF;

  IF v_request.status <> 'open' THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      'この案件は現在応募できません'::text, false;
    RETURN;
  END IF;

  -- 応募期限確認（締切日当日は応募可能）
  IF v_request.application_deadline IS NULL
     OR (now() AT TIME ZONE 'Asia/Tokyo')::date
        > v_request.application_deadline THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      '応募期限を過ぎています'::text, false;
    RETURN;
  END IF;

  -- 募集対象レベル確認
  -- NULLまたは空配列なら制限なし
  IF COALESCE(cardinality(v_request.target_levels), 0) > 0 THEN
    IF v_performer.status_level IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM unnest(v_request.target_levels) AS target(level)
         WHERE
           CASE lower(btrim(target.level))
             WHEN 'beginner' THEN 'beginner'
             WHEN '初心者' THEN 'beginner'
             WHEN '初級' THEN 'beginner'
             WHEN '初級者' THEN 'beginner'
             WHEN 'amateur' THEN 'amateur'
             WHEN 'アマチュア' THEN 'amateur'
             WHEN 'pro' THEN 'pro'
             WHEN 'プロ' THEN 'pro'
             WHEN 'プロフェッショナル' THEN 'pro'
             ELSE lower(btrim(target.level))
           END
           =
           CASE lower(btrim(v_performer.status_level))
             WHEN 'beginner' THEN 'beginner'
             WHEN '初心者' THEN 'beginner'
             WHEN '初級' THEN 'beginner'
             WHEN '初級者' THEN 'beginner'
             WHEN 'amateur' THEN 'amateur'
             WHEN 'アマチュア' THEN 'amateur'
             WHEN 'pro' THEN 'pro'
             WHEN 'プロ' THEN 'pro'
             WHEN 'プロフェッショナル' THEN 'pro'
             ELSE lower(btrim(v_performer.status_level))
           END
       ) THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        '登録プロフィールの演奏者レベルが募集対象外のため応募できません'::text,
        false;
      RETURN;
    END IF;
  END IF;

  -- 応募時は徴収せず、必要残高だけを確認する。
  SELECT COALESCE(s.application_fee_coins, 10)
  INTO v_required_fee
  FROM public.coin_rate_settings s
  WHERE s.id = 1;
  IF NOT FOUND THEN v_required_fee := 10; END IF;
  IF v_required_fee < 1 OR v_required_fee > 1000000 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '応募手数料の設定値が不正です'::text, false;
    RETURN;
  END IF;

  SELECT u.coin_balance
  INTO v_balance_after
  FROM public.users u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      'ユーザー情報が見つかりません'::text, false;
    RETURN;
  END IF;

  IF COALESCE(v_balance_after, 0) < v_required_fee THEN
    RETURN QUERY SELECT false, NULL::uuid, v_balance_after,
      'コイン不足のため応募できません'::text, false;
    RETURN;
  END IF;

  -- 個人応募だけを確認（バンド応募は除外）
  SELECT a.id, a.status
  INTO v_existing_id, v_existing_status
  FROM public.applications a
  WHERE a.request_id = p_request_id
    AND a.performer_id = p_performer_id
    AND a.band_id IS NULL
  FOR UPDATE;

  v_existing_found := FOUND;

  IF v_existing_found THEN
    IF v_existing_status = 'pending' AND EXISTS (
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

    IF v_existing_status = 'pending' THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'この案件にはすでに応募しています'::text, false;
      RETURN;
    END IF;

    IF v_existing_status = 'accepted' THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'この案件にはすでに採用されています'::text, false;
      RETURN;
    END IF;

    IF v_existing_status <> 'rejected' THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'この応募は現在再応募できない状態です'::text, false;
      RETURN;
    END IF;

    v_is_reapply := true;
  END IF;

  -- 応募登録と試行記録を同一トランザクションで作成する。
  BEGIN
    IF v_is_reapply THEN
      UPDATE public.applications
      SET message = NULLIF(p_message, ''), status = 'pending', source = 'performer_apply'
      WHERE id = v_existing_id
      RETURNING id INTO v_application_id;

      UPDATE public.application_attempts
      SET status = 'rejected', updated_at = now()
      WHERE application_id = v_application_id AND status = 'pending';
    ELSE
      INSERT INTO public.applications (
        request_id, performer_id, message, status, source, band_id
      ) VALUES (
        p_request_id, p_performer_id, NULLIF(p_message, ''), 'pending', 'performer_apply', NULL
      ) RETURNING id INTO v_application_id;
    END IF;

    INSERT INTO public.application_attempts (
      id, application_id, request_id, performer_id, band_id, payer_user_id,
      source, fee_type, fee_amount, fee_due, status, started_at, expires_at
    ) VALUES (
      p_attempt_id, v_application_id, p_request_id, p_performer_id, NULL, p_user_id,
      'performer_apply', 'application_fee', v_required_fee, true, 'pending',
      now(), now() + interval '7 days'
    );

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      v_error_message, v_is_reapply;
    RETURN;
  END;

  RETURN QUERY SELECT
    true,
    v_application_id,
    v_balance_after,
    NULL::text,
    v_is_reapply;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_to_performance_request_as_band(p_user_id uuid, p_performer_id uuid, p_band_id uuid, p_request_id uuid, p_message text)
 RETURNS TABLE(success boolean, application_id uuid, balance_after integer, coins_spent integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_band public.bands%ROWTYPE;
  v_request public.performance_requests%ROWTYPE;
  v_application public.applications%ROWTYPE;
  v_existing_transaction public.coin_transactions%ROWTYPE;
  v_attempt_id uuid := gen_random_uuid();
  v_balance integer;
  v_required_coins integer;
  v_attempt_count integer;
  v_idempotency_key text;
  v_spend_success boolean;
  v_spend_balance integer;
  v_spend_error text;
  v_member_count integer;
  v_error_message text;
BEGIN
    PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id
      AND u.account_status = 'active'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, NULL::integer,
      '有効なアカウントが必要です'::text;
    RETURN;
  END IF;
-- 入力値確認
  IF p_user_id IS NULL
     OR p_performer_id IS NULL
     OR p_band_id IS NULL
     OR p_request_id IS NULL THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      '応募情報が正しくありません'::text;
    RETURN;
  END IF;

  IF p_message IS NOT NULL AND char_length(p_message) > 2000 THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      '応募メッセージは2000文字以内で入力してください'::text;
    RETURN;
  END IF;

  -- 実行者と演奏者の紐付けを確認
  PERFORM 1
  FROM public.performers p
  WHERE p.id = p_performer_id
    AND p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      '演奏者情報を確認できません'::text;
    RETURN;
  END IF;

  -- ① 案件行を最初にロック
  SELECT *
  INTO v_request
  FROM public.performance_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      '案件が見つかりません'::text;
    RETURN;
  END IF;

  -- ② バンド行をロック
  SELECT *
  INTO v_band
  FROM public.bands
  WHERE id = p_band_id
  FOR UPDATE;

  IF NOT FOUND OR v_band.status <> 'active' THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      '活動中のバンドが見つかりません'::text;
    RETURN;
  END IF;

  -- リーダー本人か確認
  PERFORM 1
  FROM public.band_members bm
  WHERE bm.band_id = p_band_id
    AND bm.performer_id = p_performer_id
    AND bm.role = 'leader'
    AND bm.status = 'active';

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      'バンドリーダーだけがバンド名義で応募できます'::text;
    RETURN;
  END IF;

  -- 案件の応募条件確認
  IF v_request.status <> 'open' THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      'この案件は現在応募できません'::text;
    RETURN;
  END IF;

  IF v_request.application_deadline IS NULL
     OR (now() AT TIME ZONE 'Asia/Tokyo')::date
        > v_request.application_deadline THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      '応募期限を過ぎています'::text;
    RETURN;
  END IF;

  -- 活動中のメンバー数を確認
  SELECT count(*)::integer
  INTO v_member_count
  FROM public.band_members bm
  WHERE bm.band_id = p_band_id
    AND bm.status = 'active';

  IF v_member_count = 0 THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      'バンドに活動中のメンバーがいません'::text;
    RETURN;
  END IF;

  -- 募集対象レベルを確認
  IF COALESCE(cardinality(v_request.target_levels), 0) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM public.band_members bm
      JOIN public.performers p
        ON p.id = bm.performer_id
      WHERE bm.band_id = p_band_id
        AND bm.status = 'active'
        AND (
          p.status_level IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM unnest(v_request.target_levels) AS target(level)
            WHERE
              CASE lower(btrim(target.level))
                WHEN 'beginner' THEN 'beginner'
                WHEN '初心者' THEN 'beginner'
                WHEN '初級' THEN 'beginner'
                WHEN '初級者' THEN 'beginner'
                WHEN 'amateur' THEN 'amateur'
                WHEN 'アマチュア' THEN 'amateur'
                WHEN 'pro' THEN 'pro'
                WHEN 'プロ' THEN 'pro'
                WHEN 'プロフェッショナル' THEN 'pro'
                ELSE lower(btrim(target.level))
              END
              =
              CASE lower(btrim(p.status_level))
                WHEN 'beginner' THEN 'beginner'
                WHEN '初心者' THEN 'beginner'
                WHEN '初級' THEN 'beginner'
                WHEN '初級者' THEN 'beginner'
                WHEN 'amateur' THEN 'amateur'
                WHEN 'アマチュア' THEN 'amateur'
                WHEN 'pro' THEN 'pro'
                WHEN 'プロ' THEN 'pro'
                WHEN 'プロフェッショナル' THEN 'pro'
                ELSE lower(btrim(p.status_level))
              END
          )
        )
    ) THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer, 0,
        '活動中のバンドメンバー全員が募集対象レベルに該当する必要があります'::text;
      RETURN;
    END IF;
  END IF;

  -- ③ 既存応募レコードをロック
  SELECT *
  INTO v_application
  FROM public.applications a
  WHERE a.request_id = p_request_id
    AND a.band_id = p_band_id
  FOR UPDATE;

  -- コイン設定を取得
  SELECT COALESCE(s.application_fee_coins, 10)
  INTO v_required_coins
  FROM public.coin_rate_settings s
  WHERE s.id = 1
  FOR SHARE;

  IF NOT FOUND THEN
    v_required_coins := 10;
  END IF;

  IF v_required_coins IS NULL
     OR v_required_coins < 1
     OR v_required_coins > 1000000 THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      '応募手数料の設定値が不正です'::text;
    RETURN;
  END IF;

  -- ④ リーダーのユーザー残高をロック
  SELECT COALESCE(u.coin_balance, 0)
  INTO v_balance
  FROM public.users u
  WHERE u.id = p_user_id
  ;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      'ユーザー情報が見つかりません'::text;
    RETURN;
  END IF;

  -- 既存応募の状態確認。7日経過した試行はここでも期限切れにする。
  IF v_application.id IS NOT NULL THEN
    IF v_application.status = 'pending' AND EXISTS (
      SELECT 1 FROM public.application_attempts aa
      WHERE aa.application_id = v_application.id
        AND aa.status = 'pending' AND aa.expires_at <= now()
    ) THEN
      UPDATE public.application_attempts
      SET status = 'expired', updated_at = now()
      WHERE application_id = v_application.id
        AND status = 'pending' AND expires_at <= now();
      UPDATE public.applications SET status = 'rejected'
      WHERE id = v_application.id AND status = 'pending';
      v_application.status := 'rejected';
    END IF;

    IF v_application.status = 'accepted' THEN
      RETURN QUERY SELECT
        false, v_application.id, v_balance, 0,
        'このバンドはすでにこの案件に採用されています'::text;
      RETURN;
    END IF;

    IF v_application.status = 'pending' THEN
      RETURN QUERY SELECT false, v_application.id, v_balance, 0,
        'このバンドはすでにこの案件に応募しています'::text;
      RETURN;
    END IF;
  END IF;

  -- 新規応募または却下済み応募の再応募。応募時には徴収せず、残高のみ確認。
  IF COALESCE(v_balance, 0) < v_required_coins THEN
    RETURN QUERY SELECT false, NULL::uuid, v_balance, 0,
      'コイン不足のため応募できません'::text;
    RETURN;
  END IF;

  BEGIN
    IF v_application.id IS NOT NULL THEN
      UPDATE public.applications
      SET performer_id = p_performer_id,
          message = NULLIF(btrim(COALESCE(p_message, '')), ''),
          status = 'pending', source = 'band_apply'
      WHERE id = v_application.id
      RETURNING * INTO v_application;

      UPDATE public.application_attempts
      SET status = 'rejected', updated_at = now()
      WHERE application_id = v_application.id AND status = 'pending';
    ELSE
      INSERT INTO public.applications (
        request_id, performer_id, band_id, message, status, source
      ) VALUES (
        p_request_id, p_performer_id, p_band_id,
        NULLIF(btrim(COALESCE(p_message, '')), ''), 'pending', 'band_apply'
      ) RETURNING * INTO v_application;
    END IF;

    INSERT INTO public.application_attempts (
      id, application_id, request_id, performer_id, band_id, payer_user_id,
      source, fee_type, fee_amount, fee_due, status, started_at, expires_at
    ) VALUES (
      v_attempt_id, v_application.id, p_request_id, p_performer_id, p_band_id,
      p_user_id, 'band_apply', 'application_fee', v_required_coins, true,
      'pending', now(), now() + interval '7 days'
    );

    RETURN QUERY SELECT true, v_application.id, v_balance, 0, NULL::text;
    RETURN;

  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, NULL::uuid, v_balance, 0,
      'このバンドはすでにこの案件に応募しています'::text;
    RETURN;
  WHEN OTHERS THEN
    RETURN QUERY SELECT false, NULL::uuid, v_balance, 0,
      '応募登録に失敗しました'::text;
    RETURN;
  END;
END;
$function$;

DO $postflight$
BEGIN
  IF position('account_status' IN pg_get_functiondef(
       to_regprocedure('public.apply_to_performance_request(uuid,uuid,uuid,text,uuid)'))) = 0
     OR position('account_status' IN pg_get_functiondef(
       to_regprocedure('public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)'))) = 0 THEN
    RAISE EXCEPTION 'Active-account guard missing from application RPC';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
