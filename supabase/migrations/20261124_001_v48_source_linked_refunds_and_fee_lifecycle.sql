-- V48 FINAL 2026-11-24: source-linked, atomic cancellation refunds and fee lifecycle alignment.
-- Apply after the V48.001-.005 schema/fee migrations and the integrated withdrawal/outbox migrations.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regclass('public.coin_transactions') IS NULL
     OR to_regclass('public.users') IS NULL
     OR to_regclass('public.matches') IS NULL
     OR to_regclass('public.match_fee_snapshots') IS NULL
     OR to_regclass('public.lesson_fee_snapshots') IS NULL
     OR to_regclass('public.application_attempts') IS NULL THEN
    RAISE EXCEPTION 'V48 final prerequisites are missing; apply the ordered V48 schema migrations first';
  END IF;
  IF to_regprocedure('public.cancel_match_with_direct_invite_refund(uuid,uuid)') IS NULL
     OR to_regprocedure('public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Required live cancellation RPCs are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['coin_transactions','users','matches','applications','performance_requests',
      'band_members','bands','lesson_applications','lesson_offers']::text[]) t(name)
    WHERE to_regclass('public.' || t.name) IS NULL
  ) THEN RAISE EXCEPTION 'Required lifecycle table is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='band_members' AND column_name='joined_at') THEN
    RAISE EXCEPTION 'band_members.joined_at is required for oldest-member leadership handover';
  END IF;
END;
$preflight$;

ALTER TABLE public.coin_transactions
  ADD COLUMN IF NOT EXISTS source_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS lesson_application_id uuid;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.coin_transactions'::regclass
      AND conname='coin_transactions_source_transaction_id_fkey') THEN
    ALTER TABLE public.coin_transactions ADD CONSTRAINT coin_transactions_source_transaction_id_fkey
      FOREIGN KEY (source_transaction_id) REFERENCES public.coin_transactions(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.coin_transactions'::regclass
      AND conname='coin_transactions_lesson_application_id_fkey') THEN
    ALTER TABLE public.coin_transactions ADD CONSTRAINT coin_transactions_lesson_application_id_fkey
      FOREIGN KEY (lesson_application_id) REFERENCES public.lesson_applications(id) ON DELETE RESTRICT;
  END IF;
END;
$constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS coin_transactions_source_transaction_id_uidx
  ON public.coin_transactions(source_transaction_id) WHERE source_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS coin_transactions_lesson_application_id_idx
  ON public.coin_transactions(lesson_application_id) WHERE lesson_application_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.refund_coin_transaction(
  p_source_transaction_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_source public.coin_transactions%ROWTYPE;
  v_existing public.coin_transactions%ROWTYPE;
  v_balance integer;
  v_new_balance integer;
  v_amount integer;
  v_refund_key text;
  v_legacy_key text;
  v_legacy_count integer;
  v_existing_count integer;
  v_attempt_refund_count integer;
  v_attempt_refund_key text;
  v_lesson_application_id uuid;
BEGIN
  IF p_source_transaction_id IS NULL OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION '返金元取引または理由が指定されていません';
  END IF;

  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  SELECT * INTO v_source
  FROM public.coin_transactions
  WHERE id = p_source_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '返金元取引が見つかりません'; END IF;
  IF v_source.amount >= 0 OR v_source.transaction_type NOT IN (
    'match_fee','facility_reward_fee','lesson_match_fee','direct_invite_fee',
    'event_participation_fee','rental_match_fee'
  ) THEN
    RAISE EXCEPTION 'この取引種別・金額は返金対象ではありません';
  END IF;
  IF v_source.transaction_type = 'direct_invite_fee'
     AND (v_source.application_id IS NULL OR v_source.request_id IS NULL
       OR v_source.idempotency_key NOT LIKE 'direct_invite_fee:%') THEN
    RAISE EXCEPTION '直接依頼手数料の元取引参照が不足しています';
  END IF;
  IF v_source.transaction_type = 'facility_reward_fee'
     AND v_source.idempotency_key NOT LIKE 'performance_reward_fee_match:%' THEN
    RAISE EXCEPTION '施設報酬手数料の元取引キーが一致しません';
  END IF;
  IF v_source.transaction_type = 'match_fee'
     AND NOT (v_source.idempotency_key LIKE 'match_fee:%'
       OR v_source.idempotency_key LIKE 'event_match_fee:%'
       OR v_source.idempotency_key LIKE 'event_match_transaction_fee:%') THEN
    RAISE EXCEPTION 'マッチング手数料の元取引キーが一致しません';
  END IF;

  IF v_source.transaction_type = 'lesson_match_fee' THEN
    SELECT s.lesson_application_id INTO v_lesson_application_id
    FROM public.lesson_fee_snapshots s
    WHERE s.coin_transaction_id = v_source.id;
    IF v_lesson_application_id IS NULL
       OR v_source.idempotency_key IS DISTINCT FROM 'lesson_match_fee:' || v_lesson_application_id::text THEN
      RAISE EXCEPTION 'レッスン手数料のsnapshotと元取引が一致しません';
    END IF;
  END IF;

  v_refund_key := 'refund_source:' || v_source.id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_refund_key, 0));

  SELECT count(*)::integer INTO v_existing_count
  FROM public.coin_transactions
  WHERE source_transaction_id = v_source.id
     OR idempotency_key = v_refund_key;
  IF v_existing_count > 1 THEN
    RAISE EXCEPTION '元取引に対する新形式返金履歴が複数あります: %', v_source.id;
  ELSIF v_existing_count = 1 THEN
    SELECT * INTO v_existing
    FROM public.coin_transactions
    WHERE source_transaction_id = v_source.id
       OR idempotency_key = v_refund_key
    FOR UPDATE;
    IF (v_existing.source_transaction_id IS NOT NULL
           AND v_existing.source_transaction_id IS DISTINCT FROM v_source.id)
       OR v_existing.user_id IS DISTINCT FROM v_source.user_id
       OR v_existing.amount IS DISTINCT FROM -v_source.amount
       OR v_existing.transaction_type IS DISTINCT FROM 'admin_adjustment'
       OR v_existing.request_id IS DISTINCT FROM v_source.request_id
       OR v_existing.application_id IS DISTINCT FROM v_source.application_id
       OR (v_existing.match_id IS DISTINCT FROM v_source.match_id
           AND NOT (v_source.transaction_type = 'direct_invite_fee'
             AND v_source.match_id IS NULL
             AND EXISTS (
               SELECT 1 FROM public.application_attempts aa
               WHERE aa.application_id = v_source.application_id
                 AND aa.match_id = v_existing.match_id
                 AND aa.source = 'facility_invite'
                 AND aa.fee_type = 'direct_invite_fee'
                 AND (
                   'direct_invite_refund_attempt:' || aa.id::text = v_existing.idempotency_key
                   OR v_existing.idempotency_key = 'direct_invite_refund:' || v_source.application_id::text
                 )
             )))
       OR v_existing.band_id IS DISTINCT FROM v_source.band_id
       OR v_existing.lesson_application_id IS DISTINCT FROM v_lesson_application_id THEN
      RAISE EXCEPTION '既存の返金履歴が元取引と一致しません';
    END IF;
    UPDATE public.coin_transactions
    SET source_transaction_id = v_source.id
    WHERE id = v_existing.id AND source_transaction_id IS NULL;
    RETURN jsonb_build_object('success',true,'alreadyRefunded',true,
      'refundAmount',-v_source.amount,'refundTransactionId',v_existing.id);
  END IF;

  -- Reconcile attempt-scoped direct-invite refunds written by the cancellation RPCs.
  -- A source debit may have a NULL match_id even though the refund was recorded
  -- against the match created by that application attempt.
  IF v_source.transaction_type = 'direct_invite_fee' THEN
    SELECT count(*)::integer
    INTO v_attempt_refund_count
    FROM public.application_attempts aa
    JOIN public.coin_transactions ct
      ON ct.idempotency_key = 'direct_invite_refund_attempt:' || aa.id::text
    WHERE aa.application_id = v_source.application_id
      AND aa.source = 'facility_invite'
      AND aa.fee_type = 'direct_invite_fee'
      AND (v_source.match_id IS NULL OR aa.match_id = v_source.match_id);

    IF v_attempt_refund_count > 1 THEN
      RAISE EXCEPTION '直接依頼のattempt返金履歴が複数あるため自動照合できません: %', v_source.id;
    ELSIF v_attempt_refund_count = 1 THEN
      SELECT ct.idempotency_key
      INTO v_attempt_refund_key
      FROM public.application_attempts aa
      JOIN public.coin_transactions ct
        ON ct.idempotency_key = 'direct_invite_refund_attempt:' || aa.id::text
      WHERE aa.application_id = v_source.application_id
        AND aa.source = 'facility_invite'
        AND aa.fee_type = 'direct_invite_fee'
        AND (v_source.match_id IS NULL OR aa.match_id = v_source.match_id)
      LIMIT 1;

      SELECT ct.*
      INTO v_existing
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_attempt_refund_key
      FOR UPDATE;

      IF (v_existing.source_transaction_id IS NOT NULL
             AND v_existing.source_transaction_id IS DISTINCT FROM v_source.id)
         OR v_existing.user_id IS DISTINCT FROM v_source.user_id
         OR v_existing.amount IS DISTINCT FROM -v_source.amount
         OR v_existing.transaction_type IS DISTINCT FROM 'admin_adjustment'
         OR v_existing.request_id IS DISTINCT FROM v_source.request_id
         OR v_existing.application_id IS DISTINCT FROM v_source.application_id
         OR (v_existing.match_id IS DISTINCT FROM v_source.match_id
             AND NOT (v_source.match_id IS NULL AND EXISTS (
               SELECT 1 FROM public.application_attempts aa
               WHERE aa.application_id = v_source.application_id
                 AND aa.match_id = v_existing.match_id
                 AND 'direct_invite_refund_attempt:' || aa.id::text = v_attempt_refund_key
             )))
         OR v_existing.band_id IS DISTINCT FROM v_source.band_id
         OR v_existing.lesson_application_id IS NOT NULL THEN
        RAISE EXCEPTION 'attempt返金履歴が元の直接依頼取引と一致しません: %', v_source.id;
      END IF;

      UPDATE public.coin_transactions
      SET source_transaction_id = v_source.id
      WHERE id = v_existing.id;
      RETURN jsonb_build_object('success',true,'alreadyRefunded',true,
        'refundAmount',-v_source.amount,'refundTransactionId',v_existing.id,'linkedAttemptRefund',true);
    END IF;
  END IF;

  -- Map historical refund keys so old refunds are linked rather than paid twice.
  v_legacy_key := CASE
    WHEN v_source.idempotency_key LIKE 'direct_invite_fee:%'
      THEN 'direct_invite_refund:' || COALESCE(v_source.application_id::text,'')
    WHEN v_source.idempotency_key LIKE 'event_match_transaction_fee:%'
      THEN 'event_match_transaction_refund:' || COALESCE(v_source.match_id::text,'')
    WHEN v_source.idempotency_key LIKE 'performance_reward_fee_match:%'
      THEN 'performance_reward_fee_refund:' || COALESCE(v_source.match_id::text,'')
    WHEN v_source.idempotency_key LIKE 'lesson_match_fee:%'
      THEN 'lesson_match_fee_refund:' || COALESCE(v_lesson_application_id::text,'')
    WHEN v_source.idempotency_key LIKE 'event_match_fee:%'
      THEN 'event_match_refund:' || COALESCE(v_source.request_id::text,'')
    WHEN v_source.transaction_type = 'event_participation_fee'
      THEN 'event_participation_refund:' || COALESCE(v_source.match_id::text,'')
    WHEN v_source.transaction_type = 'rental_match_fee'
      THEN 'rental_match_refund:' || COALESCE(v_source.match_id::text,'')
    WHEN v_source.transaction_type = 'match_fee' AND v_source.match_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.applications a
        WHERE a.id=v_source.application_id AND a.source='facility_invite')
      THEN 'direct_invite_match_refund:' || v_source.match_id::text
    WHEN v_source.transaction_type = 'match_fee' AND v_source.match_id IS NOT NULL
      THEN 'match_fee_refund:' || v_source.match_id::text
    ELSE NULL
  END;

  IF v_legacy_key IS NOT NULL THEN
    SELECT count(*)::integer INTO v_legacy_count
    FROM public.coin_transactions
    WHERE idempotency_key = v_legacy_key;
    IF v_legacy_count > 1 THEN
      RAISE EXCEPTION '旧返金キーが重複しているため自動リンクできません: %', v_legacy_key;
    ELSIF v_legacy_count = 1 THEN
      SELECT * INTO v_existing
      FROM public.coin_transactions
      WHERE idempotency_key = v_legacy_key
      FOR UPDATE;
      IF (v_existing.source_transaction_id IS NOT NULL
             AND v_existing.source_transaction_id IS DISTINCT FROM v_source.id)
         OR v_existing.user_id IS DISTINCT FROM v_source.user_id
         OR v_existing.amount IS DISTINCT FROM -v_source.amount
         OR v_existing.transaction_type IS DISTINCT FROM 'admin_adjustment'
         OR v_existing.request_id IS DISTINCT FROM v_source.request_id
         OR v_existing.application_id IS DISTINCT FROM v_source.application_id
         OR (v_existing.match_id IS DISTINCT FROM v_source.match_id
             AND NOT (v_source.transaction_type = 'direct_invite_fee'
               AND v_source.match_id IS NULL
               AND EXISTS (
                 SELECT 1 FROM public.application_attempts aa
                 WHERE aa.application_id = v_source.application_id
                   AND aa.match_id = v_existing.match_id
                   AND aa.source = 'facility_invite'
                   AND aa.fee_type = 'direct_invite_fee'
               )))
         OR v_existing.band_id IS DISTINCT FROM v_source.band_id
         OR v_existing.lesson_application_id IS DISTINCT FROM v_lesson_application_id THEN
        RAISE EXCEPTION '旧返金履歴が元取引と一致しません: %', v_legacy_key;
      END IF;
      UPDATE public.coin_transactions
      SET source_transaction_id = v_source.id,
          lesson_application_id = COALESCE(lesson_application_id, v_lesson_application_id)
      WHERE id = v_existing.id;
      RETURN jsonb_build_object('success',true,'alreadyRefunded',true,
        'refundAmount',-v_source.amount,'refundTransactionId',v_existing.id,'linkedLegacy',true);
    END IF;
  END IF;

  v_amount := -v_source.amount;
  UPDATE public.users
  SET coin_balance = COALESCE(coin_balance,0) + v_amount
  WHERE id = v_source.user_id
  RETURNING coin_balance INTO v_new_balance;
  IF NOT FOUND THEN RAISE EXCEPTION '元の支払者ユーザーが見つかりません'; END IF;

  INSERT INTO public.coin_transactions (
    user_id, amount, transaction_type, description, balance_after,
    request_id, application_id, match_id, band_id, lesson_application_id,
    created_by_user_id, idempotency_key, source_transaction_id
  ) VALUES (
    v_source.user_id, v_amount, 'admin_adjustment',
    left(p_reason, 250) || '（元取引 ' || v_source.id::text || '）',
    v_new_balance, v_source.request_id, v_source.application_id,
    v_source.match_id, v_source.band_id, v_lesson_application_id,
    v_source.user_id, v_refund_key, v_source.id
  ) RETURNING * INTO v_existing;

  RETURN jsonb_build_object('success',true,'alreadyRefunded',false,
    'refundAmount',v_amount,'balanceAfter',v_new_balance,
    'refundTransactionId',v_existing.id);
END;
$function$;
ALTER FUNCTION public.refund_coin_transaction(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refund_coin_transaction(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_coin_transaction(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_match_with_direct_invite_refund(p_match_id uuid, p_facility_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_match public.matches%ROWTYPE;
  v_application public.applications%ROWTYPE;

  v_facility_user_id uuid;
  v_request_facility_id uuid;
  v_request_type text;
  v_request_status text;

  v_balance integer;
  v_refund_amount integer := 0;
  v_direct_fee_refund_amount integer := 0;
  v_match_fee_refund_amount integer := 0;
  v_fee_refund_amount integer := 0;
  v_active_count integer;

  v_direct_refund_key text;
  v_match_refund_key text;
  v_fee_refund_key text;

  v_has_direct_application boolean := false;
  v_has_direct_fee boolean := false;
  v_has_match_fee boolean := false;
  v_has_event_fee boolean := false;

  v_match_fee_application_id uuid;
  v_event_fee_type text;
  v_event_fee_description text;
  v_event boolean;
  v_attempt_id uuid;
  v_source record;
  v_source_refund jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 事前に案件IDだけ取得。ここではロックしない
  SELECT m.request_id
  INTO v_request_id
  FROM public.matches m
  WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'マッチングが見つかりません'
    );
  END IF;

  -- 1. 案件を最初にロック
  SELECT
    pr.request_type,
    pr.status,
    pr.facility_id
  INTO
    v_request_type,
    v_request_status,
    v_request_facility_id
  FROM public.performance_requests pr
  WHERE pr.id = v_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '案件が見つかりません'
    );
  END IF;

  IF v_request_facility_id IS DISTINCT FROM p_facility_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'この案件をキャンセルする権限がありません'
    );
  END IF;

  -- 2. 施設ユーザーを確認
  SELECT f.user_id
  INTO v_facility_user_id
  FROM public.facilities f
  WHERE f.id = p_facility_id;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '施設ユーザーが見つかりません'
    );
  END IF;

  -- 3. 施設ユーザー残高をロック
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '施設ユーザーのコイン情報が見つかりません';
  END IF;

  -- 4. マッチングをロック
  SELECT m.*
  INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.request_id = v_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'マッチングが見つかりません'
    );
  END IF;

  -- ロック取得後に状態を再確認
  IF v_match.status = 'cancelled'
     OR v_match.performance_status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'このマッチングはすでにキャンセルされています'
    );
  END IF;

  IF v_match.performance_status = 'completed'
     OR v_match.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '演奏完了後のマッチングはキャンセルできません'
    );
  END IF;

  IF v_match.status <> 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'このマッチングは現在キャンセルできません'
    );
  END IF;

  v_event := v_request_type IN (
    'live', 'festival', 'session', 'rental'
  );

  -- 5. 直接依頼の応募を特定してロック
  v_application := NULL;
  v_has_direct_application := false;

  IF v_match.application_id IS NOT NULL THEN
    SELECT a.*
    INTO v_application
    FROM public.applications a
    WHERE a.id = v_match.application_id
      AND a.request_id = v_request_id
      AND a.source = 'facility_invite'
    FOR UPDATE;

    IF FOUND THEN
      v_has_direct_application := true;
    END IF;
  END IF;

  IF v_has_direct_application THEN
    -- 新方式はattempt_id単位で返金キーを分離し、同じ応募行の再依頼でも
    -- 過去の返金履歴に阻まれないようにする。旧方式は従来キーを維持する。
    SELECT aa.id INTO v_attempt_id
    FROM public.application_attempts aa
    WHERE aa.match_id = v_match.id
      AND aa.application_id = v_application.id
      AND aa.source = 'facility_invite'
      AND aa.fee_type = 'direct_invite_fee'
    ORDER BY aa.matched_at DESC NULLS LAST, aa.started_at DESC
    LIMIT 1;

    IF v_attempt_id IS NOT NULL THEN
      v_direct_refund_key :=
        'direct_invite_refund_attempt:' || v_attempt_id::text;

      SELECT -ct.amount
      INTO v_direct_fee_refund_amount
      FROM public.coin_transactions ct
      WHERE ct.application_id = v_application.id
        AND ct.match_id = v_match.id
        AND ct.request_id = v_request_id
        AND ct.user_id = v_facility_user_id
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
      ORDER BY ct.created_at DESC
      LIMIT 1;

      IF NOT FOUND THEN
        -- 既存方式では依頼作成時に徴収しmatch_idがNULLのため旧キーで照合する。
        v_direct_refund_key := 'direct_invite_refund:' || v_application.id::text;
        SELECT -ct.amount
        INTO v_direct_fee_refund_amount
        FROM public.coin_transactions ct
        WHERE ct.application_id = v_application.id
          AND ct.request_id = v_request_id
          AND ct.user_id = v_facility_user_id
          AND ct.transaction_type = 'direct_invite_fee'
          AND ct.amount < 0
          AND ct.idempotency_key = 'direct_invite_fee:' || v_request_id::text || ':' ||
            v_application.performer_id::text
        ORDER BY ct.created_at
        LIMIT 1;
      END IF;
    ELSE
      v_direct_refund_key :=
        'direct_invite_refund:' || v_application.id::text;

      SELECT -ct.amount
      INTO v_direct_fee_refund_amount
      FROM public.coin_transactions ct
      WHERE ct.application_id = v_application.id
        AND ct.request_id = v_request_id
        AND ct.user_id = v_facility_user_id
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.idempotency_key =
          'direct_invite_fee:' || v_request_id::text || ':' ||
          v_application.performer_id::text
      ORDER BY ct.created_at
      LIMIT 1;
    END IF;

    v_has_direct_fee := COALESCE(v_direct_fee_refund_amount, 0) > 0;
  ELSE
    v_direct_refund_key := NULL;
    v_direct_fee_refund_amount := 0;
    v_has_direct_fee := false;
  END IF;

  -- 6. マッチング成立手数料の実際の引き落とし額
  SELECT
    ct.application_id,
    -ct.amount
  INTO
    v_match_fee_application_id,
    v_match_fee_refund_amount
  FROM public.coin_transactions ct
  WHERE ct.match_id = v_match.id
    AND ct.user_id = v_facility_user_id
    AND ct.transaction_type = 'match_fee'
    AND ct.amount < 0
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_event THEN
    v_match_refund_key := NULL;
    v_has_match_fee := false;

    IF v_request_type = 'rental' THEN
      v_event_fee_type := 'rental_match_fee';
      v_event_fee_description := 'レンタル料手数料の返金';
      v_fee_refund_key :=
        'rental_match_refund:' || v_match.id::text;
    ELSE
      v_event_fee_type := 'event_participation_fee';
      v_event_fee_description := 'イベント参加手数料の返金';
      v_fee_refund_key :=
        'event_participation_refund:' || v_match.id::text;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.match_id = v_match.id
        AND ct.user_id = v_facility_user_id
        AND ct.transaction_type = v_event_fee_type
        AND ct.amount < 0
    )
    INTO v_has_event_fee;
  ELSE
    v_match_refund_key :=
      CASE
        WHEN v_has_direct_application AND v_has_direct_fee
          THEN 'direct_invite_match_refund:' || v_match.id::text
        ELSE 'match_fee_refund:' || v_match.id::text
      END;

    v_has_match_fee :=
      COALESCE(v_match_fee_refund_amount, 0) > 0;

    v_fee_refund_key := NULL;
    v_has_event_fee := false;
  END IF;

  -- 7. 直接依頼の送信手数料を返金
  IF v_has_direct_fee THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_direct_refund_key, 0)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions refund
      WHERE refund.idempotency_key IN (
          v_direct_refund_key,
          'direct_invite_refund:' || v_application.id::text
        )
        OR refund.idempotency_key IN (
          SELECT 'direct_invite_refund_attempt:' || aa.id::text
          FROM public.application_attempts aa
          WHERE aa.application_id = v_application.id
            AND aa.source = 'facility_invite'
            AND aa.fee_type = 'direct_invite_fee'
        )
        OR refund.idempotency_key IN (
          SELECT 'refund_source:' || source.id::text
          FROM public.coin_transactions source
          WHERE source.user_id = v_facility_user_id
            AND source.request_id = v_request_id
            AND source.application_id = v_application.id
            AND source.transaction_type = 'direct_invite_fee'
            AND source.amount < 0
        )
        OR refund.idempotency_key IN (
          SELECT 'refund_source:' || source.id::text
          FROM public.coin_transactions source
          WHERE source.user_id = v_facility_user_id
            AND source.request_id = p_request_id
            AND source.application_id = v_application.id
            AND source.transaction_type = 'direct_invite_fee'
            AND source.amount < 0
        )
        OR refund.source_transaction_id IN (
          SELECT source.id
          FROM public.coin_transactions source
          WHERE source.user_id = v_facility_user_id
            AND source.request_id = v_request_id
            AND source.application_id = v_application.id
            AND source.transaction_type = 'direct_invite_fee'
            AND source.amount < 0
        )
    ) THEN
      UPDATE public.users
      SET coin_balance =
        COALESCE(coin_balance, 0) + v_direct_fee_refund_amount
      WHERE id = v_facility_user_id
      RETURNING coin_balance INTO v_balance;

      INSERT INTO public.coin_transactions (
        user_id, amount, transaction_type, description,
        balance_after, request_id, application_id,
        match_id, idempotency_key
      )
      VALUES (
        v_facility_user_id,
        v_direct_fee_refund_amount,
        'admin_adjustment',
        '直接依頼のマッチングキャンセルによる直接依頼手数料返金',
        v_balance,
        v_match.request_id,
        v_application.id,
        v_match.id,
        v_direct_refund_key
      );

      v_refund_amount :=
        v_refund_amount + v_direct_fee_refund_amount;
    END IF;
  END IF;

  -- 8. 通常案件の成立手数料を返金
  IF NOT v_event AND v_has_match_fee THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_match_refund_key, 0)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions refund
      WHERE refund.idempotency_key = v_match_refund_key
         OR refund.source_transaction_id IN (
           SELECT source.id FROM public.coin_transactions source
           WHERE source.match_id = v_match.id
             AND source.user_id = v_facility_user_id
             AND source.transaction_type = 'match_fee'
             AND source.amount < 0
         )
         OR refund.idempotency_key IN (
           SELECT 'refund_source:' || source.id::text FROM public.coin_transactions source
           WHERE source.match_id = v_match.id
             AND source.user_id = v_facility_user_id
             AND source.transaction_type = 'match_fee'
             AND source.amount < 0
         )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions ct
      WHERE ct.match_id = v_match.id
        AND ct.amount > 0
        AND ct.transaction_type = 'admin_adjustment'
        AND ct.description LIKE '%成立手数料返金%'
    ) THEN
      UPDATE public.users
      SET coin_balance =
        COALESCE(coin_balance, 0) + v_match_fee_refund_amount
      WHERE id = v_facility_user_id
      RETURNING coin_balance INTO v_balance;

      INSERT INTO public.coin_transactions (
        user_id, amount, transaction_type, description,
        balance_after, request_id, application_id,
        match_id, idempotency_key
      )
      VALUES (
        v_facility_user_id,
        v_match_fee_refund_amount,
        'admin_adjustment',
        'マッチングキャンセルによる成立手数料返金',
        v_balance,
        v_match.request_id,
        CASE
          WHEN v_has_direct_application THEN v_application.id
          ELSE v_match_fee_application_id
        END,
        v_match.id,
        v_match_refund_key
      );

      v_refund_amount :=
        v_refund_amount + v_match_fee_refund_amount;
    END IF;
  END IF;

  -- 9. イベント・レンタルの参加費を返金
  IF v_event AND v_has_event_fee THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_fee_refund_key, 0)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions refund
      WHERE refund.idempotency_key = v_fee_refund_key
         OR refund.source_transaction_id IN (
           SELECT source.id FROM public.coin_transactions source
           WHERE source.match_id = v_match.id
             AND source.request_id = v_request_id
             AND source.user_id = v_facility_user_id
             AND source.transaction_type = v_event_fee_type
             AND source.amount < 0
         )
         OR refund.idempotency_key IN (
           SELECT 'refund_source:' || source.id::text FROM public.coin_transactions source
           WHERE source.match_id = v_match.id
             AND source.request_id = v_request_id
             AND source.user_id = v_facility_user_id
             AND source.transaction_type = v_event_fee_type
             AND source.amount < 0
         )
    ) THEN
      SELECT -ct.amount
      INTO v_fee_refund_amount
      FROM public.coin_transactions ct
      WHERE ct.match_id = v_match.id
        AND ct.request_id = v_request_id
        AND ct.user_id = v_facility_user_id
        AND ct.transaction_type = v_event_fee_type
        AND ct.amount < 0
      ORDER BY ct.created_at
      LIMIT 1;

      IF COALESCE(v_fee_refund_amount, 0) > 0 THEN
        UPDATE public.users
        SET coin_balance =
          COALESCE(coin_balance, 0) + v_fee_refund_amount
        WHERE id = v_facility_user_id
        RETURNING coin_balance INTO v_balance;

        INSERT INTO public.coin_transactions (
          user_id, amount, transaction_type, description,
          balance_after, request_id, application_id,
          match_id, idempotency_key
        )
        VALUES (
          v_facility_user_id,
          v_fee_refund_amount,
          'admin_adjustment',
          v_event_fee_description,
          v_balance,
          v_match.request_id,
          CASE
            WHEN v_has_direct_application THEN v_application.id
            ELSE v_match.application_id
          END,
          v_match.id,
          v_fee_refund_key
        );

        v_refund_amount :=
          v_refund_amount + v_fee_refund_amount;
      END IF;
    END IF;
  END IF;

  -- V48 final: source-linked refunds for V48 match-time fees and legacy fee writers.
  FOR v_source IN
    SELECT ct.id
    FROM public.coin_transactions ct
    WHERE (ct.match_id = v_match.id
        OR (ct.transaction_type = 'direct_invite_fee'
          AND ct.application_id = v_application.id))
      AND ct.amount < 0
      AND ct.transaction_type IN (
        'match_fee', 'facility_reward_fee', 'direct_invite_fee',
        'event_participation_fee', 'rental_match_fee'
      )
      AND (
        ct.transaction_type IN ('direct_invite_fee','event_participation_fee','rental_match_fee')
        OR ct.idempotency_key LIKE 'event_match_transaction_fee:%'
        OR ct.idempotency_key LIKE 'performance_reward_fee_match:%'
        OR ct.idempotency_key LIKE 'match_fee:%'
      )
    ORDER BY ct.id
  LOOP
    v_source_refund := public.refund_coin_transaction(
      v_source.id, 'マッチング個別キャンセル'
    );
    IF COALESCE((v_source_refund->>'alreadyRefunded')::boolean, false) IS NOT TRUE THEN
      v_refund_amount := v_refund_amount +
        COALESCE((v_source_refund->>'refundAmount')::integer, 0);
    END IF;
  END LOOP;

  -- 10. マッチングをキャンセル
  UPDATE public.matches
  SET status = 'cancelled',
      performance_status = 'cancelled'
  WHERE id = v_match.id;

  -- 個別キャンセル後は応募を却下状態へ戻し、再応募可能にする。
  IF v_match.application_id IS NOT NULL THEN
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_match.application_id
      AND status = 'accepted';

    UPDATE public.application_attempts
    SET status = 'cancelled', updated_at = now()
    WHERE match_id = v_match.id
      AND status = 'matched';
  END IF;

  -- 11. 募集状態を更新
  -- 手動で closed にした募集は再開しない
  IF v_request_status IS DISTINCT FROM 'closed' THEN
    IF v_event THEN
      SELECT COUNT(*)::integer
      INTO v_active_count
      FROM public.matches m
      WHERE m.request_id = v_match.request_id
        AND m.status = 'active'
        AND m.performance_status IS DISTINCT FROM 'cancelled';

      UPDATE public.performance_requests
      SET status = CASE
        WHEN v_active_count > 0 THEN 'matched'
        ELSE 'open'
      END
      WHERE id = v_match.request_id;
    ELSE
      UPDATE public.performance_requests
      SET status = 'open'
      WHERE id = v_match.request_id;
    END IF;
  END IF;

  -- 12. 最新残高
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'matchId', v_match.id,
    'refundAmount', v_refund_amount,
    'balanceAfter', v_balance,
    'errorMessage', NULL
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.cancel_event_request_with_refund_internal(p_request_id uuid, p_facility_id uuid, p_allow_closed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.performance_requests%ROWTYPE;
  v_facility_user_id uuid;
  v_match public.matches%ROWTYPE;
  v_application public.applications%ROWTYPE;

  v_fee_type text;
  v_fee_refund_key text;
  v_direct_refund_key text;
  v_initial_refund_key text :=
    'event_match_refund:' || p_request_id::text;

  v_balance integer;
  v_refund_amount integer := 0;
  v_fee_refund_amount integer := 0;
  v_direct_refund_amount integer := 0;
  v_direct_fee_amount integer := 0;
  v_attempt_id uuid;
  v_initial_refund_amount integer := 0;
  v_initial_fee_amount integer := 0;
  v_pending_direct_refund integer := 0;
  v_cancelled_count integer := 0;
  v_cancelled_match_ids uuid[] := ARRAY[]::uuid[];
  v_has_initial_fee boolean := false;
  v_has_completed_match boolean := false;
  v_source record;
  v_source_refund jsonb;

  -- 未承認の直接依頼の通知情報
  v_pending_direct_notifications jsonb := '[]'::jsonb;
  v_pending_direct_line_user_id text;
  v_pending_direct_performer_name text;
  v_facility_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  IF p_request_id IS NULL OR p_facility_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '案件IDまたは施設IDが指定されていません'
    );
  END IF;

  -- 1. 案件を最初にロック
  SELECT *
  INTO v_request
  FROM public.performance_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '案件が見つかりません'
    );
  END IF;

  IF v_request.facility_id IS DISTINCT FROM p_facility_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'この案件をキャンセルする権限がありません'
    );
  END IF;

  IF v_request.request_type NOT IN (
    'live', 'festival', 'session', 'rental'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'イベント・レンタル案件のみ全体キャンセルできます'
    );
  END IF;

  IF v_request.status = 'closed'
     AND COALESCE(p_allow_closed, false) IS NOT TRUE
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', 'この案件はすでに募集終了しています'
    );
  END IF;

  -- 完了済みマッチングの有無を記録
  SELECT EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.request_id = p_request_id
      AND m.status = 'active'
      AND (
        m.performance_status = 'completed'
        OR m.completed_at IS NOT NULL
      )
  )
  INTO v_has_completed_match;

  -- 通常キャンセルでは完了済みがあれば中断
  -- 施設退会時だけ、完了済みを維持して続行
  IF v_has_completed_match
     AND COALESCE(p_allow_closed, false) IS NOT TRUE
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '演奏完了済みのマッチングがあるため全体キャンセルできません'
    );
  END IF;

  SELECT f.user_id, f.name
  INTO v_facility_user_id, v_facility_name
  FROM public.facilities f
  WHERE f.id = p_facility_id;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'errorMessage', '施設ユーザーが見つかりません'
    );
  END IF;

  -- 2. 施設ユーザーの残高行をロック
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '施設ユーザーのコイン情報が見つかりません';
  END IF;

  -- 3. 未完了の対象マッチングだけをID順にロック
  PERFORM 1
  FROM public.matches m
  WHERE m.request_id = p_request_id
    AND m.status = 'active'
    AND m.performance_status IS DISTINCT FROM 'cancelled'
    AND m.performance_status IS DISTINCT FROM 'completed'
    AND m.completed_at IS NULL
  ORDER BY m.id
  FOR UPDATE;

  -- 4. 対象応募をID順にロック
  PERFORM 1
  FROM public.applications a
  WHERE a.request_id = p_request_id
  ORDER BY a.id
  FOR UPDATE;

  -- 5. 未完了マッチングだけ返金・キャンセル
  FOR v_match IN
    SELECT m.*
    FROM public.matches m
    WHERE m.request_id = p_request_id
      AND m.status = 'active'
      AND m.performance_status IS DISTINCT FROM 'cancelled'
      AND m.performance_status IS DISTINCT FROM 'completed'
      AND m.completed_at IS NULL
    ORDER BY m.id
  LOOP
    IF v_request.request_type = 'rental' THEN
      v_fee_type := 'rental_match_fee';
      v_fee_refund_key :=
        'rental_match_refund:' || v_match.id::text;
    ELSE
      v_fee_type := 'event_participation_fee';
      v_fee_refund_key :=
        'event_participation_refund:' || v_match.id::text;
    END IF;

    -- 実際の参加手数料だけ返金
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_fee_refund_key, 0)
    );

    v_fee_refund_amount := 0;

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions refund
      WHERE refund.idempotency_key = v_fee_refund_key
         OR refund.source_transaction_id IN (
           SELECT source.id FROM public.coin_transactions source
           WHERE source.match_id = v_match.id
             AND source.request_id = p_request_id
             AND source.user_id = v_facility_user_id
             AND source.transaction_type = v_fee_type
             AND source.amount < 0
         )
         OR refund.idempotency_key IN (
           SELECT 'refund_source:' || source.id::text FROM public.coin_transactions source
           WHERE source.match_id = v_match.id
             AND source.request_id = p_request_id
             AND source.user_id = v_facility_user_id
             AND source.transaction_type = v_fee_type
             AND source.amount < 0
         )
    ) THEN
      SELECT -ct.amount
      INTO v_fee_refund_amount
      FROM public.coin_transactions ct
      WHERE ct.user_id = v_facility_user_id
        AND ct.request_id = p_request_id
        AND ct.match_id = v_match.id
        AND ct.transaction_type = v_fee_type
        AND ct.amount < 0
      ORDER BY ct.created_at
      LIMIT 1;

      IF COALESCE(v_fee_refund_amount, 0) > 0 THEN
        UPDATE public.users
        SET coin_balance =
          COALESCE(coin_balance, 0) + v_fee_refund_amount
        WHERE id = v_facility_user_id
        RETURNING coin_balance INTO v_balance;

        INSERT INTO public.coin_transactions (
          user_id,
          amount,
          transaction_type,
          description,
          balance_after,
          request_id,
          application_id,
          match_id,
          idempotency_key
        )
        VALUES (
          v_facility_user_id,
          v_fee_refund_amount,
          'admin_adjustment',
          CASE
            WHEN v_request.request_type = 'rental'
              THEN 'レンタル案件全体キャンセルによる手数料返金'
            ELSE 'イベント全体キャンセルによる参加手数料返金'
          END,
          v_balance,
          p_request_id,
          v_match.application_id,
          v_match.id,
          v_fee_refund_key
        );

        v_refund_amount :=
          v_refund_amount + v_fee_refund_amount;
      END IF;
    END IF;

    -- 成立済み直接依頼の手数料を確認
    IF v_match.application_id IS NOT NULL THEN
      SELECT a.*
      INTO v_application
      FROM public.applications a
      WHERE a.id = v_match.application_id
        AND a.request_id = p_request_id
        AND a.source = 'facility_invite';

      IF FOUND THEN
        SELECT aa.id INTO v_attempt_id
        FROM public.application_attempts aa
        WHERE aa.match_id = v_match.id
          AND aa.application_id = v_application.id
          AND aa.source = 'facility_invite'
          AND aa.fee_type = 'direct_invite_fee'
        ORDER BY aa.matched_at DESC NULLS LAST, aa.started_at DESC
        LIMIT 1;

        IF v_attempt_id IS NOT NULL THEN
          v_direct_refund_key :=
            'direct_invite_refund_attempt:' || v_attempt_id::text;
        ELSE
          v_direct_refund_key :=
            'direct_invite_refund:' || v_application.id::text;
        END IF;

        PERFORM pg_advisory_xact_lock(
          hashtextextended(v_direct_refund_key, 0)
        );

        v_direct_fee_amount := 0;

        IF NOT EXISTS (
          SELECT 1
          FROM public.coin_transactions refund
          WHERE refund.idempotency_key IN (
              v_direct_refund_key,
              'direct_invite_refund:' || v_application.id::text
            )
            OR refund.idempotency_key IN (
              SELECT 'direct_invite_refund_attempt:' || aa.id::text
              FROM public.application_attempts aa
              WHERE aa.application_id = v_application.id
                AND aa.source = 'facility_invite'
                AND aa.fee_type = 'direct_invite_fee'
            )
            OR refund.idempotency_key IN (
              SELECT 'refund_source:' || source.id::text
              FROM public.coin_transactions source
              WHERE source.user_id = v_facility_user_id
                AND source.request_id = p_request_id
                AND source.application_id = v_application.id
                AND source.transaction_type = 'direct_invite_fee'
                AND source.amount < 0
            )
            OR refund.source_transaction_id IN (
              SELECT source.id
              FROM public.coin_transactions source
              WHERE source.user_id = v_facility_user_id
                AND source.request_id = p_request_id
                AND source.application_id = v_application.id
                AND source.transaction_type = 'direct_invite_fee'
                AND source.amount < 0
            )
        ) THEN
          IF v_attempt_id IS NOT NULL THEN
            SELECT -ct.amount
            INTO v_direct_fee_amount
            FROM public.coin_transactions ct
            WHERE ct.user_id = v_facility_user_id
              AND ct.request_id = p_request_id
              AND ct.application_id = v_application.id
              AND ct.match_id = v_match.id
              AND ct.transaction_type = 'direct_invite_fee'
              AND ct.amount < 0
            ORDER BY ct.created_at DESC
            LIMIT 1;

            IF NOT FOUND THEN
              v_direct_refund_key := 'direct_invite_refund:' || v_application.id::text;
              SELECT -ct.amount
              INTO v_direct_fee_amount
              FROM public.coin_transactions ct
              WHERE ct.user_id = v_facility_user_id
                AND ct.request_id = p_request_id
                AND ct.application_id = v_application.id
                AND ct.transaction_type = 'direct_invite_fee'
                AND ct.amount < 0
                AND ct.idempotency_key = 'direct_invite_fee:' || p_request_id::text || ':' ||
                  v_application.performer_id::text
              ORDER BY ct.created_at
              LIMIT 1;
            END IF;
          ELSE
            SELECT -ct.amount
            INTO v_direct_fee_amount
            FROM public.coin_transactions ct
            WHERE ct.user_id = v_facility_user_id
              AND ct.request_id = p_request_id
              AND ct.application_id = v_application.id
              AND ct.transaction_type = 'direct_invite_fee'
              AND ct.amount < 0
              AND ct.idempotency_key =
                'direct_invite_fee:' || p_request_id::text || ':' ||
                v_application.performer_id::text
            ORDER BY ct.created_at
            LIMIT 1;
          END IF;

          IF COALESCE(v_direct_fee_amount, 0) > 0 THEN
            UPDATE public.users
            SET coin_balance =
              COALESCE(coin_balance, 0) + v_direct_fee_amount
            WHERE id = v_facility_user_id
            RETURNING coin_balance INTO v_balance;

            INSERT INTO public.coin_transactions (
              user_id,
              amount,
              transaction_type,
              description,
              balance_after,
              request_id,
              application_id,
              match_id,
              idempotency_key
            )
            VALUES (
              v_facility_user_id,
              v_direct_fee_amount,
              'admin_adjustment',
              'イベント全体キャンセルによる直接依頼手数料返金',
              v_balance,
              p_request_id,
              v_application.id,
              v_match.id,
              v_direct_refund_key
            );

            v_refund_amount :=
              v_refund_amount + v_direct_fee_amount;

            v_direct_refund_amount :=
              v_direct_refund_amount + v_direct_fee_amount;
          END IF;
        END IF;
      END IF;
    END IF;

    UPDATE public.matches
    SET
      status = 'cancelled',
      performance_status = 'cancelled'
    WHERE id = v_match.id;

    v_cancelled_match_ids := array_append(v_cancelled_match_ids, v_match.id);

    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_match.application_id AND status = 'accepted';

    UPDATE public.application_attempts
    SET status = 'cancelled', updated_at = now()
    WHERE match_id = v_match.id
      AND status = 'matched';

    -- V48 final: link/refund every match-scoped debit to its exact source transaction.
    FOR v_source IN
      SELECT ct.id
      FROM public.coin_transactions ct
      WHERE ct.request_id = p_request_id
        AND (ct.match_id = v_match.id
          OR (ct.transaction_type = 'direct_invite_fee'
            AND ct.application_id = v_match.application_id))
        AND ct.amount < 0
        AND ct.transaction_type IN (
          'match_fee', 'facility_reward_fee', 'direct_invite_fee',
          'event_participation_fee', 'rental_match_fee'
        )
        AND (
          ct.transaction_type IN ('direct_invite_fee','event_participation_fee','rental_match_fee')
          OR ct.idempotency_key LIKE 'event_match_transaction_fee:%'
          OR ct.idempotency_key LIKE 'performance_reward_fee_match:%'
          OR ct.idempotency_key LIKE 'match_fee:%'
        )
      ORDER BY ct.id
    LOOP
      v_source_refund := public.refund_coin_transaction(
        v_source.id, '案件全体キャンセル'
      );
      IF COALESCE((v_source_refund->>'alreadyRefunded')::boolean, false) IS NOT TRUE THEN
        v_refund_amount := v_refund_amount +
          COALESCE((v_source_refund->>'refundAmount')::integer, 0);
      END IF;
    END LOOP;

    v_cancelled_count := v_cancelled_count + 1;
  END LOOP;

  -- 6. 未承認の直接依頼を返金して却下
  FOR v_application IN
    SELECT a.*
    FROM public.applications a
    WHERE a.request_id = p_request_id
      AND a.source = 'facility_invite'
      AND a.status = 'pending'
    ORDER BY a.id
  LOOP
    v_direct_refund_key :=
      'direct_invite_refund:' || v_application.id::text;

    -- 通知先のLINE IDと演奏者名を取得
    v_pending_direct_line_user_id := NULL;
    v_pending_direct_performer_name := NULL;

    SELECT
      u.line_user_id,
      p.name
    INTO
      v_pending_direct_line_user_id,
      v_pending_direct_performer_name
    FROM public.performers p
    JOIN public.users u
      ON u.id = p.user_id
    WHERE p.id = v_application.performer_id
      AND u.account_status = 'active'
      AND u.line_user_id IS NOT NULL
      AND u.line_user_id NOT LIKE 'withdrawn:%';

    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_direct_refund_key, 0)
    );

    v_direct_fee_amount := 0;

    IF NOT EXISTS (
      SELECT 1
      FROM public.coin_transactions refund
      WHERE refund.idempotency_key IN (
          v_direct_refund_key,
          'direct_invite_refund:' || v_application.id::text
        )
        OR refund.idempotency_key IN (
          SELECT 'direct_invite_refund_attempt:' || aa.id::text
          FROM public.application_attempts aa
          WHERE aa.application_id = v_application.id
            AND aa.source = 'facility_invite'
            AND aa.fee_type = 'direct_invite_fee'
        )
        OR refund.source_transaction_id IN (
          SELECT source.id
          FROM public.coin_transactions source
          WHERE source.user_id = v_facility_user_id
            AND source.request_id = p_request_id
            AND source.application_id = v_application.id
            AND source.transaction_type = 'direct_invite_fee'
            AND source.amount < 0
        )
    ) THEN
      SELECT -ct.amount
      INTO v_direct_fee_amount
      FROM public.coin_transactions ct
      WHERE ct.user_id = v_facility_user_id
        AND ct.request_id = p_request_id
        AND ct.application_id = v_application.id
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.idempotency_key =
          'direct_invite_fee:' ||
          p_request_id::text || ':' ||
          v_application.performer_id::text
      ORDER BY ct.created_at
      LIMIT 1;

      IF COALESCE(v_direct_fee_amount, 0) > 0 THEN
        UPDATE public.users
        SET coin_balance =
          COALESCE(coin_balance, 0) + v_direct_fee_amount
        WHERE id = v_facility_user_id
        RETURNING coin_balance INTO v_balance;

        INSERT INTO public.coin_transactions (
          user_id,
          amount,
          transaction_type,
          description,
          balance_after,
          request_id,
          application_id,
          idempotency_key
        )
        VALUES (
          v_facility_user_id,
          v_direct_fee_amount,
          'admin_adjustment',
          '案件全体キャンセルによる未承認直接依頼手数料返金',
          v_balance,
          p_request_id,
          v_application.id,
          v_direct_refund_key
        );

        v_refund_amount :=
          v_refund_amount + v_direct_fee_amount;

        v_direct_refund_amount :=
          v_direct_refund_amount + v_direct_fee_amount;

        v_pending_direct_refund :=
          v_pending_direct_refund + v_direct_fee_amount;

      END IF;
    END IF;

    -- 新方式の未徴収依頼も、返金額0として取消通知を送る。
    IF v_pending_direct_line_user_id IS NOT NULL THEN
      v_pending_direct_notifications := v_pending_direct_notifications ||
        jsonb_build_array(jsonb_build_object(
          'lineUserId', v_pending_direct_line_user_id,
          'applicationId', v_application.id,
          'requestId', p_request_id,
          'requestTitle', v_request.title,
          'facilityName', v_facility_name,
          'performerName', v_pending_direct_performer_name,
          'refundAmount', COALESCE(v_direct_fee_amount, 0)
        ));
    END IF;

    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_application.id
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE application_id = v_application.id AND status = 'pending';
  END LOOP;

  -- 7. 初回成立手数料は完了済みマッチングがない場合だけ返金
  IF NOT v_has_completed_match THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_initial_refund_key, 0)
    );

    SELECT -ct.amount
    INTO v_initial_fee_amount
    FROM public.coin_transactions ct
    WHERE ct.user_id = v_facility_user_id
      AND ct.request_id = p_request_id
      AND ct.transaction_type = 'match_fee'
      AND ct.amount < 0
      AND ct.idempotency_key =
        'event_match_fee:' || p_request_id::text
    ORDER BY ct.created_at
    LIMIT 1;

    v_has_initial_fee :=
      COALESCE(v_initial_fee_amount, 0) > 0;

    IF v_has_initial_fee
       AND NOT EXISTS (
         SELECT 1
         FROM public.coin_transactions refund
         WHERE refund.idempotency_key = v_initial_refund_key
            OR refund.source_transaction_id IN (
              SELECT source.id FROM public.coin_transactions source
              WHERE source.user_id = v_facility_user_id
                AND source.request_id = p_request_id
                AND source.transaction_type = 'match_fee'
                AND source.amount < 0
                AND source.idempotency_key = 'event_match_fee:' || p_request_id::text
            )
            OR refund.idempotency_key IN (
              SELECT 'refund_source:' || source.id::text FROM public.coin_transactions source
              WHERE source.user_id = v_facility_user_id
                AND source.request_id = p_request_id
                AND source.transaction_type = 'match_fee'
                AND source.amount < 0
                AND source.idempotency_key = 'event_match_fee:' || p_request_id::text
            )
       )
    THEN
      UPDATE public.users
      SET coin_balance =
        COALESCE(coin_balance, 0) + v_initial_fee_amount
      WHERE id = v_facility_user_id
      RETURNING coin_balance INTO v_balance;

      INSERT INTO public.coin_transactions (
        user_id,
        amount,
        transaction_type,
        description,
        balance_after,
        request_id,
        idempotency_key
      )
      VALUES (
        v_facility_user_id,
        v_initial_fee_amount,
        'admin_adjustment',
        'イベント全体キャンセルによる初回マッチング手数料返金',
        v_balance,
        p_request_id,
        v_initial_refund_key
      );

      v_refund_amount :=
        v_refund_amount + v_initial_fee_amount;

      v_initial_refund_amount := v_initial_fee_amount;
    END IF;
  END IF;

  -- Link/refund source debits for pending direct invitations that have no match_id.
  FOR v_source IN
    SELECT ct.id
    FROM public.coin_transactions ct
    WHERE ct.request_id = p_request_id
      AND ct.match_id IS NULL
      AND ct.transaction_type = 'direct_invite_fee'
      AND ct.amount < 0
      AND ct.idempotency_key LIKE 'direct_invite_fee:%'
    ORDER BY ct.id
  LOOP
    v_source_refund := public.refund_coin_transaction(
      v_source.id, '案件全体キャンセル（未成立直接依頼）'
    );
    IF COALESCE((v_source_refund->>'alreadyRefunded')::boolean, false) IS NOT TRUE THEN
      v_refund_amount := v_refund_amount +
        COALESCE((v_source_refund->>'refundAmount')::integer, 0);
    END IF;
  END LOOP;

  -- Link the once-only request fee to its source debit only when the existing policy refunded it.
  IF NOT v_has_completed_match AND v_has_initial_fee THEN
    SELECT ct.id INTO v_source
    FROM public.coin_transactions ct
    WHERE ct.idempotency_key = 'event_match_fee:' || p_request_id::text
      AND ct.transaction_type = 'match_fee' AND ct.amount < 0
    LIMIT 1;
    IF v_source.id IS NOT NULL THEN
      v_source_refund := public.refund_coin_transaction(
        v_source.id, 'イベント・レンタル案件全体キャンセル（初回料金）'
      );
    END IF;
  END IF;

  -- 8. 残った未処理応募を却下
  UPDATE public.applications
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND status = 'pending';

  UPDATE public.application_attempts
  SET status = 'rejected', updated_at = now()
  WHERE request_id = p_request_id AND status = 'pending';

  -- 9. 案件を募集終了にする
  UPDATE public.performance_requests
  SET status = 'closed'
  WHERE id = p_request_id;

  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'requestId', p_request_id,
    'cancelledMatches', v_cancelled_count,
    'cancelledMatchIds', v_cancelled_match_ids,
    'completedMatchesPreserved', v_has_completed_match,
    'refundAmount', v_refund_amount,
    'initialFeeRefund', v_initial_refund_amount,
    'directInviteRefund', v_direct_refund_amount,
    'pendingDirectInviteRefund', v_pending_direct_refund,
    'pendingDirectInviteNotifications', v_pending_direct_notifications,
    'balanceAfter', v_balance,
    'errorMessage', NULL
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.cancel_lesson_application_with_refund(
  p_lesson_application_id uuid,
  p_actor_performer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_app public.lesson_applications%ROWTYPE;
  v_offer public.lesson_offers%ROWTYPE;
  v_teacher_user_id uuid;
  v_applicant_user_id uuid;
  v_source_id uuid;
  v_refund jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  IF p_lesson_application_id IS NULL OR p_actor_performer_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'errorMessage','レッスン応募IDまたは操作ユーザーが不正です');
  END IF;
  SELECT * INTO v_app FROM public.lesson_applications
  WHERE id=p_lesson_application_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'errorMessage','レッスン応募が見つかりません'); END IF;
  SELECT * INTO v_offer FROM public.lesson_offers WHERE id=v_app.lesson_offer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'errorMessage','レッスン募集が見つかりません'); END IF;
  SELECT p.user_id INTO v_teacher_user_id FROM public.performers p WHERE p.id=v_offer.performer_id;
  SELECT p.user_id INTO v_applicant_user_id FROM public.performers p WHERE p.id=v_app.applicant_performer_id;
  IF p_actor_performer_id NOT IN (v_offer.performer_id, v_app.applicant_performer_id) THEN
    RETURN jsonb_build_object('success',false,'errorMessage','このレッスンをキャンセルする権限がありません');
  END IF;
  IF v_app.status='cancelled' THEN
    RETURN jsonb_build_object('success',true,'alreadyCancelled',true,'refundAmount',0);
  END IF;
  IF v_app.status='completed' THEN
    RETURN jsonb_build_object('success',false,'errorMessage','完了済みレッスンはキャンセルできません');
  END IF;
  IF v_app.status IS DISTINCT FROM 'matched' THEN
    RETURN jsonb_build_object('success',false,'errorMessage','成立済みレッスンのみキャンセルできます');
  END IF;
  SELECT s.coin_transaction_id INTO v_source_id
  FROM public.lesson_fee_snapshots s
  WHERE s.lesson_application_id=v_app.id;
  IF v_source_id IS NOT NULL THEN
    v_refund := public.refund_coin_transaction(v_source_id,'レッスン成立後キャンセル');
  ELSE
    v_refund := jsonb_build_object('success',true,'refundAmount',0,'alreadyRefunded',false);
  END IF;
  UPDATE public.lesson_applications SET status='cancelled' WHERE id=v_app.id;
  RETURN jsonb_build_object('success',true,'lessonApplicationId',v_app.id,
    'refundAmount',COALESCE((v_refund->>'refundAmount')::integer,0),
    'balanceAfter',v_refund->'balanceAfter');
END;
$function$;
ALTER FUNCTION public.cancel_lesson_application_with_refund(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_lesson_application_with_refund(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_lesson_application_with_refund(uuid,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.reject_direct_invitation_with_refund(
  p_application_id uuid, p_performer_id uuid
)
RETURNS TABLE(success boolean, balance_after integer, error_message text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_facility_user_id uuid;
  v_request_status text;
  v_app public.applications%ROWTYPE;
  v_fee public.coin_transactions%ROWTYPE;
  v_refund jsonb;
  v_balance integer;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  SELECT a.request_id INTO v_request_id
  FROM public.applications a
  WHERE a.id=p_application_id AND a.performer_id=p_performer_id AND a.source='facility_invite';
  IF NOT FOUND THEN RETURN QUERY SELECT false,NULL::integer,'直接依頼が見つかりません'::text; RETURN; END IF;
  SELECT pr.status,f.user_id INTO v_request_status,v_facility_user_id
  FROM public.performance_requests pr JOIN public.facilities f ON f.id=pr.facility_id
  WHERE pr.id=v_request_id FOR UPDATE OF pr;
  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN QUERY SELECT false,NULL::integer,'案件または施設ユーザーが見つかりません'::text; RETURN;
  END IF;
  IF v_request_status IS DISTINCT FROM 'open' THEN
    RETURN QUERY SELECT false,NULL::integer,'この案件はすでに締め切られています'::text; RETURN;
  END IF;
  SELECT * INTO v_app FROM public.applications
  WHERE id=p_application_id AND request_id=v_request_id FOR UPDATE;
  IF NOT FOUND OR v_app.performer_id IS DISTINCT FROM p_performer_id OR v_app.source IS DISTINCT FROM 'facility_invite' THEN
    RETURN QUERY SELECT false,NULL::integer,'直接依頼が見つかりません'::text; RETURN;
  END IF;
  IF v_app.status NOT IN ('pending','rejected') THEN
    RETURN QUERY SELECT false,NULL::integer,'この依頼は辞退できない状態です'::text; RETURN;
  END IF;
  SELECT * INTO v_fee FROM public.coin_transactions ct
  WHERE ct.idempotency_key='direct_invite_fee:'||v_request_id::text||':'||p_performer_id::text
    AND ct.transaction_type='direct_invite_fee' AND ct.amount<0
    AND ct.user_id=v_facility_user_id AND ct.request_id=v_request_id
    AND ct.application_id=p_application_id
  FOR UPDATE;
  UPDATE public.applications SET status='rejected' WHERE id=v_app.id AND status='pending';
  IF v_fee.id IS NOT NULL THEN
    v_refund := public.refund_coin_transaction(v_fee.id,'直接依頼の辞退');
    v_balance := NULLIF(v_refund->>'balanceAfter','')::integer;
  END IF;
  IF v_balance IS NULL THEN SELECT u.coin_balance INTO v_balance FROM public.users u WHERE u.id=v_facility_user_id; END IF;
  RETURN QUERY SELECT true,v_balance,NULL::text;
END;
$function$;
ALTER FUNCTION public.reject_direct_invitation_with_refund(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_direct_invitation_with_refund(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reject_direct_invitation_with_refund(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reject_direct_invitation_with_refund_for_withdrawal(
  p_application_id uuid, p_performer_id uuid
)
RETURNS TABLE(success boolean, balance_after integer, error_message text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_facility_user_id uuid;
  v_app public.applications%ROWTYPE;
  v_fee public.coin_transactions%ROWTYPE;
  v_refund jsonb;
  v_balance integer;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  SELECT a.request_id INTO v_request_id
  FROM public.applications a
  WHERE a.id=p_application_id AND a.performer_id=p_performer_id AND a.source='facility_invite';
  IF NOT FOUND THEN RETURN QUERY SELECT false,NULL::integer,'直接依頼が見つかりません'::text; RETURN; END IF;
  SELECT f.user_id INTO v_facility_user_id
  FROM public.performance_requests pr JOIN public.facilities f ON f.id=pr.facility_id
  WHERE pr.id=v_request_id FOR UPDATE OF pr;
  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN QUERY SELECT false,NULL::integer,'案件または施設ユーザーが見つかりません'::text; RETURN;
  END IF;
  SELECT * INTO v_app FROM public.applications
  WHERE id=p_application_id AND request_id=v_request_id FOR UPDATE;
  IF NOT FOUND OR v_app.performer_id IS DISTINCT FROM p_performer_id OR v_app.source IS DISTINCT FROM 'facility_invite' THEN
    RETURN QUERY SELECT false,NULL::integer,'直接依頼が見つかりません'::text; RETURN;
  END IF;
  IF v_app.status NOT IN ('pending','rejected') THEN
    RETURN QUERY SELECT false,NULL::integer,'この依頼は返金対象の状態ではありません'::text; RETURN;
  END IF;
  SELECT * INTO v_fee FROM public.coin_transactions ct
  WHERE ct.idempotency_key='direct_invite_fee:'||v_request_id::text||':'||p_performer_id::text
    AND ct.transaction_type='direct_invite_fee' AND ct.amount<0
    AND ct.user_id=v_facility_user_id AND ct.request_id=v_request_id
    AND ct.application_id=p_application_id
  FOR UPDATE;
  UPDATE public.applications SET status='rejected' WHERE id=v_app.id AND status='pending';
  IF v_fee.id IS NOT NULL THEN
    v_refund := public.refund_coin_transaction(v_fee.id,'退会に伴う未成立直接依頼の返金');
    v_balance := NULLIF(v_refund->>'balanceAfter','')::integer;
  END IF;
  IF v_balance IS NULL THEN SELECT u.coin_balance INTO v_balance FROM public.users u WHERE u.id=v_facility_user_id; END IF;
  RETURN QUERY SELECT true,v_balance,NULL::text;
END;
$function$;
ALTER FUNCTION public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.withdraw_user_account(p_line_user_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user public.users%ROWTYPE;
  v_performer_id uuid;
  v_facility_id uuid;
  v_performer_name text;
  v_match record;
  v_cancel_result jsonb;
  v_match_notifications jsonb;
  v_notifications jsonb := '[]'::jsonb;
  v_refund_amount integer;
  v_cancelled_count integer := 0;
  v_withdrawn_band_ids uuid[] := ARRAY[]::uuid[];
  v_handover_band_ids uuid[] := ARRAY[]::uuid[];
  v_is_performer boolean := false;
  v_is_facility boolean := false;
  v_invite record;
  v_refund_result record;
  v_actual_fee integer;
  v_fee_source_id uuid;
  v_refund_key text;
  v_refund_exists boolean;
  v_processed_application_ids uuid[] := ARRAY[]::uuid[];
  v_pending_direct_notifications jsonb := '[]'::jsonb;
  v_pending_direct_refund_notifications jsonb := '[]'::jsonb;
  v_pending_lesson_notifications jsonb := '[]'::jsonb;
  v_pending_application_notifications jsonb := '[]'::jsonb;
  v_application_notification_batch jsonb := '[]'::jsonb;
  v_pending_band_invitation_notifications jsonb := '[]'::jsonb;
  v_pending_band_disband_notifications jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_line_user_id IS NULL OR btrim(p_line_user_id) = '' THEN
    RAISE EXCEPTION 'LINEユーザーIDが指定されていません';
  END IF;

  -- 退会対象ユーザーをロック
  SELECT *
  INTO v_user
  FROM public.users
  WHERE line_user_id = p_line_user_id
    AND account_status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '有効なユーザーが見つからないか、既に退会しています';
  END IF;

  -- user_typeは主プロフィール種別として維持しつつ、実在する両プロフィールを取得する。
  SELECT id, name
  INTO v_performer_id, v_performer_name
  FROM public.performers
  WHERE user_id = v_user.id
  FOR UPDATE;
  v_is_performer := FOUND;

  SELECT id
  INTO v_facility_id
  FROM public.facilities
  WHERE user_id = v_user.id
  FOR UPDATE;
  v_is_facility := FOUND;

  IF NOT v_is_performer AND NOT v_is_facility THEN
    RAISE EXCEPTION '演奏者・施設プロフィールが見つからないため退会できません';
  END IF;

  IF (v_user.user_type = 'performer' AND NOT v_is_performer)
     OR (v_user.user_type = 'facility' AND NOT v_is_facility) THEN
    RAISE EXCEPTION 'ユーザー種別とプロフィール情報が一致しないため退会できません';
  END IF;

  -- 登録履歴の存在確認
  IF NOT EXISTS (
    SELECT 1
    FROM public.line_registration_history
    WHERE line_user_id_hash =
      encode(public.digest(p_line_user_id, 'sha256'), 'hex')
  ) THEN
    RAISE EXCEPTION 'LINE登録履歴が見つからないため退会できません';
  END IF;

  -- 成立済みレッスンがあれば中断
  IF EXISTS (
    SELECT 1
    FROM public.lesson_applications la
    JOIN public.lesson_offers lo
      ON lo.id = la.lesson_offer_id
    JOIN public.performers teacher
      ON teacher.id = lo.performer_id
    JOIN public.performers applicant
      ON applicant.id = la.applicant_performer_id
    WHERE la.status = 'matched'
      AND (
        teacher.user_id = v_user.id
        OR applicant.user_id = v_user.id
      )
  ) THEN
    RAISE EXCEPTION
      '成立済みレッスンが存在します。実施状況を確認してから退会してください';
  END IF;

  -- Capture counterpart notifications before the account-status trigger closes pending lessons.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'applicationId', q.application_id,
        'recipientUserId', q.recipient_user_id,
        'lineUserId', q.line_user_id,
        'lessonTitle', q.lesson_title
      ) ORDER BY q.application_id, q.recipient_user_id
    ),
    '[]'::jsonb
  )
  INTO v_pending_lesson_notifications
  FROM (
    SELECT DISTINCT
      la.id AS application_id,
      recipient.id AS recipient_user_id,
      recipient.line_user_id,
      lo.title AS lesson_title
    FROM public.lesson_applications la
    JOIN public.lesson_offers lo ON lo.id = la.lesson_offer_id
    JOIN public.performers teacher ON teacher.id = lo.performer_id
    JOIN public.users teacher_user ON teacher_user.id = teacher.user_id
    JOIN public.performers applicant ON applicant.id = la.applicant_performer_id
    JOIN public.users applicant_user ON applicant_user.id = applicant.user_id
    CROSS JOIN LATERAL (
      SELECT applicant_user.id, applicant_user.line_user_id, applicant_user.account_status
      WHERE teacher.user_id = v_user.id
      UNION ALL
      SELECT teacher_user.id, teacher_user.line_user_id, teacher_user.account_status
      WHERE applicant.user_id = v_user.id
    ) AS recipient(id, line_user_id, account_status)
    WHERE la.status = 'pending'
      AND (teacher.user_id = v_user.id OR applicant.user_id = v_user.id)
      AND recipient.id <> v_user.id
      AND recipient.account_status = 'active'
      AND NULLIF(recipient.line_user_id, '') IS NOT NULL
      AND recipient.line_user_id NOT LIKE 'withdrawn:%'
  ) q;

  -- 異議申し立て中のマッチングがあれば中断
  IF EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.performance_requests pr
      ON pr.id = m.request_id
    WHERE m.status = 'active'
      AND m.performance_status NOT IN ('completed', 'cancelled')
      AND m.completed_at IS NULL
      AND m.completion_disputed_at IS NOT NULL
      AND (
        (
          v_is_facility
          AND pr.facility_id = v_facility_id
        )
        OR
        (
          v_is_performer
          AND (
            m.performer_id = v_performer_id
            OR COALESCE(
              m.participant_performer_ids,
              ARRAY[]::uuid[]
            ) @> ARRAY[v_performer_id]::uuid[]
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      '異議申し立て中のマッチングがあります。対応完了後に退会してください';
  END IF;

  -- 進行中マッチングを既存RPCでキャンセル
  FOR v_match IN
    SELECT
      m.id AS match_id,
      m.performer_id,
      m.participant_performer_ids,
      (v_is_facility AND pr.facility_id = v_facility_id) AS is_facility_match,
      pr.title AS request_title,
      pr.facility_id,
      facility.name AS facility_name,
      facility_user.line_user_id AS facility_line_user_id
    FROM public.matches m
    JOIN public.performance_requests pr
      ON pr.id = m.request_id
    JOIN public.facilities facility
      ON facility.id = pr.facility_id
    JOIN public.users facility_user
      ON facility_user.id = facility.user_id
    WHERE m.status = 'active'
      AND m.performance_status NOT IN ('completed', 'cancelled')
      AND m.completed_at IS NULL
      AND (
        (
          v_is_facility
          AND pr.facility_id = v_facility_id
        )
        OR
        (
          v_is_performer
          AND (
            m.performer_id = v_performer_id
            OR COALESCE(
              m.participant_performer_ids,
              ARRAY[]::uuid[]
            ) @> ARRAY[v_performer_id]::uuid[]
          )
        )
      )
    ORDER BY m.matched_at
    FOR UPDATE OF m
  LOOP
    -- 既存のキャンセル・返金処理を再利用
    IF v_match.is_facility_match THEN
      v_cancel_result :=
        public.cancel_match_with_direct_invite_refund(
          v_match.match_id,
          v_match.facility_id
        );

      IF COALESCE(
        (v_cancel_result->>'success')::boolean,
        false
      ) IS NOT TRUE THEN
        RAISE EXCEPTION
          'マッチングのキャンセルに失敗しました: %',
          COALESCE(
            v_cancel_result->>'errorMessage',
            v_match.match_id::text
          );
      END IF;

      v_refund_amount := COALESCE((v_cancel_result->>'refundAmount')::integer, 0);
      v_cancelled_count := v_cancelled_count + 1;
    ELSE
      -- Performer withdrawal never auto-cancels an established engagement.
      v_refund_amount := 0;
    END IF;

    -- 施設退会：参加演奏者全員分の通知情報を作成
    IF v_match.is_facility_match THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'lineUserId', recipients.line_user_id,
            'matchId', v_match.match_id,
            'requestTitle', v_match.request_title,
            'facilityName', v_match.facility_name,
            'performerName', recipients.performer_name,
            'withdrawnUserType', 'facility',
            'refundAmount', v_refund_amount
          )
        ),
        '[]'::jsonb
      )
      INTO v_match_notifications
      FROM (
        SELECT DISTINCT
          u.line_user_id,
          p.name AS performer_name
        FROM unnest(
          COALESCE(
            v_match.participant_performer_ids,
            ARRAY[]::uuid[]
          ) || ARRAY[v_match.performer_id]::uuid[]
        ) AS participant(performer_id)
        JOIN public.performers p
          ON p.id = participant.performer_id
        JOIN public.users u
          ON u.id = p.user_id
        WHERE u.account_status = 'active'
          AND u.line_user_id IS NOT NULL
          AND u.line_user_id NOT LIKE 'withdrawn:%'
          AND u.id <> v_user.id
      ) recipients;

    -- 演奏者退会：相手の施設に通知情報を作成
    ELSE
      v_match_notifications :=
        CASE
          WHEN v_match.facility_line_user_id IS NOT NULL
            AND v_match.facility_line_user_id NOT LIKE 'withdrawn:%'
            AND v_match.facility_line_user_id <> p_line_user_id
          THEN jsonb_build_array(
            jsonb_build_object(
              'lineUserId', v_match.facility_line_user_id,
              'matchId', v_match.match_id,
              'requestTitle', v_match.request_title,
              'facilityName', v_match.facility_name,
              'performerName', v_performer_name,
              'withdrawnUserType', 'performer',
              'refundAmount', v_refund_amount
            )
          )
          ELSE '[]'::jsonb
        END;
    END IF;

    v_notifications :=
      v_notifications || v_match_notifications;

  END LOOP;

  -- 施設退会：施設が送信した未成立の直接依頼を実際の徴収額で返金し、演奏者へ通知する。
  IF v_is_facility THEN
    FOR v_invite IN
      SELECT
        a.id AS application_id,
        a.request_id,
        a.performer_id,
        pr.title AS request_title,
        facility.name AS facility_name,
        performer.name AS performer_name,
        performer_user.line_user_id AS recipient_line_user_id
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      JOIN public.facilities facility ON facility.id = pr.facility_id
      JOIN public.performers performer ON performer.id = a.performer_id
      JOIN public.users performer_user ON performer_user.id = performer.user_id
      WHERE pr.facility_id = v_facility_id
        AND a.source = 'facility_invite'
        AND a.status = 'pending'
      ORDER BY a.id
    LOOP
      IF v_invite.application_id = ANY(v_processed_application_ids) THEN
        CONTINUE;
      END IF;

      v_refund_key := 'direct_invite_refund:' || v_invite.application_id::text;
      v_fee_source_id := NULL;
      v_actual_fee := NULL;
      SELECT ct.id, -ct.amount
      INTO v_fee_source_id, v_actual_fee
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key =
          'direct_invite_fee:' || v_invite.request_id::text || ':' || v_invite.performer_id::text
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.request_id = v_invite.request_id
        AND ct.application_id = v_invite.application_id
      ORDER BY ct.created_at, ct.id
      LIMIT 1;

      SELECT EXISTS (
        SELECT 1 FROM public.coin_transactions refund
        WHERE refund.idempotency_key = v_refund_key
           OR (v_fee_source_id IS NOT NULL AND refund.source_transaction_id = v_fee_source_id)
           OR (v_fee_source_id IS NOT NULL AND refund.idempotency_key = 'refund_source:' || v_fee_source_id::text)
           OR refund.idempotency_key IN (
             SELECT 'direct_invite_refund_attempt:' || aa.id::text
             FROM public.application_attempts aa
             WHERE aa.application_id = v_invite.application_id
               AND aa.source = 'facility_invite'
               AND aa.fee_type = 'direct_invite_fee'
           )
      ) INTO v_refund_exists;

      IF v_actual_fee IS NULL THEN
        -- No debit exists: cancel the pending invite without inventing a refund.
        UPDATE public.applications
        SET status = 'rejected'
        WHERE id = v_invite.application_id AND status = 'pending';
        UPDATE public.application_attempts
        SET status = 'rejected', updated_at = now()
        WHERE application_id = v_invite.application_id AND status = 'pending';
        IF v_invite.recipient_line_user_id IS NOT NULL
           AND v_invite.recipient_line_user_id NOT LIKE 'withdrawn:%'
           AND v_invite.recipient_line_user_id <> p_line_user_id THEN
          v_pending_direct_notifications := v_pending_direct_notifications || jsonb_build_array(
            jsonb_build_object('lineUserId', v_invite.recipient_line_user_id,
              'applicationId', v_invite.application_id, 'requestId', v_invite.request_id,
              'requestTitle', v_invite.request_title, 'facilityName', v_invite.facility_name,
              'performerName', v_invite.performer_name, 'refundAmount', 0)
          );
        END IF;
        v_processed_application_ids := array_append(v_processed_application_ids, v_invite.application_id);
        CONTINUE;
      END IF;

      SELECT * INTO v_refund_result
      FROM public.reject_direct_invitation_with_refund_for_withdrawal(
        v_invite.application_id, v_invite.performer_id
      );

      IF NOT COALESCE(v_refund_result.success, false) THEN
        RAISE EXCEPTION '退会時の未成立直接依頼返金に失敗しました: %',
          COALESCE(v_refund_result.error_message, v_invite.application_id::text);
      END IF;

      UPDATE public.application_attempts
      SET status = 'rejected', updated_at = now()
      WHERE application_id = v_invite.application_id AND status = 'pending';
      v_processed_application_ids := array_append(v_processed_application_ids, v_invite.application_id);
      IF NOT v_refund_exists AND COALESCE(v_actual_fee, 0) > 0
         AND v_invite.recipient_line_user_id IS NOT NULL
         AND v_invite.recipient_line_user_id NOT LIKE 'withdrawn:%'
         AND v_invite.recipient_line_user_id <> p_line_user_id THEN
        v_pending_direct_notifications := v_pending_direct_notifications || jsonb_build_array(
          jsonb_build_object(
            'lineUserId', v_invite.recipient_line_user_id,
            'applicationId', v_invite.application_id,
            'requestId', v_invite.request_id,
            'requestTitle', v_invite.request_title,
            'facilityName', v_invite.facility_name,
            'performerName', v_invite.performer_name,
            'refundAmount', v_actual_fee
          )
        );
      END IF;
    END LOOP;
  END IF;

  -- 演奏者退会：本人が受信した未成立の直接依頼を返金し、元の施設ユーザーへ通知する。
  IF v_is_performer THEN
    FOR v_invite IN
      SELECT
        a.id AS application_id,
        a.request_id,
        a.performer_id,
        pr.title AS request_title,
        facility.name AS facility_name,
        facility_user.line_user_id AS recipient_line_user_id,
        performer.name AS performer_name
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      JOIN public.facilities facility ON facility.id = pr.facility_id
      JOIN public.users facility_user ON facility_user.id = facility.user_id
      JOIN public.performers performer ON performer.id = a.performer_id
      WHERE a.performer_id = v_performer_id
        AND a.source = 'facility_invite'
        AND a.status = 'pending'
      ORDER BY a.id
    LOOP
      IF v_invite.application_id = ANY(v_processed_application_ids) THEN
        CONTINUE;
      END IF;

      v_refund_key := 'direct_invite_refund:' || v_invite.application_id::text;
      v_fee_source_id := NULL;
      v_actual_fee := NULL;
      SELECT ct.id, -ct.amount
      INTO v_fee_source_id, v_actual_fee
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key =
          'direct_invite_fee:' || v_invite.request_id::text || ':' || v_invite.performer_id::text
        AND ct.transaction_type = 'direct_invite_fee'
        AND ct.amount < 0
        AND ct.request_id = v_invite.request_id
        AND ct.application_id = v_invite.application_id
      ORDER BY ct.created_at, ct.id
      LIMIT 1;

      SELECT EXISTS (
        SELECT 1 FROM public.coin_transactions refund
        WHERE refund.idempotency_key = v_refund_key
           OR (v_fee_source_id IS NOT NULL AND refund.source_transaction_id = v_fee_source_id)
           OR (v_fee_source_id IS NOT NULL AND refund.idempotency_key = 'refund_source:' || v_fee_source_id::text)
           OR refund.idempotency_key IN (
             SELECT 'direct_invite_refund_attempt:' || aa.id::text
             FROM public.application_attempts aa
             WHERE aa.application_id = v_invite.application_id
               AND aa.source = 'facility_invite'
               AND aa.fee_type = 'direct_invite_fee'
           )
      ) INTO v_refund_exists;

      IF v_actual_fee IS NULL THEN
        -- No debit exists: cancel the pending invite without inventing a refund.
        UPDATE public.applications
        SET status = 'rejected'
        WHERE id = v_invite.application_id AND status = 'pending';
        UPDATE public.application_attempts
        SET status = 'rejected', updated_at = now()
        WHERE application_id = v_invite.application_id AND status = 'pending';
        IF v_invite.recipient_line_user_id IS NOT NULL
           AND v_invite.recipient_line_user_id NOT LIKE 'withdrawn:%'
           AND v_invite.recipient_line_user_id <> p_line_user_id THEN
          v_pending_direct_refund_notifications := v_pending_direct_refund_notifications || jsonb_build_array(
            jsonb_build_object('lineUserId', v_invite.recipient_line_user_id,
              'applicationId', v_invite.application_id, 'requestId', v_invite.request_id,
              'requestTitle', v_invite.request_title, 'facilityName', v_invite.facility_name,
              'performerName', v_invite.performer_name, 'refundAmount', 0)
          );
        END IF;
        v_processed_application_ids := array_append(v_processed_application_ids, v_invite.application_id);
        CONTINUE;
      END IF;

      SELECT * INTO v_refund_result
      FROM public.reject_direct_invitation_with_refund_for_withdrawal(
        v_invite.application_id, v_invite.performer_id
      );

      IF NOT COALESCE(v_refund_result.success, false) THEN
        RAISE EXCEPTION '退会時の未成立直接依頼返金に失敗しました: %',
          COALESCE(v_refund_result.error_message, v_invite.application_id::text);
      END IF;

      UPDATE public.application_attempts
      SET status = 'rejected', updated_at = now()
      WHERE application_id = v_invite.application_id AND status = 'pending';
      v_processed_application_ids := array_append(v_processed_application_ids, v_invite.application_id);
      IF NOT v_refund_exists AND COALESCE(v_actual_fee, 0) > 0
         AND v_invite.recipient_line_user_id IS NOT NULL
         AND v_invite.recipient_line_user_id NOT LIKE 'withdrawn:%'
         AND v_invite.recipient_line_user_id <> p_line_user_id THEN
        v_pending_direct_refund_notifications := v_pending_direct_refund_notifications || jsonb_build_array(
          jsonb_build_object(
            'lineUserId', v_invite.recipient_line_user_id,
            'applicationId', v_invite.application_id,
            'requestId', v_invite.request_id,
            'requestTitle', v_invite.request_title,
            'facilityName', v_invite.facility_name,
            'performerName', v_invite.performer_name,
            'refundAmount', v_actual_fee
          )
        );
      END IF;
    END LOOP;
  END IF;

  -- 施設退会処理
  IF v_is_facility THEN
    -- Capture ordinary solo/band applicants before their pending rows are rejected.
    -- Direct invitations are handled above by the fee-aware dedicated flow.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'applicationId', q.application_id,
          'recipientUserId', q.recipient_user_id,
          'lineUserId', q.line_user_id,
          'requestTitle', q.request_title,
          'withdrawnUserType', 'facility',
          'applicationSource', q.application_source,
          'bandName', q.band_name
        ) ORDER BY q.application_id, q.recipient_user_id
      ), '[]'::jsonb
    )
    INTO v_application_notification_batch
    FROM (
      SELECT DISTINCT
        a.id AS application_id,
        recipient.id AS recipient_user_id,
        recipient.line_user_id,
        pr.title AS request_title,
        a.source AS application_source,
        CASE WHEN a.source = 'band_apply' THEN COALESCE(NULLIF(b.name, ''), 'バンド') ELSE NULL END AS band_name
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      LEFT JOIN public.bands b ON b.id = a.band_id
      JOIN LATERAL (
        SELECT u.id, u.line_user_id
        FROM public.performers p
        JOIN public.users u ON u.id = p.user_id
        WHERE a.source = 'performer_apply'
          AND p.id = a.performer_id
          AND u.account_status = 'active'
        UNION ALL
        SELECT u.id, u.line_user_id
        FROM public.band_members bm
        JOIN public.performers p ON p.id = bm.performer_id
        JOIN public.users u ON u.id = p.user_id
        WHERE a.source = 'band_apply'
          AND bm.band_id = a.band_id
          AND bm.status = 'active'
          AND u.account_status = 'active'
      ) recipient ON true
      WHERE pr.facility_id = v_facility_id
        AND a.status = 'pending'
        AND a.source IN ('performer_apply', 'band_apply')
        AND recipient.id <> v_user.id
        AND NULLIF(recipient.line_user_id, '') IS NOT NULL
        AND recipient.line_user_id NOT LIKE 'withdrawn:%'
    ) q;
    v_pending_application_notifications := v_pending_application_notifications || v_application_notification_batch;

    UPDATE public.applications a
    SET status = 'rejected'
    FROM public.performance_requests pr
    WHERE a.request_id = pr.id
      AND pr.facility_id = v_facility_id
      AND a.status = 'pending';

    UPDATE public.application_attempts aa
    SET status = 'rejected', updated_at = now()
    WHERE aa.status = 'pending'
      AND aa.application_id IN (
        SELECT a.id
        FROM public.applications a
        JOIN public.performance_requests pr ON pr.id = a.request_id
        WHERE pr.facility_id = v_facility_id
      );

    UPDATE public.performance_requests
    SET status = 'closed'
    WHERE facility_id = v_facility_id
      AND status IN ('open', 'matched');

    UPDATE public.facilities
    SET
      name = NULL,
      address = NULL,
      description = NULL,
      facility_type = NULL
    WHERE id = v_facility_id;
  END IF;

  -- 演奏者退会処理
  IF v_is_performer THEN
    -- Determine leader-owned bands before capturing/rejecting their pending applications.
    -- Leader-owned bands with an eligible active successor are handed over.
    SELECT COALESCE(array_agg(DISTINCT leader_membership.band_id), ARRAY[]::uuid[])
    INTO v_handover_band_ids
    FROM public.band_members leader_membership
    JOIN public.bands b ON b.id = leader_membership.band_id AND b.status = 'active'
    WHERE leader_membership.performer_id = v_performer_id
      AND leader_membership.status = 'active'
      AND leader_membership.role = 'leader'
      AND EXISTS (
        SELECT 1
        FROM public.band_members successor
        JOIN public.performers successor_performer ON successor_performer.id = successor.performer_id
        JOIN public.users successor_user ON successor_user.id = successor_performer.user_id
        WHERE successor.band_id = leader_membership.band_id
          AND successor.status = 'active'
          AND successor.performer_id <> v_performer_id
          AND successor_user.account_status = 'active'
      );

    -- Disband only when no eligible active member can inherit leadership.
    SELECT COALESCE(array_agg(DISTINCT leader_membership.band_id), ARRAY[]::uuid[])
    INTO v_withdrawn_band_ids
    FROM public.band_members leader_membership
    JOIN public.bands b ON b.id = leader_membership.band_id AND b.status = 'active'
    WHERE leader_membership.performer_id = v_performer_id
      AND leader_membership.status = 'active'
      AND leader_membership.role = 'leader'
      AND NOT (leader_membership.band_id = ANY(v_handover_band_ids));

    -- Transfer each leadership role to the oldest active eligible member.
    UPDATE public.band_members outgoing
    SET role = 'member'
    WHERE outgoing.band_id = ANY(v_handover_band_ids)
      AND outgoing.performer_id = v_performer_id
      AND outgoing.status = 'active'
      AND outgoing.role = 'leader';

    UPDATE public.band_members successor
    SET role = 'leader'
    FROM (
      SELECT DISTINCT ON (bm.band_id) bm.band_id, bm.performer_id
      FROM public.band_members bm
      JOIN public.performers p ON p.id = bm.performer_id
      JOIN public.users u ON u.id = p.user_id
      WHERE bm.band_id = ANY(v_handover_band_ids)
        AND bm.status = 'active'
        AND bm.performer_id <> v_performer_id
        AND u.account_status = 'active'
      ORDER BY bm.band_id, bm.joined_at ASC NULLS LAST, bm.performer_id ASC
    ) chosen
    WHERE successor.band_id = chosen.band_id
      AND successor.performer_id = chosen.performer_id
      AND successor.status = 'active';

    -- Capture facilities affected by this performer's solo applications and by
    -- applications of leader-owned bands that will be disbanded.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'applicationId', q.application_id,
          'recipientUserId', q.recipient_user_id,
          'lineUserId', q.line_user_id,
          'requestTitle', q.request_title,
          'withdrawnUserType', 'performer',
          'applicationSource', q.application_source,
          'bandName', q.band_name
        ) ORDER BY q.application_id, q.recipient_user_id
      ), '[]'::jsonb
    )
    INTO v_application_notification_batch
    FROM (
      SELECT DISTINCT
        a.id AS application_id,
        recipient.id AS recipient_user_id,
        recipient.line_user_id,
        pr.title AS request_title,
        a.source AS application_source,
        CASE WHEN a.source = 'band_apply' THEN COALESCE(NULLIF(b.name, ''), 'バンド') ELSE NULL END AS band_name
      FROM public.applications a
      JOIN public.performance_requests pr ON pr.id = a.request_id
      LEFT JOIN public.bands b ON b.id = a.band_id
      JOIN public.facilities f ON f.id = pr.facility_id
      JOIN public.users recipient ON recipient.id = f.user_id
      WHERE a.status = 'pending'
        AND recipient.id <> v_user.id
        AND recipient.account_status = 'active'
        AND NULLIF(recipient.line_user_id, '') IS NOT NULL
        AND recipient.line_user_id NOT LIKE 'withdrawn:%'
        AND (
          (a.source = 'performer_apply' AND a.performer_id = v_performer_id)
          OR (a.source = 'band_apply' AND a.band_id = ANY(v_withdrawn_band_ids))
        )
    ) q;
    v_pending_application_notifications := v_pending_application_notifications || v_application_notification_batch;

    -- 本人の未処理応募を終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE performer_id = v_performer_id
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE performer_id = v_performer_id AND status = 'pending';

    -- レッスン募集を終了。予約コインは残高に加算しない
    UPDATE public.lesson_offers
    SET
      status = 'closed',
      reserved_coins = 0
    WHERE performer_id = v_performer_id
      AND status = 'open';

    -- Capture the other party for pending invitations affected by withdrawal or band disband.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'invitationId', q.invitation_id,
          'recipientUserId', q.recipient_user_id,
          'lineUserId', q.line_user_id,
          'bandName', q.band_name
        ) ORDER BY q.invitation_id, q.recipient_user_id
      ),
      '[]'::jsonb
    )
    INTO v_pending_band_invitation_notifications
    FROM (
      SELECT DISTINCT
        bi.id AS invitation_id,
        recipient_user.id AS recipient_user_id,
        recipient_user.line_user_id,
        COALESCE(NULLIF(b.name, ''), 'バンド') AS band_name
      FROM public.band_invitations bi
      JOIN public.bands b ON b.id = bi.band_id
      JOIN public.performers recipient_performer
        ON recipient_performer.id = CASE
          WHEN bi.invitee_performer_id = v_performer_id
            THEN bi.inviter_performer_id
          ELSE bi.invitee_performer_id
        END
      JOIN public.users recipient_user ON recipient_user.id = recipient_performer.user_id
      WHERE bi.status = 'pending'
        AND (
          bi.inviter_performer_id = v_performer_id
          OR bi.invitee_performer_id = v_performer_id
          OR bi.band_id = ANY(v_withdrawn_band_ids)
        )
        AND recipient_user.id <> v_user.id
        AND recipient_user.account_status = 'active'
        AND NULLIF(recipient_user.line_user_id, '') IS NOT NULL
        AND recipient_user.line_user_id NOT LIKE 'withdrawn:%'
    ) q;

    -- Capture active members who need to know their leader's band was disbanded.
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bandId', q.band_id,
          'recipientUserId', q.recipient_user_id,
          'lineUserId', q.line_user_id,
          'bandName', q.band_name
        ) ORDER BY q.band_id, q.recipient_user_id
      ),
      '[]'::jsonb
    )
    INTO v_pending_band_disband_notifications
    FROM (
      SELECT DISTINCT
        b.id AS band_id,
        u.id AS recipient_user_id,
        u.line_user_id,
        COALESCE(NULLIF(b.name, ''), 'バンド') AS band_name
      FROM public.band_members bm
      JOIN public.bands b ON b.id = bm.band_id
      JOIN public.performers p ON p.id = bm.performer_id
      JOIN public.users u ON u.id = p.user_id
      WHERE bm.band_id = ANY(v_withdrawn_band_ids)
        AND bm.status = 'active'
        AND u.id <> v_user.id
        AND u.account_status = 'active'
        AND NULLIF(u.line_user_id, '') IS NOT NULL
        AND u.line_user_id NOT LIKE 'withdrawn:%'
    ) q;

    -- Cancel invitations involving the withdrawing performer and all pending invitations in disbanded bands.
    UPDATE public.band_invitations
    SET status = 'cancelled', responded_at = now()
    WHERE status = 'pending'
      AND (
        inviter_performer_id = v_performer_id
        OR invitee_performer_id = v_performer_id
        OR band_id = ANY(v_withdrawn_band_ids)
      );

    -- リーダーのバンドを解散
    UPDATE public.bands
    SET
      status = 'disbanded',
      updated_at = now()
    WHERE id = ANY(v_withdrawn_band_ids);

    -- 解散したバンドの全メンバーを所属終了
    UPDATE public.band_members
    SET status = 'left'
    WHERE band_id = ANY(v_withdrawn_band_ids)
      AND status = 'active';

    -- 解散したバンドの未処理応募を終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE band_id = ANY(v_withdrawn_band_ids)
      AND status = 'pending';

    UPDATE public.application_attempts
    SET status = 'rejected', updated_at = now()
    WHERE band_id = ANY(v_withdrawn_band_ids)
      AND status = 'pending';

    -- リーダー以外は本人だけ所属終了
    UPDATE public.band_members
    SET status = 'left'
    WHERE performer_id = v_performer_id
      AND status = 'active'
      AND NOT (
        band_id = ANY(v_withdrawn_band_ids)
      );

    -- 演奏者プロフィールを匿名化
    UPDATE public.performers
    SET
      name = NULL,
      instruments = '{}',
      genres = '{}',
      area = NULL,
      areas = '{}',
      bio = NULL,
      status_level = NULL
    WHERE id = v_performer_id;
  END IF;

  -- LINE登録履歴の退会日時を更新
  UPDATE public.line_registration_history
  SET
    last_withdrawn_at = now(),
    updated_at = now()
  WHERE line_user_id_hash =
    encode(public.digest(p_line_user_id, 'sha256'), 'hex');

  -- 旧アカウントを匿名化し、LINE IDを解放
  UPDATE public.users
  SET
    line_user_id = 'withdrawn:' || id::text,
    account_status = 'withdrawn',
    withdrawn_at = now(),
    display_name = NULL,
    picture_url = NULL,
    avatar_type = 'line',
    avatar_emoji = NULL
  WHERE id = v_user.id;

  RETURN jsonb_build_object(
    'success', true,
    'userId', v_user.id,
    'userType', v_user.user_type,
    'cancelledMatchCount', v_cancelled_count,
    'notifications', v_notifications,
    'pendingDirectInviteNotifications', v_pending_direct_notifications,
    'pendingDirectInviteRefundNotifications', v_pending_direct_refund_notifications,
    'pendingLessonNotifications', v_pending_lesson_notifications,
    'pendingApplicationNotifications', v_pending_application_notifications,
    'pendingBandInvitationNotifications', v_pending_band_invitation_notifications,
    'pendingBandDisbandNotifications', v_pending_band_disband_notifications
  );
END;
$function$;
ALTER FUNCTION public.withdraw_user_account(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.withdraw_user_account(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_user_account(text) TO service_role;

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
  v_band_id text;
  v_recipient_user_id text;
  v_text text;
  v_user_type text;
  v_refund_amount integer;
  v_withdrawn_user_type text;
  v_application_source text;
  v_band_name text;
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
      ELSE '演奏者が退会しました。成立済み案件は自動キャンセルされていません。今後の対応をご確認ください。'
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
       OR NULLIF(v_application_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := '施設が退会したため、ダイレクトオファーは取り消されました。案件：' ||
      COALESCE(v_item->>'requestTitle', '案件') || E'\nこの依頼は無効になっています。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_direct_cancel:' || v_application_id || ':' || v_line_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingDirectInviteRefundNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'applicationId';
    v_refund_amount := COALESCE((v_item->>'refundAmount')::integer, 0);
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := '演奏者が退会したため、ダイレクトオファーは取り消されました。案件：' ||
      COALESCE(v_item->>'requestTitle', '案件') ||
      CASE WHEN v_refund_amount > 0
        THEN E'\n直接依頼手数料' || v_refund_amount::text || 'コインを施設へ返金しました。'
        ELSE E'\nマッチング成立前の手数料徴収はなく、返金はありません。' END;
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_direct_refund:' || v_application_id || ':' || v_line_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingApplicationNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'applicationId';
    v_recipient_user_id := v_item->>'recipientUserId';
    v_withdrawn_user_type := v_item->>'withdrawnUserType';
    v_application_source := v_item->>'applicationSource';
    v_band_name := v_item->>'bandName';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL OR NULLIF(v_recipient_user_id, '') IS NULL
       OR v_withdrawn_user_type IS NULL
       OR v_withdrawn_user_type NOT IN ('facility', 'performer') THEN
      CONTINUE;
    END IF;
    IF v_withdrawn_user_type = 'facility' THEN
      v_text := CASE WHEN v_application_source = 'band_apply'
        THEN '応募先施設の退会に伴い、バンド「' || COALESCE(v_band_name, 'バンド') || '」の応募は取り消されました。'
        ELSE '応募先施設の退会に伴い、演奏応募は取り消されました。' END;
    ELSE
      v_text := CASE WHEN v_application_source = 'band_apply'
        THEN '応募バンドのリーダー退会・解散に伴い、バンド「' || COALESCE(v_band_name, 'バンド') || '」の応募は取り消されました。'
        ELSE '応募者の退会に伴い、演奏応募は取り消されました。' END;
    END IF;
    v_text := v_text || ' 案件：' || COALESCE(v_item->>'requestTitle', '案件') ||
      E'\nLINEミニアプリから最新状況をご確認ください。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES (
      'withdrawal_application:' || v_application_id || ':' || v_recipient_user_id,
      v_line_user_id,
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
    ) ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingLessonNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'applicationId';
    v_recipient_user_id := v_item->>'recipientUserId';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL OR NULLIF(v_recipient_user_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := '相手ユーザーの退会に伴い、レッスン応募は取り消されました。募集：' ||
      COALESCE(v_item->>'lessonTitle', 'レッスン');
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_lesson_application:' || v_application_id || ':' || v_recipient_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingBandInvitationNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_application_id := v_item->>'invitationId';
    v_recipient_user_id := v_item->>'recipientUserId';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_application_id, '') IS NULL OR NULLIF(v_recipient_user_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := '退会またはバンド解散に伴い、バンド「' || COALESCE(v_item->>'bandName','バンド') ||
      '」への参加招待は取り消されました。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_band_invitation:' || v_application_id || ':' || v_recipient_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_result->'pendingBandDisbandNotifications', '[]'::jsonb))
  LOOP
    v_line_user_id := v_item->>'lineUserId';
    v_band_id := v_item->>'bandId';
    v_recipient_user_id := v_item->>'recipientUserId';
    IF NULLIF(v_line_user_id, '') IS NULL OR v_line_user_id LIKE 'withdrawn:%'
       OR v_line_user_id IS NOT DISTINCT FROM p_line_user_id
       OR NULLIF(v_band_id, '') IS NULL OR NULLIF(v_recipient_user_id, '') IS NULL THEN CONTINUE; END IF;
    v_text := 'リーダーの退会に伴い、バンド「' || COALESCE(v_item->>'bandName','バンド') || '」は解散しました。';
    INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
    VALUES ('withdrawal_band_disband:' || v_band_id || ':' || v_recipient_user_id,
      v_line_user_id, jsonb_build_array(jsonb_build_object('type','text','text',v_text)))
    ON CONFLICT (event_key) DO NOTHING;
  END LOOP;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.withdraw_user_account_with_notification_outbox(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.withdraw_user_account_with_notification_outbox(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_user_account_with_notification_outbox(text) TO service_role;

DO $postflight$
BEGIN
  IF to_regprocedure('public.refund_coin_transaction(uuid,text)') IS NULL
     OR to_regprocedure('public.cancel_match_with_direct_invite_refund(uuid,uuid)') IS NULL
     OR to_regprocedure('public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)') IS NULL
     OR to_regprocedure('public.cancel_lesson_application_with_refund(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'V48 final postflight failed: required refund/lifecycle RPC is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND indexname='coin_transactions_source_transaction_id_uidx') THEN
    RAISE EXCEPTION 'V48 final postflight failed: source refund unique index is missing';
  END IF;
END;
$postflight$;
COMMIT;
