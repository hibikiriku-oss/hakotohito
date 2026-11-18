-- Match-time charging for direct invitations and performer/band applications.
-- Depends on migrations 009, 010, 011; candidate only.
BEGIN;

-- Serialize this migration with every application mutation using the shared gate.
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL
     OR to_regclass('public.application_attempts') IS NULL THEN
    RAISE EXCEPTION 'Apply migrations 009 and 010 before this migration';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.accept_direct_invitation_atomic(p_application_id uuid, p_performer_id uuid)
 RETURNS TABLE(success boolean, match_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_request_status text;
  v_request_type text;
  v_max_participants integer;
  v_facility_user_id uuid;
  v_application_performer_id uuid;
  v_application_source text;
  v_application_status text;
  v_match_id uuid;
  v_updated_count integer;
  v_active_count bigint;
  v_coin_result record;
  v_idempotency_key text;
  v_event boolean;
  v_first_event_match boolean;
  v_attempt public.application_attempts%ROWTYPE;
  v_required_direct_fee integer := 100;
  v_required_match_fee integer := 100;
  v_balance_after integer;
BEGIN
    PERFORM pg_advisory_xact_lock(2147483000, 20261116);
-- 案件をロックして取得
  SELECT
    pr.id,
    pr.status,
    pr.request_type,
    pr.max_participants,
    f.user_id
  INTO
    v_request_id,
    v_request_status,
    v_request_type,
    v_max_participants,
    v_facility_user_id
  FROM public.applications a
  JOIN public.performance_requests pr
    ON pr.id = a.request_id
  JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE a.id = p_application_id
  FOR UPDATE OF pr;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      '案件または施設情報が見つかりません'::text;
    RETURN;
  END IF;

  v_event := v_request_type IN (
    'live', 'festival', 'session', 'rental'
  );

  -- 募集状態を確認
  IF v_event THEN
    IF v_request_status NOT IN ('open', 'matched') THEN
      RETURN QUERY SELECT
        false, NULL::uuid,
        'この募集は終了しています'::text;
      RETURN;
    END IF;
  ELSE
    IF v_request_status <> 'open' THEN
      RETURN QUERY SELECT
        false, NULL::uuid,
        'この募集は終了しています'::text;
      RETURN;
    END IF;
  END IF;

  -- 直接依頼の対象者・状態を確認
  SELECT
    a.performer_id,
    a.source,
    a.status
  INTO
    v_application_performer_id,
    v_application_source,
    v_application_status
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.request_id = v_request_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_application_performer_id <> p_performer_id THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      '依頼が見つかりません'::text;
    RETURN;
  END IF;

  IF v_application_source <> 'facility_invite' THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      '直接依頼ではありません'::text;
    RETURN;
  END IF;

  IF v_application_status <> 'pending' THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      'この依頼はすでに処理されています'::text;
    RETURN;
  END IF;

  SELECT * INTO v_attempt
  FROM public.application_attempts aa
  WHERE aa.application_id = p_application_id
    AND aa.status = 'pending'
  ORDER BY aa.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid,
      '応募試行情報が見つかりません。運営にお問い合わせください'::text;
    RETURN;
  END IF;

  IF v_attempt.expires_at <= now() THEN
    UPDATE public.application_attempts
    SET status = 'expired', updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.applications SET status = 'rejected'
    WHERE id = p_application_id AND status = 'pending';
    RETURN QUERY SELECT false, NULL::uuid,
      '応募期限の7日間が経過しています'::text;
    RETURN;
  END IF;

  IF v_attempt.source <> 'facility_invite'
     OR v_attempt.fee_type <> 'direct_invite_fee'
     OR v_attempt.fee_amount < 1 OR v_attempt.fee_amount > 1000000
     OR v_attempt.payer_user_id IS DISTINCT FROM v_facility_user_id THEN
    RETURN QUERY SELECT false, NULL::uuid,
      '直接依頼の課金情報が一致しません'::text;
    RETURN;
  END IF;

  SELECT COALESCE(s.direct_invitation_fee_coins, 100),
         COALESCE(s.match_fee_coins, 100)
  INTO v_required_direct_fee, v_required_match_fee
  FROM public.coin_rate_settings s
  WHERE s.id = 1;

  IF v_required_direct_fee < 1 OR v_required_direct_fee > 1000000
     OR v_required_match_fee < 1 OR v_required_match_fee > 1000000 THEN
    RETURN QUERY SELECT false, NULL::uuid, '手数料設定が不正です'::text;
    RETURN;
  END IF;

  -- 同じ演奏者の有効なマッチングを防止
  IF EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.request_id = v_request_id
      AND m.performer_id = p_performer_id
      AND m.status = 'active'
  ) THEN
    RETURN QUERY SELECT
      false, NULL::uuid,
      'この演奏者はすでにマッチング済みです'::text;
    RETURN;
  END IF;

  -- イベント・レンタルは定員を確認
  IF v_event THEN
    SELECT COALESCE(SUM(m.participant_count), 0)::bigint
    INTO v_active_count
    FROM public.matches m
    WHERE m.request_id = v_request_id
      AND m.status = 'active'
      AND m.performance_status IS DISTINCT FROM 'cancelled';

    IF v_max_participants IS NOT NULL
       AND v_active_count >= v_max_participants THEN
      UPDATE public.performance_requests
      SET status = 'matched'
      WHERE id = v_request_id;

      RETURN QUERY SELECT
        false, NULL::uuid,
        '募集定員に達しています'::text;
      RETURN;
    END IF;

    IF v_max_participants IS NOT NULL
       AND v_active_count + 1 > v_max_participants THEN
      RETURN QUERY SELECT false, NULL::uuid,
        '募集定員を超えるため承諾できません'::text;
      RETURN;
    END IF;
  ELSE
    -- 通常案件は1人のみ
    IF EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.request_id = v_request_id
        AND m.status = 'active'
    ) THEN
      RETURN QUERY SELECT
        false, NULL::uuid,
        'この案件はすでにマッチング済みです'::text;
      RETURN;
    END IF;
  END IF;

  -- 新規マッチングを作成
  -- application_id に承諾した直接依頼のIDを保存する
  INSERT INTO public.matches (
    request_id,
    application_id,
    performer_id,
    status,
    completion_fee_eligible
  )
  VALUES (
    v_request_id,
    p_application_id,
    p_performer_id,
    'active',
    true
  )
  RETURNING id INTO v_match_id;

  -- 直接依頼料金とマッチング成立料金は、成立処理内でのみ徴収する。
  -- 先行する料金徴収が成功しても後続料金が不足すれば、この例外で全体をrollbackする。
  BEGIN
    IF v_attempt.fee_due THEN
      SELECT * INTO v_coin_result
      FROM public.spend_coins(
        v_facility_user_id,
        v_attempt.fee_amount,
        'direct_invite_fee',
        '直接依頼マッチング成立手数料',
        'direct_invite_match_fee:' || v_attempt.id::text,
        v_request_id,
        p_application_id,
        v_match_id
      );
      IF NOT COALESCE(v_coin_result.success, false) THEN
        RAISE EXCEPTION '施設のコイン残高が不足しています。コイン不足のためマッチングできません: %',
          COALESCE(v_coin_result.error_message, '残高不足');
      END IF;
    END IF;
  END;

  UPDATE public.applications
  SET status = 'accepted'
  WHERE id = p_application_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION
      '承諾した依頼の状態を更新できませんでした';
  END IF;

  UPDATE public.application_attempts
  SET status = 'matched', matched_at = now(), match_id = v_match_id,
      fee_charged_at = CASE WHEN fee_due THEN now() ELSE fee_charged_at END,
      updated_at = now()
  WHERE id = v_attempt.id;

  IF v_event THEN
    -- イベントは定員到達時のみ募集を終了
    SELECT COALESCE(SUM(m.participant_count), 0)::bigint
    INTO v_active_count
    FROM public.matches m
    WHERE m.request_id = v_request_id
      AND m.status = 'active'
      AND m.performance_status IS DISTINCT FROM 'cancelled';

    IF v_max_participants IS NOT NULL
       AND v_active_count >= v_max_participants THEN
      UPDATE public.performance_requests
      SET status = 'matched'
      WHERE id = v_request_id;
    END IF;

    -- 初回成立料100コインは案件につき1回
    v_idempotency_key :=
      'event_match_fee:' || v_request_id::text;

    SELECT NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_idempotency_key
    )
    INTO v_first_event_match;

    IF v_first_event_match THEN
      SELECT *
      INTO v_coin_result
      FROM public.spend_coins(
        v_facility_user_id,
        v_required_match_fee,
        'match_fee',
        'イベント・レンタル初回マッチング成立手数料',
        v_idempotency_key,
        v_request_id,
        p_application_id,
        v_match_id
      );

      IF NOT COALESCE(v_coin_result.success, false) THEN
        RAISE EXCEPTION '施設のコイン残高が不足しています。コイン不足のためマッチングできません: %',
          COALESCE(v_coin_result.error_message, '残高不足');
      END IF;
    END IF;

    -- 参加費・レンタル料の1%は
    -- 演奏完了時に徴収するため、ここでは徴収しない。

  ELSE
    -- 通常案件：他の応募・依頼を却下して募集終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE request_id = v_request_id
      AND status = 'pending'
      AND id <> p_application_id;

    UPDATE public.application_attempts aa
    SET status = 'rejected', updated_at = now()
    WHERE aa.request_id = v_request_id
      AND aa.status = 'pending'
      AND aa.application_id <> p_application_id;

    UPDATE public.performance_requests
    SET status = 'matched'
    WHERE id = v_request_id
      AND status = 'open';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count <> 1 THEN
      RAISE EXCEPTION
        '案件の状態をmatchedに更新できませんでした';
    END IF;

    -- 通常案件の成立手数料100コインは維持
    v_idempotency_key :=
      'match_fee_attempt:' || v_attempt.id::text;

    SELECT *
    INTO v_coin_result
    FROM public.spend_coins(
      v_facility_user_id,
      v_required_match_fee,
      'match_fee',
      'マッチング成立手数料',
      v_idempotency_key,
      v_request_id,
      p_application_id,
      v_match_id
    );

    IF NOT COALESCE(v_coin_result.success, false) THEN
      RAISE EXCEPTION '施設のコイン残高が不足しています。コイン不足のためマッチングできません: %',
        COALESCE(v_coin_result.error_message, '残高不足');
    END IF;

    -- 施設負担の謝礼1%は演奏完了時に徴収する。
  END IF;

  SELECT u.coin_balance INTO v_balance_after
  FROM public.users u WHERE u.id = v_facility_user_id;

  RETURN QUERY SELECT
    true,
    v_match_id,
    NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_application_with_coins(p_request_id uuid, p_application_id uuid, p_facility_user_id uuid)
 RETURNS TABLE(success boolean, match_id uuid, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_facility_id uuid;
  v_request_status text;
  v_request_type text;
  v_max_participants integer;
  v_participation_fee integer;
  v_rental_fee integer;

  v_application_performer_id uuid;
  v_application_band_id uuid;
  v_prelock_band_id uuid;
  v_application_status text;
  v_application_source text;

  v_band_status text;
  v_match_id uuid;

  v_participant_count integer := 1;
  v_participant_performer_ids uuid[] := ARRAY[]::uuid[];

  v_active_count bigint := 0;

  v_coin_result record;
  v_idempotency_key text;
  v_event boolean;
  v_first_event_match boolean := false;
  v_facility_balance integer;
  v_attempt public.application_attempts%ROWTYPE;
  v_performer_user_id uuid;
  v_required_application_fee integer := 10;
  v_required_match_fee integer := 100;

  v_invite record;
  v_original_fee record;
  v_refund_key text;
  v_refund_amount integer;
  v_refund_balance integer;
BEGIN
    PERFORM pg_advisory_xact_lock(2147483000, 20261116);
-- ① 案件行をロックし、施設の所有権と募集状態を確認
  SELECT
    pr.facility_id,
    pr.status,
    pr.request_type,
    pr.max_participants,
    pr.participation_fee,
    pr.rental_fee
  INTO
    v_facility_id,
    v_request_status,
    v_request_type,
    v_max_participants,
    v_participation_fee,
    v_rental_fee
  FROM public.performance_requests pr
  JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE pr.id = p_request_id
    AND f.user_id = p_facility_user_id
  FOR UPDATE OF pr;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      'この案件はこの施設のものではありません'::text;
    RETURN;
  END IF;

  v_event := v_request_type IN (
    'live', 'festival', 'session', 'rental'
  );

  -- 通常案件とイベントで募集状態の扱いを分ける
  IF v_event THEN
    IF v_request_status NOT IN ('open', 'matched') THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'この募集は終了しています'::text;
      RETURN;
    END IF;
  ELSE
    IF v_request_status <> 'open' THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'この案件はすでにマッチング済み、または募集終了しています'::text;
      RETURN;
    END IF;
  END IF;

  -- ② 応募のband_idを先に読み取る（ここではロックしない）
  SELECT a.band_id
  INTO v_prelock_band_id
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.request_id = p_request_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      '応募情報が見つかりません'::text;
    RETURN;
  END IF;

  -- ③ バンド応募の場合、バンド行をロック
  IF v_prelock_band_id IS NOT NULL THEN
    SELECT b.status
    INTO v_band_status
    FROM public.bands b
    WHERE b.id = v_prelock_band_id
    FOR UPDATE;

    IF NOT FOUND OR v_band_status <> 'active' THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'このバンドは現在活動していません'::text;
      RETURN;
    END IF;
  END IF;

  -- ④ 応募レコードをロック
  SELECT
    a.performer_id,
    a.status,
    a.band_id,
    a.source
  INTO
    v_application_performer_id,
    v_application_status,
    v_application_band_id,
    v_application_source
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.request_id = p_request_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      '応募情報が見つかりません'::text;
    RETURN;
  END IF;

  IF v_application_band_id IS DISTINCT FROM v_prelock_band_id THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      '応募情報が更新されています。もう一度確認してください'::text;
    RETURN;
  END IF;

  IF v_application_status <> 'pending' THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer,
      'この応募はすでに処理されています'::text;
    RETURN;
  END IF;

  SELECT * INTO v_attempt
  FROM public.application_attempts aa
  WHERE aa.application_id = p_application_id
    AND aa.status = 'pending'
  ORDER BY aa.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '応募試行情報が見つかりません。運営にお問い合わせください'::text;
    RETURN;
  END IF;

  IF v_attempt.expires_at <= now() THEN
    UPDATE public.application_attempts
    SET status = 'expired', updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.applications SET status = 'rejected'
    WHERE id = p_application_id AND status = 'pending';
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '応募期限の7日間が経過しています'::text;
    RETURN;
  END IF;

  IF v_application_source NOT IN ('performer_apply', 'band_apply')
     OR v_attempt.fee_type <> 'application_fee'
     OR v_attempt.source IS DISTINCT FROM v_application_source THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '応募の課金情報が一致しません'::text;
    RETURN;
  END IF;

  SELECT p.user_id INTO v_performer_user_id
  FROM public.performers p
  WHERE p.id = v_application_performer_id;

  IF NOT FOUND OR v_attempt.payer_user_id IS DISTINCT FROM v_performer_user_id THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '応募者の課金ユーザーを確認できません'::text;
    RETURN;
  END IF;

  SELECT COALESCE(s.application_fee_coins, 10),
         COALESCE(s.match_fee_coins, 100)
  INTO v_required_application_fee, v_required_match_fee
  FROM public.coin_rate_settings s
  WHERE s.id = 1;

  IF v_required_application_fee < 1 OR v_required_application_fee > 1000000
     OR v_required_match_fee < 1 OR v_required_match_fee > 1000000
     OR v_attempt.fee_amount < 1 OR v_attempt.fee_amount > 1000000 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '手数料設定が不正です'::text;
    RETURN;
  END IF;

  -- ⑤ 採用時点の参加人数とメンバーIDを確定
  IF v_application_band_id IS NOT NULL THEN

    SELECT
      COUNT(*)::integer,
      COALESCE(
        array_agg(bm.performer_id ORDER BY bm.performer_id),
        ARRAY[]::uuid[]
      )
    INTO
      v_participant_count,
      v_participant_performer_ids
    FROM public.band_members bm
    WHERE bm.band_id = v_application_band_id
      AND bm.status = 'active';

    IF v_participant_count < 1 THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'このバンドには活動中のメンバーがいません'::text;
      RETURN;
    END IF;

    PERFORM 1
    FROM public.band_members bm
    WHERE bm.band_id = v_application_band_id
      AND bm.performer_id = v_application_performer_id
      AND bm.role = 'leader'
      AND bm.status = 'active';

    IF NOT FOUND THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        '応募した演奏者は現在のバンドリーダーではありません'::text;
      RETURN;
    END IF;

  ELSE
    v_participant_count := 1;
    v_participant_performer_ids :=
      ARRAY[v_application_performer_id]::uuid[];
  END IF;

  -- ⑥ 同じ案件で有効なマッチングが重複しないよう確認
  IF v_application_band_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.matches AS m
      WHERE m.request_id = p_request_id
        AND m.band_id = v_application_band_id
        AND m.status = 'active'
    ) THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'このバンドはすでにマッチング済みです'::text;
      RETURN;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.matches AS m
      WHERE m.request_id = p_request_id
        AND m.performer_id = v_application_performer_id
        AND m.band_id IS NULL
        AND m.status = 'active'
    ) THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer,
        'この演奏者はすでにマッチング済みです'::text;
      RETURN;
    END IF;
  END IF;

  -- ⑦ イベント・レンタルの定員を参加人数合計で判定
  IF v_event THEN

    SELECT COALESCE(SUM(m.participant_count), 0)::bigint
    INTO v_active_count
    FROM public.matches m
    WHERE m.request_id = p_request_id
      AND m.status = 'active'
      AND m.performance_status IS DISTINCT FROM 'cancelled';

    IF v_max_participants IS NOT NULL THEN

      IF v_active_count >= v_max_participants THEN
        UPDATE public.performance_requests
        SET status = 'matched'
        WHERE id = p_request_id;

        RETURN QUERY SELECT
          false, NULL::uuid, NULL::integer,
          '募集定員に達しています'::text;
        RETURN;
      END IF;

      IF v_active_count + v_participant_count > v_max_participants THEN
        RETURN QUERY SELECT
          false, NULL::uuid, NULL::integer,
          '今回の応募人数では募集定員を超えるため採用できません'::text;
        RETURN;
      END IF;

    END IF;
  END IF;

  -- ⑧ マッチングを作成
  -- application_id に採用した応募IDを保存する
  INSERT INTO public.matches (
    request_id,
    application_id,
    performer_id,
    band_id,
    status,
    completion_fee_eligible,
    participant_count,
    participant_performer_ids
  )
  VALUES (
    p_request_id,
    p_application_id,
    v_application_performer_id,
    v_application_band_id,
    'active',
    true,
    v_participant_count,
    v_participant_performer_ids
  )
  RETURNING id INTO v_match_id;

  -- 応募手数料はマッチング成立時に初めて徴収する。
  IF v_attempt.fee_due THEN
    SELECT * INTO v_coin_result
    FROM public.spend_coins(
      v_attempt.payer_user_id,
      v_attempt.fee_amount,
      'application_fee',
      CASE WHEN v_application_band_id IS NOT NULL
        THEN 'バンド応募マッチング成立手数料'
        ELSE '演奏案件応募マッチング成立手数料'
      END,
      'application_match_fee:' || v_attempt.id::text,
      p_request_id,
      p_application_id,
      v_match_id
    );

    IF NOT COALESCE(v_coin_result.success, false) THEN
      RAISE EXCEPTION '演奏者のコイン残高が不足しています。コイン不足のためマッチングできません: %',
        COALESCE(v_coin_result.error_message, '残高不足');
    END IF;
  END IF;

  UPDATE public.applications
  SET status = 'accepted'
  WHERE id = p_application_id;

  UPDATE public.application_attempts
  SET status = 'matched', matched_at = now(), match_id = v_match_id,
      fee_charged_at = CASE WHEN fee_due THEN now() ELSE fee_charged_at END,
      updated_at = now()
  WHERE id = v_attempt.id;

  IF v_event THEN

    -- ⑨ 採用後の参加人数合計を再計算
    SELECT COALESCE(SUM(m.participant_count), 0)::bigint
    INTO v_active_count
    FROM public.matches m
    WHERE m.request_id = p_request_id
      AND m.status = 'active'
      AND m.performance_status IS DISTINCT FROM 'cancelled';

    IF v_max_participants IS NOT NULL
       AND v_active_count >= v_max_participants THEN
      UPDATE public.performance_requests
      SET status = 'matched'
      WHERE id = p_request_id;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.request_id = p_request_id
        AND ct.idempotency_key =
          'event_match_fee:' || p_request_id::text
    )
    INTO v_first_event_match;

    IF v_first_event_match THEN
      SELECT *
      INTO v_coin_result
      FROM public.spend_coins(
        p_facility_user_id,
        v_required_match_fee,
        'match_fee',
        'イベント・レンタル初回マッチング成立手数料',
        'event_match_fee:' || p_request_id::text,
        p_request_id,
        p_application_id,
        v_match_id
      );

      IF NOT COALESCE(v_coin_result.success, false) THEN
        RAISE EXCEPTION '施設のコイン残高が不足しています。コイン不足のためマッチングできません: %',
          COALESCE(v_coin_result.error_message, '残高不足');
      END IF;
    END IF;

  ELSE

    -- 通常案件：自動却下する直接依頼の手数料を返金
    FOR v_invite IN
      SELECT a.id, a.request_id, a.performer_id
      FROM public.applications a
      WHERE a.request_id = p_request_id
        AND a.status = 'pending'
        AND a.id <> p_application_id
        AND a.source = 'facility_invite'
      ORDER BY a.id
      FOR UPDATE OF a
    LOOP

      SELECT ct.user_id, ct.amount
      INTO v_original_fee
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key =
        'direct_invite_fee:' ||
        v_invite.request_id::text || ':' ||
        v_invite.performer_id::text
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.request_id = v_invite.request_id
        AND ct.application_id = v_invite.id;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_refund_key :=
        'direct_invite_refund:' || v_invite.id::text;

      PERFORM pg_advisory_xact_lock(
        hashtextextended(v_refund_key, 0)
      );

      IF EXISTS (
        SELECT 1
        FROM public.coin_transactions ct
        WHERE ct.idempotency_key = v_refund_key
      ) THEN
        CONTINUE;
      END IF;

      v_refund_amount := -v_original_fee.amount;

      SELECT u.coin_balance
      INTO v_refund_balance
      FROM public.users u
      WHERE u.id = v_original_fee.user_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          '直接依頼の返金先ユーザーが見つかりません。応募ID: %',
          v_invite.id;
      END IF;

      UPDATE public.users
      SET coin_balance = coin_balance + v_refund_amount
      WHERE id = v_original_fee.user_id
      RETURNING coin_balance INTO v_refund_balance;

      INSERT INTO public.coin_transactions (
        user_id,
        amount,
        transaction_type,
        description,
        balance_after,
        request_id,
        application_id,
        match_id,
        created_by_user_id,
        idempotency_key
      )
      VALUES (
        v_original_fee.user_id,
        v_refund_amount,
        'admin_adjustment',
        '直接依頼の自動却下による手数料返金',
        v_refund_balance,
        v_invite.request_id,
        v_invite.id,
        NULL,
        v_original_fee.user_id,
        v_refund_key
      );

    END LOOP;

    -- 他の応募を却下し、募集終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE request_id = p_request_id
      AND status = 'pending'
      AND id <> p_application_id;

    UPDATE public.performance_requests
    SET status = 'matched'
    WHERE id = p_request_id;

    v_idempotency_key :=
      'match_fee_attempt:' || v_attempt.id::text;

    SELECT *
    INTO v_coin_result
    FROM public.spend_coins(
      p_facility_user_id,
      v_required_match_fee,
      'match_fee',
      'マッチング成立手数料',
      v_idempotency_key,
      p_request_id,
      p_application_id,
      v_match_id
    );

    IF NOT COALESCE(v_coin_result.success, false) THEN
      RAISE EXCEPTION '施設のコイン残高が不足しています。コイン不足のためマッチングできません: %',
        COALESCE(v_coin_result.error_message, '残高不足');
    END IF;

  END IF;

  SELECT u.coin_balance
  INTO v_facility_balance
  FROM public.users u
  WHERE u.id = p_facility_user_id;

  RETURN QUERY SELECT
    true,
    v_match_id,
    v_facility_balance,
    NULL::text;

END;
$function$;

COMMIT;
