-- Hakotohito V47: application re-application / match-attempt relationship
-- Forward-only. Do not edit or re-run historical migrations.
-- This migration is intentionally fail-closed when active matches cannot be
-- mapped to exactly one matched application_attempts row.
BEGIN;

DO $preflight$
DECLARE v_missing bigint;
BEGIN
  IF to_regclass('public.application_attempts') IS NULL THEN
    RAISE EXCEPTION 'application_attempts is missing; apply the matching-core migrations first';
  END IF;

  IF to_regprocedure('public.complete_match_with_fee(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'complete_match_with_fee(uuid,text) is missing';
  END IF;

  IF to_regclass('public.application_attempts_one_attempt_per_match_idx') IS NULL THEN
    RAISE EXCEPTION 'The unique application_attempts.match_id index is missing; restore the matching-core invariant first';
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.matches m
  WHERE m.status = 'active'
    AND m.performance_status IN ('scheduled','active')
    AND COALESCE(m.completion_fee_eligible, false)
    AND NOT EXISTS (
      SELECT 1 FROM public.application_attempts aa
      WHERE aa.match_id = m.id
        AND aa.application_id = m.application_id
        AND aa.request_id = m.request_id
        AND aa.status = 'matched'
    );

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'V47 stopped: % active fee-eligible matches lack an exact matched application_attempts link; reconcile data before applying', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.application_attempts aa
    WHERE aa.match_id IS NOT NULL
    GROUP BY aa.match_id HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'V47 stopped: duplicate application_attempts.match_id values detected';
  END IF;
END;
$preflight$;

-- Remove only a full, single-column UNIQUE constraint on matches.application_id.
-- Partial unique indexes (for example, active-match-only guards) are preserved.
DO $drop_application_id_unique$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'application_id'
    WHERE n.nspname = 'public' AND t.relname = 'matches'
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND c.conkey[1] = a.attnum
  LOOP
    EXECUTE format('ALTER TABLE public.matches DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT ns.nspname AS schema_name, idx.relname AS index_name
    FROM pg_index i
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attname = 'application_id'
    WHERE ns.nspname = 'public' AND tbl.relname = 'matches'
      AND i.indisunique AND i.indisvalid
      AND i.indnkeyatts = 1 AND i.indkey[0] = a.attnum
      AND i.indpred IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
  LOOP
    EXECUTE format('DROP INDEX %I.%I', r.schema_name, r.index_name);
  END LOOP;
END;
$drop_application_id_unique$;

-- Keep application_id searchable while allowing historical cancelled matches
-- to reference the same reusable application row. At most one active match may
-- exist for a given application at any time.
DO $active_match_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.matches
    WHERE status = 'active' AND application_id IS NOT NULL
    GROUP BY application_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'V47 stopped: more than one active match exists for an application; reconcile before applying';
  END IF;
END;
$active_match_preflight$;

CREATE INDEX IF NOT EXISTS matches_application_id_lookup_idx
  ON public.matches(application_id);

CREATE UNIQUE INDEX IF NOT EXISTS matches_one_active_match_per_application_idx
  ON public.matches(application_id)
  WHERE status = 'active' AND application_id IS NOT NULL;

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

COMMIT;
