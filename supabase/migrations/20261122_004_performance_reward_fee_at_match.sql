-- V48.004: charge the facility's performance-reward fee atomically at match creation.
-- The legacy acceptance RPCs are retained under private versioned names and wrapped
-- so all of their existing application/participant/fee behavior remains transactional.
BEGIN;

SELECT pg_advisory_xact_lock(2147483000, 20261116);

CREATE TABLE IF NOT EXISTS public.match_fee_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL UNIQUE REFERENCES public.matches(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL REFERENCES public.performance_requests(id) ON DELETE RESTRICT,
  application_id uuid REFERENCES public.applications(id) ON DELETE RESTRICT,
  fee_kind text NOT NULL CHECK (fee_kind IN ('performance_reward', 'lesson_match')),
  payer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  base_amount_yen bigint NOT NULL CHECK (base_amount_yen >= 0),
  fee_percent numeric(5,2) NOT NULL CHECK (fee_percent >= 0 AND fee_percent <= 100),
  fee_amount_yen bigint NOT NULL CHECK (fee_amount_yen >= 0),
  yen_per_coin numeric(12,4) NOT NULL CHECK (yen_per_coin > 0),
  fee_amount_coins integer NOT NULL CHECK (fee_amount_coins >= 0),
  coin_transaction_id uuid REFERENCES public.coin_transactions(id) ON DELETE RESTRICT,
  charged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_fee_snapshots_request
  ON public.match_fee_snapshots(request_id);

ALTER TABLE public.match_fee_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_fee_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.match_fee_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.charge_event_match_transaction_fee_at_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_match public.matches%ROWTYPE;
  v_request public.performance_requests%ROWTYPE;
  v_payer_user_id uuid;
  v_fee integer;
  v_result record;
  v_key text;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '成立したマッチングが見つかりません: %', p_match_id; END IF;
  SELECT * INTO v_request FROM public.performance_requests WHERE id = v_match.request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '対象案件が見つかりません: %', v_match.request_id; END IF;
  IF v_request.request_type NOT IN ('live', 'festival', 'session', 'rental') THEN RETURN; END IF;

  SELECT f.user_id INTO v_payer_user_id
  FROM public.facilities f WHERE f.id = v_request.facility_id;
  SELECT COALESCE(s.match_fee_coins, 100) INTO v_fee
  FROM public.coin_rate_settings s WHERE s.id = 1;
  IF v_payer_user_id IS NULL OR v_fee IS NULL OR v_fee < 1 OR v_fee > 1000000 THEN
    RAISE EXCEPTION 'イベント・レンタルの成立手数料設定または支払者が不正です';
  END IF;

  v_key := 'event_match_transaction_fee:' || v_match.id::text;
  SELECT * INTO v_result FROM public.spend_coins(
    v_payer_user_id, v_fee, 'match_fee',
    'イベント・レンタル成立取引ごとのマッチング手数料',
    v_key, v_match.request_id, v_match.application_id, v_match.id
  );
  IF NOT COALESCE(v_result.success, false) THEN
    RAISE EXCEPTION '施設のマッチング成立手数料が不足しています。成立できません: %',
      COALESCE(v_result.error_message, '残高不足');
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.charge_event_match_transaction_fee_at_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_event_match_transaction_fee_at_match(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.charge_performance_reward_fee_at_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_match public.matches%ROWTYPE;
  v_request public.performance_requests%ROWTYPE;
  v_payer_user_id uuid;
  v_rate numeric(5,2);
  v_yen_per_coin numeric(12,4);
  v_fee_yen bigint;
  v_fee_coins integer;
  v_key text;
  v_charge record;
  v_tx public.coin_transactions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '成立したマッチングが見つかりません: %', p_match_id;
  END IF;

  SELECT * INTO v_request
  FROM public.performance_requests
  WHERE id = v_match.request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象案件が見つかりません: %', v_match.request_id;
  END IF;

  -- This fee is only for performance-request reward amounts, not event/rental fees.
  IF v_request.request_type <> 'performance' OR COALESCE(v_request.reward, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT f.user_id INTO v_payer_user_id
  FROM public.facilities f
  WHERE f.id = v_request.facility_id;
  IF v_payer_user_id IS NULL THEN
    RAISE EXCEPTION '報酬手数料の支払者（施設）を特定できません';
  END IF;

  SELECT COALESCE(s.performance_reward_fee_percent, 10),
         COALESCE(s.coin_purchase_yen_per_coin, 10)
  INTO v_rate, v_yen_per_coin
  FROM public.coin_rate_settings s
  WHERE s.id = 1;
  IF NOT FOUND OR v_rate IS NULL OR v_rate < 0 OR v_rate > 100
     OR v_yen_per_coin IS NULL OR v_yen_per_coin <= 0 THEN
    RAISE EXCEPTION '成立時報酬手数料またはコイン換算レートの設定が不正です';
  END IF;

  v_fee_yen := CEIL(GREATEST(v_request.reward, 0)::numeric * v_rate / 100.0)::bigint;
  v_fee_coins := CEIL(v_fee_yen / v_yen_per_coin)::integer;
  v_key := 'performance_reward_fee_match:' || v_match.id::text;

  IF EXISTS (SELECT 1 FROM public.match_fee_snapshots WHERE match_id = v_match.id) THEN
    RETURN;
  END IF;

  IF v_fee_coins > 0 THEN
    SELECT * INTO v_charge
    FROM public.spend_coins(
      v_payer_user_id,
      v_fee_coins,
      'facility_reward_fee',
      '演奏案件の成立時報酬手数料（報酬総額 ' || v_request.reward::text || '円、料率 ' || v_rate::text || '%）',
      v_key,
      v_match.request_id,
      v_match.application_id,
      v_match.id
    );
    IF NOT COALESCE(v_charge.success, false) THEN
      RAISE EXCEPTION '施設の報酬手数料コインが不足しています。マッチングを成立できません: %',
        COALESCE(v_charge.error_message, '残高不足');
    END IF;

    SELECT * INTO v_tx
    FROM public.coin_transactions
    WHERE idempotency_key = v_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION '報酬手数料の取引履歴を確認できません';
    END IF;
  END IF;

  INSERT INTO public.match_fee_snapshots (
    match_id, request_id, application_id, fee_kind, payer_user_id,
    base_amount_yen, fee_percent, fee_amount_yen, yen_per_coin,
    fee_amount_coins, coin_transaction_id, charged_at
  ) VALUES (
    v_match.id, v_match.request_id, v_match.application_id,
    'performance_reward', v_payer_user_id,
    GREATEST(v_request.reward, 0), v_rate, v_fee_yen, v_yen_per_coin,
    v_fee_coins, CASE WHEN v_fee_coins > 0 THEN v_tx.id ELSE NULL END,
    CASE WHEN v_fee_coins > 0 THEN now() ELSE NULL END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.charge_performance_reward_fee_at_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_performance_reward_fee_at_match(uuid) TO service_role;

-- Preserve the V48 participant snapshot / trade-claim implementation and add
-- the new facility reward fee inside the same transaction.
ALTER FUNCTION public.accept_application_with_coins(uuid, uuid, uuid)
  RENAME TO accept_application_with_coins_pre_reward_fee_v48;

CREATE FUNCTION public.accept_application_with_coins(
  p_request_id uuid, p_application_id uuid, p_facility_user_id uuid
)
RETURNS TABLE(success boolean, match_id uuid, balance_after integer, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result record;
  v_balance integer;
BEGIN
  SELECT * INTO v_result
  FROM public.accept_application_with_coins_pre_reward_fee_v48(
    p_request_id, p_application_id, p_facility_user_id
  );
  IF NOT COALESCE(v_result.success, false) THEN
    RETURN QUERY SELECT false, v_result.match_id, v_result.balance_after, v_result.error_message;
    RETURN;
  END IF;

  PERFORM public.charge_event_match_transaction_fee_at_match(v_result.match_id);
  PERFORM public.charge_performance_reward_fee_at_match(v_result.match_id);

  SELECT u.coin_balance INTO v_balance
  FROM public.users u
  WHERE u.id = p_facility_user_id;
  RETURN QUERY SELECT true, v_result.match_id, v_balance, NULL::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_application_with_coins(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_application_with_coins(uuid, uuid, uuid) TO service_role;

-- Direct invitation acceptance uses the same atomic reward-fee helper.
ALTER FUNCTION public.accept_direct_invitation_atomic(uuid, uuid)
  RENAME TO accept_direct_invitation_atomic_pre_reward_fee_v48;

CREATE FUNCTION public.accept_direct_invitation_atomic(
  p_application_id uuid, p_performer_id uuid
)
RETURNS TABLE(success boolean, match_id uuid, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO v_result
  FROM public.accept_direct_invitation_atomic_pre_reward_fee_v48(
    p_application_id, p_performer_id
  );
  IF NOT COALESCE(v_result.success, false) THEN
    RETURN QUERY SELECT false, v_result.match_id, v_result.error_message;
    RETURN;
  END IF;

  PERFORM public.charge_event_match_transaction_fee_at_match(v_result.match_id);
  PERFORM public.charge_performance_reward_fee_at_match(v_result.match_id);
  RETURN QUERY SELECT true, v_result.match_id, NULL::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_direct_invitation_atomic(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_direct_invitation_atomic(uuid, uuid) TO service_role;


-- Suppress the legacy performance completion fee when the new match-time snapshot exists.
CREATE OR REPLACE FUNCTION public.complete_match_with_fee(p_match_id uuid, p_completion_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_match public.matches%ROWTYPE;
  v_request public.performance_requests%ROWTYPE;

  v_application_id uuid;
  v_application_source text;

  v_payer_user_id uuid;
  v_balance integer;
  v_new_balance integer;

  v_fee_base integer := 0;
  v_fee_amount integer := 0;
  v_fee_type text;
  v_fee_description text;
  v_fee_key text;
  v_completion_fee_percent numeric(5,2);

  v_existing_amount integer;
  v_existing_user_id uuid;
  v_existing_type text;
  v_existing_request_id uuid;
  v_existing_application_id uuid;
  v_existing_match_id uuid;

  v_fee_charged boolean := false;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_completion_mode IS NULL
     OR p_completion_mode NOT IN ('mutual', 'auto') THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '完了処理モードが正しくありません'
    );
  END IF;

  IF p_match_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'マッチングIDが指定されていません'
    );
  END IF;

  SELECT m.*
  INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'マッチングが見つかりません'
    );
  END IF;

  IF v_match.performance_status = 'completed'
     OR v_match.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'alreadyCompleted', true,
      'feeCharged', false,
      'message', 'このマッチングはすでに完了しています'
    );
  END IF;

  IF v_match.status IS DISTINCT FROM 'active'
     OR v_match.performance_status NOT IN ('scheduled', 'active') THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'このマッチングは完了できる状態ではありません'
    );
  END IF;

  IF v_match.completion_disputed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '完了について異議申し立て中のため確定できません'
    );
  END IF;

  IF p_completion_mode = 'mutual' THEN
    IF v_match.performer_completion_reported_at IS NULL
       OR v_match.facility_completion_reported_at IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'errorMessage', '双方の完了報告がそろっていません'
      );
    END IF;
  ELSE
    IF NOT (
      (
        v_match.performer_completion_reported_at IS NOT NULL
        AND v_match.performer_completion_reported_at
              <= now() - interval '7 days'
        AND v_match.facility_completion_reported_at IS NULL
      )
      OR
      (
        v_match.facility_completion_reported_at IS NOT NULL
        AND v_match.facility_completion_reported_at
              <= now() - interval '7 days'
        AND v_match.performer_completion_reported_at IS NULL
      )
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'errorMessage', '自動完了の条件を満たしていません'
      );
    END IF;
  END IF;

  SELECT pr.*
  INTO v_request
  FROM public.performance_requests pr
  WHERE pr.id = v_match.request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '案件が見つかりません'
    );
  END IF;

  -- Performance reward fees are charged at match establishment in V48.004.
  -- Do not charge the legacy completion fee a second time.
  IF EXISTS (
    SELECT 1 FROM public.match_fee_snapshots s
    WHERE s.match_id = v_match.id
      AND s.fee_kind = 'performance_reward'
  ) THEN
    v_match.completion_fee_eligible := false;
  END IF;

  -- V48 event/rental transaction fee is charged at match establishment.
  -- Do not additionally charge the legacy completion fee for the same match.
  IF v_request.request_type IN ('live', 'festival', 'session', 'rental')
     AND EXISTS (
       SELECT 1 FROM public.coin_transactions ct
       WHERE ct.match_id = v_match.id
         AND ct.transaction_type = 'match_fee'
         AND ct.amount < 0
         AND ct.idempotency_key = 'event_match_transaction_fee:' || v_match.id::text
     ) THEN
    v_match.completion_fee_eligible := false;
  END IF;

  IF v_match.completion_fee_eligible THEN
    -- matches.application_id で成立した応募を直接特定する
    -- 応募行は再応募時に再利用されるため、現在のapplications.statusではなく
    -- このマッチングIDに結び付いた成立試行を正として特定する。
    SELECT aa.application_id, aa.source
    INTO v_application_id, v_application_source
    FROM public.application_attempts aa
    WHERE aa.match_id = v_match.id
      AND aa.application_id = v_match.application_id
      AND aa.request_id = v_match.request_id
      AND aa.status = 'matched';

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'errorMessage', '成立した応募を特定できないため、完了処理を中止しました'
      );
    END IF;

    IF v_request.request_type = 'rental' THEN
      v_fee_type := 'rental_match_fee';
      v_fee_description := 'レンタル料の完了手数料';
      v_fee_base := GREATEST(COALESCE(v_request.rental_fee, 0), 0);

      SELECT f.user_id
      INTO v_payer_user_id
      FROM public.facilities f
      WHERE f.id = v_request.facility_id;

    ELSIF v_request.request_type IN ('live', 'festival', 'session') THEN
      v_fee_type := 'event_participation_fee';
      v_fee_description := 'イベント参加費の完了手数料';
      v_fee_base := GREATEST(
        COALESCE(v_request.participation_fee, 0), 0
      );

      SELECT f.user_id
      INTO v_payer_user_id
      FROM public.facilities f
      WHERE f.id = v_request.facility_id;

    ELSIF v_request.request_type = 'performance' THEN
      v_fee_base := GREATEST(COALESCE(v_request.reward, 0), 0);

      IF v_application_source = 'facility_invite' THEN
        v_fee_type := 'facility_reward_fee';
        v_fee_description := '直接依頼報酬の完了手数料';

        SELECT f.user_id
        INTO v_payer_user_id
        FROM public.facilities f
        WHERE f.id = v_request.facility_id;

      ELSIF v_application_source IN ('performer_apply', 'band_apply') THEN
        v_fee_type := 'performer_reward_fee';

        IF v_application_source = 'band_apply' THEN
          v_fee_description := 'バンド演奏報酬の完了手数料';
        ELSE
          v_fee_description := '演奏報酬の完了手数料';
        END IF;

        SELECT p.user_id
        INTO v_payer_user_id
        FROM public.performers p
        WHERE p.id = v_match.performer_id;

      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'errorMessage', '応募元を判定できないため、完了処理を中止しました'
        );
      END IF;

    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'errorMessage', '案件種別を判定できないため、完了処理を中止しました'
      );
    END IF;

    IF v_payer_user_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'errorMessage', '手数料の支払者を特定できません'
      );
    END IF;

    SELECT s.completion_fee_percent
    INTO v_completion_fee_percent
    FROM public.coin_rate_settings s
    WHERE s.id = 1;

    IF NOT FOUND OR v_completion_fee_percent IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'errorMessage', '演奏完了手数料率の設定が見つかりません'
      );
    END IF;

    v_fee_amount := CEIL(
      v_fee_base * v_completion_fee_percent / 100.0
    )::integer;

    v_fee_description :=
      v_fee_description
      || '（設定率 '
      || trim(to_char(v_completion_fee_percent, 'FM990.00'))
      || '%）';

    IF v_fee_amount > 0 THEN
      v_fee_key := 'completion_fee:' || v_match.id::text;

      PERFORM pg_advisory_xact_lock(
        hashtextextended(v_fee_key, 0)
      );

      SELECT
        ct.amount,
        ct.user_id,
        ct.transaction_type,
        ct.request_id,
        ct.application_id,
        ct.match_id
      INTO
        v_existing_amount,
        v_existing_user_id,
        v_existing_type,
        v_existing_request_id,
        v_existing_application_id,
        v_existing_match_id
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_fee_key;

      IF FOUND THEN
        IF v_existing_amount IS DISTINCT FROM -v_fee_amount
           OR v_existing_user_id IS DISTINCT FROM v_payer_user_id
           OR v_existing_type IS DISTINCT FROM v_fee_type
           OR v_existing_request_id IS DISTINCT FROM v_match.request_id
           OR v_existing_application_id IS DISTINCT FROM v_application_id
           OR v_existing_match_id IS DISTINCT FROM v_match.id THEN
          RETURN jsonb_build_object(
            'success', false,
            'errorMessage', '既存の完了手数料の内容が一致しないため、処理を中止しました'
          );
        END IF;

        v_fee_charged := true;
      ELSE
        SELECT u.coin_balance
        INTO v_balance
        FROM public.users u
        WHERE u.id = v_payer_user_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object(
            'success', false,
            'errorMessage', '手数料の支払者が見つかりません'
          );
        END IF;

        -- 残高不足でも完了を妨げない。マイナス残高を許容する。
        v_new_balance := v_balance - v_fee_amount;

        UPDATE public.users
        SET coin_balance = v_new_balance
        WHERE id = v_payer_user_id;

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
          v_payer_user_id,
          -v_fee_amount,
          v_fee_type,
          v_fee_description,
          v_new_balance,
          v_match.request_id,
          v_application_id,
          v_match.id,
          v_payer_user_id,
          v_fee_key
        );

        v_fee_charged := true;
      END IF;
    END IF;
  END IF;

  UPDATE public.matches
  SET performance_status = 'completed',
      completed_at = now(),
      completion_method = CASE
        WHEN p_completion_mode = 'auto'
          THEN 'auto_completion'
        ELSE 'mutual_confirmation'
      END
  WHERE id = v_match.id;

  RETURN jsonb_build_object(
    'success', true,
    'matchId', v_match.id,
    'feeEligible', v_match.completion_fee_eligible,
    'feeCharged', v_fee_charged,
    'feeAmount', CASE
      WHEN v_match.completion_fee_eligible THEN v_fee_amount
      ELSE 0
    END,
    'feeType', v_fee_type,
    'message', '演奏完了を確定しました'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_match_with_fee(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_match_with_fee(uuid, text) TO service_role;

COMMIT;
