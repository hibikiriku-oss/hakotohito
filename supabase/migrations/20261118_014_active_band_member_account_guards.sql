-- Enforce active account ownership for every band member involved in transfers/applications.
-- Candidate only. Requires global mutation gate migration 009 and active-account RPC guards 013.
BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)') IS NULL
     OR to_regprocedure('public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Required band RPCs are missing';
  END IF;
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN pg_get_functiondef(to_regprocedure('public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)'))) = 0
     OR position('pg_advisory_xact_lock(2147483000, 20261116)' IN pg_get_functiondef(to_regprocedure('public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)'))) = 0 THEN
    RAISE EXCEPTION 'Required RPCs do not contain the expected global mutation gate';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.transfer_band_coins(p_band_id uuid, p_sender_user_id uuid, p_recipient_user_id uuid, p_amount integer, p_description text, p_idempotency_key text)
 RETURNS TABLE(success boolean, sender_balance_after integer, recipient_balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_band_status text;
  v_sender_performer_id uuid;
  v_recipient_performer_id uuid;

  v_sender_balance integer;
  v_recipient_balance integer;
  v_sender_reserved bigint := 0;

  v_new_sender_balance bigint;
  v_new_recipient_balance bigint;

  v_sender_key text;
  v_recipient_key text;
  v_sender_description text;
  v_recipient_description text;

  v_sender_tx public.coin_transactions%ROWTYPE;
  v_recipient_tx public.coin_transactions%ROWTYPE;

  v_has_sender boolean := false;
  v_has_recipient boolean := false;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 入力チェック
  IF p_band_id IS NULL
     OR p_sender_user_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_sender_user_id = p_recipient_user_id
     OR p_amount IS NULL
     OR p_amount <= 0
     OR p_description IS NULL
     OR btrim(p_description) = ''
     OR char_length(btrim(p_description)) > 100
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = ''
     OR char_length(p_idempotency_key) > 200
  THEN
    RETURN QUERY
    SELECT
      false, NULL::integer, NULL::integer,
      '送金内容が正しくありません'::text;
    RETURN;
  END IF;

  v_sender_description :=
    'バンド内送金（送信）: ' || btrim(p_description);

  v_recipient_description :=
    'バンド内送金（受信）: ' || btrim(p_description);

  v_sender_key :=
    'band_transfer:' || p_idempotency_key || ':sender';

  v_recipient_key :=
    'band_transfer:' || p_idempotency_key || ':recipient';

  -- 同じ送金リクエストの同時実行を防ぐ
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'band_transfer:' || p_idempotency_key,
      0
    )
  );

  -- 再試行なら、既存の両履歴を確認する
  SELECT ct.*
  INTO v_sender_tx
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key = v_sender_key;

  v_has_sender := FOUND;

  SELECT ct.*
  INTO v_recipient_tx
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key = v_recipient_key;

  v_has_recipient := FOUND;

  IF v_has_sender OR v_has_recipient THEN
    -- 通常は両方同時に記録される。一方だけなら異常として停止
    IF NOT v_has_sender OR NOT v_has_recipient THEN
      RETURN QUERY
      SELECT
        false, NULL::integer, NULL::integer,
        '送金履歴に不整合があります。管理者にお問い合わせください'::text;
      RETURN;
    END IF;

    -- 同じキーが別の送金内容に使われていないか確認
    IF v_sender_tx.user_id IS DISTINCT FROM p_sender_user_id
       OR v_sender_tx.amount IS DISTINCT FROM -p_amount
       OR v_sender_tx.transaction_type IS DISTINCT FROM 'band_transfer'
       OR v_sender_tx.description IS DISTINCT FROM v_sender_description
       OR v_sender_tx.band_id IS DISTINCT FROM p_band_id
       OR v_sender_tx.created_by_user_id IS DISTINCT FROM p_sender_user_id

       OR v_recipient_tx.user_id IS DISTINCT FROM p_recipient_user_id
       OR v_recipient_tx.amount IS DISTINCT FROM p_amount
       OR v_recipient_tx.transaction_type IS DISTINCT FROM 'band_transfer'
       OR v_recipient_tx.description IS DISTINCT FROM v_recipient_description
       OR v_recipient_tx.band_id IS DISTINCT FROM p_band_id
       OR v_recipient_tx.created_by_user_id IS DISTINCT FROM p_sender_user_id
    THEN
      RETURN QUERY
      SELECT
        false, NULL::integer, NULL::integer,
        '送金キーが別の取引に使用されています'::text;
      RETURN;
    END IF;

    -- 二重送金せず、前回の結果を返す
    RETURN QUERY
    SELECT
      true,
      v_sender_tx.balance_after,
      v_recipient_tx.balance_after,
      NULL::text;
    RETURN;
  END IF;

  -- バンドが活動中であることを確認
  SELECT b.status
  INTO v_band_status
  FROM public.bands b
  WHERE b.id = p_band_id
  FOR SHARE;

  IF NOT FOUND OR v_band_status IS DISTINCT FROM 'active' THEN
    RETURN QUERY
    SELECT
      false, NULL::integer, NULL::integer,
      'このバンドは現在活動していません'::text;
    RETURN;
  END IF;

  -- 送金元が現在のアクティブメンバーか確認
  SELECT p.id
  INTO v_sender_performer_id
  FROM public.band_members bm
  JOIN public.performers p
    ON p.id = bm.performer_id
  WHERE bm.band_id = p_band_id
    AND p.user_id = p_sender_user_id
    AND bm.status = 'active'
  FOR SHARE OF bm;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      false, NULL::integer, NULL::integer,
      '送金元はこのバンドのアクティブメンバーではありません'::text;
    RETURN;
  END IF;

  -- 送金先も同じバンドのアクティブメンバーか確認
  SELECT p.id
  INTO v_recipient_performer_id
  FROM public.band_members bm
  JOIN public.performers p
    ON p.id = bm.performer_id
  WHERE bm.band_id = p_band_id
    AND p.user_id = p_recipient_user_id
    AND bm.status = 'active'
  FOR SHARE OF bm;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      false, NULL::integer, NULL::integer,
      '送金先はこのバンドのアクティブメンバーではありません'::text;
    RETURN;
  END IF;

  -- Both transfer participants must still have active user accounts.
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_sender_user_id AND u.account_status = 'active'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_recipient_user_id AND u.account_status = 'active'
  ) THEN
    RETURN QUERY SELECT false, NULL::integer, NULL::integer,
      '送金元・送金先の双方に有効なアカウントが必要です'::text;
    RETURN;
  END IF;

  -- 2人の残高をUUID順にロックし、同時送金の競合を軽減
  IF p_sender_user_id < p_recipient_user_id THEN
    SELECT u.coin_balance
    INTO v_sender_balance
    FROM public.users u
    WHERE u.id = p_sender_user_id
    FOR UPDATE;

    SELECT u.coin_balance
    INTO v_recipient_balance
    FROM public.users u
    WHERE u.id = p_recipient_user_id
    FOR UPDATE;
  ELSE
    SELECT u.coin_balance
    INTO v_recipient_balance
    FROM public.users u
    WHERE u.id = p_recipient_user_id
    FOR UPDATE;

    SELECT u.coin_balance
    INTO v_sender_balance
    FROM public.users u
    WHERE u.id = p_sender_user_id
    FOR UPDATE;
  END IF;

  IF v_sender_balance IS NULL OR v_recipient_balance IS NULL THEN
    RETURN QUERY
    SELECT
      false, v_sender_balance, v_recipient_balance,
      '送金元または送金先の残高を取得できません'::text;
    RETURN;
  END IF;

  -- 送金元のオープン中レッスン募集が予約しているコインを計算
  SELECT COALESCE(SUM(lo.reserved_coins), 0)::bigint
  INTO v_sender_reserved
  FROM public.lesson_offers lo
  JOIN public.performers p
    ON p.id = lo.performer_id
  WHERE p.user_id = p_sender_user_id
    AND lo.status = 'open';

  -- 残高不足、マイナス残高、予約済みコインの使用を防止
  IF v_sender_balance < 0
     OR v_sender_balance::bigint - v_sender_reserved < p_amount::bigint
  THEN
    RETURN QUERY
    SELECT
      false, v_sender_balance, v_recipient_balance,
      '送金可能なコインが不足しています。レッスン募集の予約分は送金できません'::text;
    RETURN;
  END IF;

  v_new_sender_balance :=
    v_sender_balance::bigint - p_amount::bigint;

  v_new_recipient_balance :=
    v_recipient_balance::bigint + p_amount::bigint;

  -- 受取側のinteger上限を超えないか確認
  IF v_new_recipient_balance > 2147483647 THEN
    RETURN QUERY
    SELECT
      false, v_sender_balance, v_recipient_balance,
      '送金先の残高が上限を超えます'::text;
    RETURN;
  END IF;

  -- 残高更新。後続の履歴記録に失敗した場合も全体がロールバックされる
  UPDATE public.users
  SET coin_balance = v_new_sender_balance::integer
  WHERE id = p_sender_user_id;

  UPDATE public.users
  SET coin_balance = v_new_recipient_balance::integer
  WHERE id = p_recipient_user_id;

  -- 送金元の履歴
  INSERT INTO public.coin_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    balance_after,
    created_by_user_id,
    idempotency_key,
    band_id
  )
  VALUES (
    p_sender_user_id,
    -p_amount,
    'band_transfer',
    v_sender_description,
    v_new_sender_balance::integer,
    p_sender_user_id,
    v_sender_key,
    p_band_id
  );

  -- 送金先の履歴
  INSERT INTO public.coin_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    balance_after,
    created_by_user_id,
    idempotency_key,
    band_id
  )
  VALUES (
    p_recipient_user_id,
    p_amount,
    'band_transfer',
    v_recipient_description,
    v_new_recipient_balance::integer,
    p_sender_user_id,
    v_recipient_key,
    p_band_id
  );

  RETURN QUERY
  SELECT
    true,
    v_new_sender_balance::integer,
    v_new_recipient_balance::integer,
    NULL::text;
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

  -- Every active band member must belong to an active user account.
  IF EXISTS (
    SELECT 1
    FROM public.band_members bm
    JOIN public.performers p ON p.id = bm.performer_id
    JOIN public.users u ON u.id = p.user_id
    WHERE bm.band_id = p_band_id
      AND bm.status = 'active'
      AND u.account_status IS DISTINCT FROM 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.band_members bm
    JOIN public.performers p ON p.id = bm.performer_id
    LEFT JOIN public.users u ON u.id = p.user_id
    WHERE bm.band_id = p_band_id
      AND bm.status = 'active'
      AND u.id IS NULL
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer, 0,
      '活動中のバンドメンバー全員に有効なアカウントが必要です'::text;
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

ALTER FUNCTION public.transfer_band_coins(uuid,uuid,uuid,integer,text,text) OWNER TO postgres;
ALTER FUNCTION public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_band_coins(uuid,uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_band_coins(uuid,uuid,uuid,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text) TO service_role;

DO $postflight$
BEGIN
  IF position('送金元・送金先の双方に有効なアカウント' IN pg_get_functiondef(to_regprocedure('public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)'))) = 0
     OR position('活動中のバンドメンバー全員に有効なアカウント' IN pg_get_functiondef(to_regprocedure('public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)'))) = 0 THEN
    RAISE EXCEPTION 'Active member account guards were not installed';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
