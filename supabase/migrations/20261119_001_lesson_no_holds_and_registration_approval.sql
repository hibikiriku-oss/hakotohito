-- Hakotohito 2026-11-19: remove lesson coin holds and add first-registration approval metadata.
-- All fee checks happen without reservation; fees are charged atomically at matching.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.apply_to_lesson_offer(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)') IS NULL
     OR to_regprocedure('public.update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])') IS NULL
     OR to_regprocedure('public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)') IS NULL
     OR to_regprocedure('public.spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required V44 routines are missing; do not apply this migration to an unexpected baseline';
  END IF;
  -- Fail closed unless the live routines exactly match the inspected production baseline.
  IF md5(pg_get_functiondef('public.apply_to_lesson_offer(uuid,uuid,text)'::regprocedure)) <> '5be2c47bc9922aca406b3ee1570bf69b'
     OR md5(pg_get_functiondef('public.create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)'::regprocedure)) <> '295a8ab05d0688897a2a182bbad9d36f'
     OR md5(pg_get_functiondef('public.update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])'::regprocedure)) <> 'dddb28d69f43d213050324ee24f4ba58'
     OR md5(pg_get_functiondef('public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)'::regprocedure)) <> 'b35615756e1253860b3ad142c3090cfa'
     OR md5(pg_get_functiondef('public.spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)'::regprocedure)) <> '8c946d0ad72d11b5a19303b565cfd4b2' THEN
    RAISE EXCEPTION 'Live V44 routine definitions differ from the inspected production baseline; stop and reconcile before applying V45.2';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
      WHERE c.conrelid='public.users'::regclass AND c.conname='users_account_status_check')
      IS DISTINCT FROM 'CHECK ((account_status = ANY (ARRAY[''active''::text, ''withdrawn''::text])))' THEN
    RAISE EXCEPTION 'users_account_status_check differs from the inspected production definition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lesson_offers' AND column_name='reserved_coins') THEN
    RAISE EXCEPTION 'lesson_offers.reserved_coins is missing';
  END IF;
  IF COALESCE((SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users' AND column_name='account_status'), '')
      NOT IN ('text', 'character varying', 'character') THEN
    RAISE EXCEPTION 'users.account_status must be a text-like column before adding pending_approval';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='users' AND t.tgname='trg_global_mutation_gate' AND NOT t.tgisinternal AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Global mutation gate trigger on public.users is missing';
  END IF;
  -- The application and database guards consistently treat account_status='active'
  -- as the permission gate. Keep that single gate: pending_approval must remain a
  -- non-active account_status value so existing active-only API/RPC checks reject it.
  -- Only replace the known V44 constraint; stop if an additional/custom constraint
  -- also governs account_status and would need separate review.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.users'::regclass AND c.contype='c'
      AND pg_get_constraintdef(c.oid) ILIKE '%account_status%'
      AND c.conname <> 'users_account_status_check'
  ) THEN
    RAISE EXCEPTION 'An unexpected users.account_status check constraint exists; inspect it before applying';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.users'::regclass AND c.contype='c'
      AND c.conname='users_account_status_check'
      AND (
        pg_get_constraintdef(c.oid) NOT ILIKE '%active%'
        OR pg_get_constraintdef(c.oid) NOT ILIKE '%withdrawn%'
      )
  ) THEN
    RAISE EXCEPTION 'users_account_status_check differs from the inspected production constraint';
  END IF;
END;
$preflight$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_by_user_id uuid;

-- Extend the existing status constraint without changing any existing account.
-- Existing active users remain active; new registrations use pending_approval;
-- withdrawn remains available for the existing withdrawal/re-registration flow.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_account_status_check
  CHECK (account_status = ANY (ARRAY['active'::text, 'withdrawn'::text, 'pending_approval'::text]));

CREATE OR REPLACE FUNCTION public.apply_to_lesson_offer(p_lesson_offer_id uuid, p_applicant_performer_id uuid, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_teacher_performer_id uuid;
  v_teacher_user_id uuid;
  v_lesson_fee integer;
  v_capacity integer;
  v_offer_status text;
  v_matched_count integer;
  v_application_id uuid;
  v_balance integer;
  v_new_balance integer;
  v_charge integer;
  v_teacher_status text;
  v_applicant_status text;
  v_applicant_user_id uuid;
  v_applicant_level text;
  v_target_levels text[];
  v_lesson_date date;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  SELECT lo.performer_id, p.user_id, lo.lesson_fee, lo.capacity, lo.status,
         lo.target_levels, lo.lesson_date
  INTO v_teacher_performer_id, v_teacher_user_id, v_lesson_fee, v_capacity,
       v_offer_status, v_target_levels, v_lesson_date
  FROM public.lesson_offers lo
  JOIN public.performers p ON p.id = lo.performer_id
  WHERE lo.id = p_lesson_offer_id
  FOR UPDATE OF lo;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'レッスン募集が見つかりません');
  END IF;
  IF v_offer_status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'このレッスンは募集を終了しています');
  END IF;
  IF v_lesson_date IS NOT NULL
     AND v_lesson_date < (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RETURN jsonb_build_object('success', false, 'error', '開催日を過ぎたレッスンには応募できません');
  END IF;
  IF p_applicant_performer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '応募する演奏者が見つかりません');
  END IF;
  SELECT p.user_id, p.status_level, u.account_status
  INTO v_applicant_user_id, v_applicant_level, v_applicant_status
  FROM public.performers p
  JOIN public.users u ON u.id = p.user_id
  WHERE p.id = p_applicant_performer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '応募する演奏者が見つかりません');
  END IF;
  IF p_applicant_performer_id = v_teacher_performer_id
     OR v_applicant_user_id = v_teacher_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', '自分自身のレッスンには応募できません');
  END IF;
  IF v_applicant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', '有効なアカウントが必要です');
  END IF;
  IF COALESCE(cardinality(v_target_levels), 0) > 0 AND (
    v_applicant_level IS NULL OR NOT EXISTS (
      SELECT 1
      FROM unnest(v_target_levels) AS target(level)
      WHERE
        CASE lower(btrim(target.level))
          WHEN 'beginner' THEN 'beginner'
          WHEN '初心者' THEN 'beginner'
          WHEN '初級' THEN 'beginner'
          WHEN '初級者' THEN 'beginner'
          WHEN 'amateur' THEN 'amateur'
          WHEN 'アマ' THEN 'amateur'
          WHEN 'アマチュア' THEN 'amateur'
          WHEN 'pro' THEN 'pro'
          WHEN 'プロ' THEN 'pro'
          WHEN 'プロフェッショナル' THEN 'pro'
          ELSE lower(btrim(target.level))
        END
        =
        CASE lower(btrim(v_applicant_level))
          WHEN 'beginner' THEN 'beginner'
          WHEN '初心者' THEN 'beginner'
          WHEN '初級' THEN 'beginner'
          WHEN '初級者' THEN 'beginner'
          WHEN 'amateur' THEN 'amateur'
          WHEN 'アマ' THEN 'amateur'
          WHEN 'アマチュア' THEN 'amateur'
          WHEN 'pro' THEN 'pro'
          WHEN 'プロ' THEN 'pro'
          WHEN 'プロフェッショナル' THEN 'pro'
          ELSE lower(btrim(v_applicant_level))
        END
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '登録プロフィールの演奏者レベルが募集対象外のため応募できません');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.lesson_applications
    WHERE lesson_offer_id = p_lesson_offer_id
      AND applicant_performer_id = p_applicant_performer_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'このレッスンにはすでに応募しています');
  END IF;

  SELECT COUNT(*)::integer INTO v_matched_count
  FROM public.lesson_applications
  WHERE lesson_offer_id = p_lesson_offer_id AND status = 'matched';

  IF v_matched_count >= v_capacity THEN
    UPDATE public.lesson_offers SET status = 'closed', reserved_coins = 0 WHERE id = p_lesson_offer_id;
    RETURN jsonb_build_object('success', false, 'error', 'このレッスンは定員に達しています');
  END IF;

  v_charge := public.configured_lesson_fee(v_lesson_fee);
  IF v_charge IS NULL OR v_charge < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'レッスン成立手数料の設定が正しくありません');
  END IF;

  SELECT u.coin_balance, u.account_status
  INTO v_balance, v_teacher_status
  FROM public.users u
  WHERE u.id = v_teacher_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance IS NULL OR v_teacher_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', '講師アカウントを確認できません');
  END IF;

  IF v_balance < 0 OR v_balance < v_charge THEN
    RETURN jsonb_build_object('success', false, 'error', '講師のコイン残高が不足しているため成立できません');
  END IF;

  INSERT INTO public.lesson_applications (
    lesson_offer_id, applicant_performer_id, message, status, matched_at
  ) VALUES (
    p_lesson_offer_id, p_applicant_performer_id, p_message, 'matched', now()
  ) RETURNING id INTO v_application_id;

  v_new_balance := v_balance - v_charge;
  UPDATE public.users SET coin_balance = v_new_balance WHERE id = v_teacher_user_id;

  INSERT INTO public.coin_transactions (
    user_id, amount, transaction_type, description, balance_after,
    created_by_user_id, idempotency_key
  ) VALUES (
    v_teacher_user_id, -v_charge, 'lesson_match_fee', 'レッスン成立手数料',
    v_new_balance, v_teacher_user_id, 'lesson_match_fee:' || v_application_id::text
  );

  UPDATE public.lesson_offers
  SET status = CASE WHEN v_matched_count + 1 >= v_capacity THEN 'closed' ELSE status END,
      reserved_coins = 0
  WHERE id = p_lesson_offer_id;

  RETURN jsonb_build_object(
    'success', true, 'application_id', v_application_id,
    'coins_charged', v_charge, 'balance_after', v_new_balance,
    'lesson_fee', v_lesson_fee, 'message', 'レッスンが成立しました'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_lesson_offer(p_performer_id uuid, p_title text, p_description text DEFAULT NULL::text, p_instruments text[] DEFAULT '{}'::text[], p_genres text[] DEFAULT '{}'::text[], p_area text DEFAULT NULL::text, p_lesson_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_lesson_fee integer DEFAULT 0, p_capacity integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_balance integer;
  v_charge bigint;
  v_required bigint;
  v_offer_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_performer_id IS NULL OR p_title IS NULL OR btrim(p_title) = ''
     OR length(p_title) > 120 OR p_lesson_fee IS NULL OR p_lesson_fee < 0
     OR p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', '募集内容、料金、定員の指定が正しくありません');
  END IF;
  IF NOT (p_lesson_date IS NULL AND p_start_time IS NULL AND p_end_time IS NULL)
     AND (p_lesson_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time) THEN
    RETURN jsonb_build_object('success', false, 'error', '日時を設定する場合は日付・開始時間・終了時間が必要です');
  END IF;
  IF p_lesson_date IS NOT NULL
     AND p_lesson_date < (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RETURN jsonb_build_object('success', false, 'error', '過去の日付ではレッスン募集を登録できません');
  END IF;

  SELECT p.user_id INTO v_user_id FROM public.performers p WHERE p.id = p_performer_id;
  IF NOT FOUND OR v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '演奏者プロフィールが見つかりません');
  END IF;

  SELECT u.coin_balance INTO v_balance
  FROM public.users u
  WHERE u.id = v_user_id AND u.account_status = 'active'
  FOR UPDATE;
  IF NOT FOUND OR v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '有効なユーザーのコイン残高を取得できません');
  END IF;

  v_charge := public.configured_lesson_fee(p_lesson_fee)::bigint;
  IF v_charge IS NULL OR v_charge < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'レッスン成立手数料の設定が正しくありません');
  END IF;
  v_required := v_charge * p_capacity;
  IF v_required > 2147483647 THEN
    RETURN jsonb_build_object('success', false, 'error', '必要コイン数が上限を超えています');
  END IF;
  IF v_balance < 0 OR v_balance::bigint < v_required THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('コインが不足しています。定員分の目安は%sコイン、現在の残高は%sコインです。', v_required, GREATEST(v_balance, 0)),
      'required_coins', v_required,
      'available_coins', GREATEST(v_balance, 0)
    );
  END IF;

  INSERT INTO public.lesson_offers (
    performer_id, title, description, instruments, genres, area,
    lesson_date, start_time, end_time, lesson_fee, capacity, status, reserved_coins
  ) VALUES (
    p_performer_id, btrim(p_title), NULLIF(btrim(COALESCE(p_description, '')), ''),
    COALESCE(p_instruments, '{}'), COALESCE(p_genres, '{}'),
    NULLIF(btrim(COALESCE(p_area, '')), ''), p_lesson_date, p_start_time,
    p_end_time, p_lesson_fee, p_capacity, 'open', 0
  ) RETURNING id INTO v_offer_id;

  RETURN jsonb_build_object(
    'success', true, 'offer_id', v_offer_id,
    'required_coins', v_required, 'balance', v_balance,
    'message', 'レッスン募集を登録しました。コインはマッチング成立時に徴収されます'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_lesson_offer_with_levels(p_offer_id uuid, p_performer_id uuid, p_title text, p_description text, p_instruments text[], p_genres text[], p_area text, p_lesson_date date, p_start_time time without time zone, p_end_time time without time zone, p_lesson_fee integer, p_capacity integer, p_target_levels text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_balance integer;
  v_status text;
  v_matched_count integer;
  v_charge bigint;
  v_required bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_offer_id IS NULL OR p_performer_id IS NULL OR p_title IS NULL OR btrim(p_title) = ''
     OR length(p_title) > 120 OR p_lesson_fee IS NULL OR p_lesson_fee < 0
     OR p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 100
     OR p_target_levels IS NULL OR cardinality(p_target_levels) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_target_levels) lv(level) WHERE lv.level NOT IN ('初心者','アマ','プロ')) THEN
    RETURN jsonb_build_object('success', false, 'error', '募集内容、料金、定員、対象ランクの指定が正しくありません');
  END IF;
  IF NOT (p_lesson_date IS NULL AND p_start_time IS NULL AND p_end_time IS NULL)
     AND (p_lesson_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time) THEN
    RETURN jsonb_build_object('success', false, 'error', '日時を設定する場合は日付・開始時間・終了時間が必要です');
  END IF;
  IF p_lesson_date IS NOT NULL
     AND p_lesson_date < (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RETURN jsonb_build_object('success', false, 'error', '過去の日付ではレッスン募集を設定できません');
  END IF;

  SELECT p.user_id, lo.status INTO v_user_id, v_status
  FROM public.lesson_offers lo JOIN public.performers p ON p.id = lo.performer_id
  WHERE lo.id = p_offer_id AND lo.performer_id = p_performer_id
  FOR UPDATE OF lo;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '募集が見つからないか、編集する権限がありません');
  END IF;
  IF v_status <> 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', '募集中のレッスンのみ編集できます');
  END IF;

  SELECT u.coin_balance INTO v_balance FROM public.users u
  WHERE u.id = v_user_id AND u.account_status = 'active' FOR UPDATE;
  IF NOT FOUND OR v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '有効なユーザーのコイン残高を取得できません');
  END IF;

  SELECT COUNT(*)::integer INTO v_matched_count
  FROM public.lesson_applications WHERE lesson_offer_id = p_offer_id AND status = 'matched';
  IF v_matched_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'マッチング成立後は募集条件を編集できません');
  END IF;
  IF p_capacity < v_matched_count THEN
    RETURN jsonb_build_object('success', false, 'error', format('定員は成立済み人数（%s人）以上にしてください', v_matched_count));
  END IF;

  v_charge := public.configured_lesson_fee(p_lesson_fee)::bigint;
  IF v_charge IS NULL OR v_charge < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'レッスン成立手数料の設定が正しくありません');
  END IF;
  v_required := v_charge * (p_capacity - v_matched_count);
  IF v_required > 2147483647 THEN
    RETURN jsonb_build_object('success', false, 'error', '必要コイン数が上限を超えています');
  END IF;
  IF v_balance < 0 OR v_balance::bigint < v_required THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'コインが不足しています。料金や定員を見直してください。',
      'required_coins', v_required, 'available_coins', GREATEST(v_balance, 0)
    );
  END IF;

  UPDATE public.lesson_offers SET
    title = btrim(p_title),
    description = NULLIF(btrim(COALESCE(p_description, '')), ''),
    instruments = COALESCE(p_instruments, '{}'),
    genres = COALESCE(p_genres, '{}'),
    area = NULLIF(btrim(COALESCE(p_area, '')), ''),
    lesson_date = p_lesson_date,
    start_time = p_start_time,
    end_time = p_end_time,
    lesson_fee = p_lesson_fee,
    capacity = p_capacity,
    target_levels = ARRAY(SELECT DISTINCT lv.level FROM unnest(p_target_levels) lv(level) ORDER BY lv.level),
    reserved_coins = 0
  WHERE id = p_offer_id;

  RETURN jsonb_build_object(
    'success', true, 'required_coins', v_required,
    'message', '募集内容を更新しました。コインはマッチング成立時に徴収されます'
  );
END;
$function$;

-- Remove the final legacy dependency on lesson reserved_coins from coin spending.
-- The public spend_coins wrapper continues to call this compatibility routine.
CREATE OR REPLACE FUNCTION public.spend_coins_legacy(p_user_id uuid, p_amount integer, p_transaction_type text, p_description text, p_idempotency_key text, p_request_id uuid DEFAULT NULL::uuid, p_application_id uuid DEFAULT NULL::uuid, p_match_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_balance integer;
  v_new_balance integer;
  v_existing public.coin_transactions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_user_id IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT false, NULL::integer, 'コイン消費の指定が正しくありません'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  SELECT ct.* INTO v_existing
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.amount IS DISTINCT FROM -p_amount
       OR v_existing.transaction_type IS DISTINCT FROM p_transaction_type
       OR v_existing.request_id IS DISTINCT FROM p_request_id THEN
      RETURN QUERY SELECT false, NULL::integer,
        '冪等キーが別の取引です。二重処理を防ぐため中止しました'::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT true, v_existing.balance_after, NULL::text;
    RETURN;
  END IF;

  SELECT u.coin_balance INTO v_current_balance
  FROM public.users u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_balance IS NULL THEN
    RETURN QUERY SELECT false, NULL::integer,
      'ユーザーが見つからないか、残高を取得できません'::text;
    RETURN;
  END IF;

  IF v_current_balance < 0 THEN
    RETURN QUERY SELECT false, v_current_balance,
      'コイン残高がマイナスのため、新しい取引はできません。コインを補充してください'::text;
    RETURN;
  END IF;

  IF v_current_balance < p_amount THEN
    RETURN QUERY SELECT false, v_current_balance,
      'コイン残高が不足しています'::text;
    RETURN;
  END IF;

  v_new_balance := v_current_balance - p_amount;
  UPDATE public.users SET coin_balance = v_new_balance WHERE id = p_user_id;

  INSERT INTO public.coin_transactions (
    user_id, amount, transaction_type, description, balance_after,
    request_id, application_id, match_id, created_by_user_id, idempotency_key
  ) VALUES (
    p_user_id, -p_amount, p_transaction_type, p_description, v_new_balance,
    p_request_id, p_application_id, p_match_id, p_user_id, p_idempotency_key
  );

  RETURN QUERY SELECT true, v_new_balance, NULL::text;
END;
$function$;

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

  -- 仮押さえは行わないため、現在残高のみで送金可否を判定
  IF v_sender_balance < 0
     OR v_sender_balance::bigint < p_amount::bigint
  THEN
    RETURN QUERY
    SELECT
      false, v_sender_balance, v_recipient_balance,
      '送金可能なコインが不足しています'::text;
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

-- Existing reserved_coins were virtual holds, not debits. Clear them so no legacy
-- offer continues to reduce the balance available for transfers or matching.
UPDATE public.lesson_offers SET reserved_coins = 0 WHERE COALESCE(reserved_coins, 0) <> 0;

NOTIFY pgrst, 'reload schema';
COMMIT;
