-- V48.005: lesson fees are charged only when the lesson application becomes matched.
-- Keep lesson fee snapshots separate from performance matches (lesson applications
-- do not create rows in public.matches). Existing reserved_coins values are not cleared
-- here: this migration stops new holds but does not silently mutate legacy balances.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

CREATE TABLE IF NOT EXISTS public.lesson_fee_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_application_id uuid NOT NULL UNIQUE REFERENCES public.lesson_applications(id) ON DELETE RESTRICT,
  lesson_offer_id uuid NOT NULL REFERENCES public.lesson_offers(id) ON DELETE RESTRICT,
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
CREATE INDEX IF NOT EXISTS idx_lesson_fee_snapshots_offer ON public.lesson_fee_snapshots(lesson_offer_id);
ALTER TABLE public.lesson_fee_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lesson_fee_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.lesson_fee_snapshots TO service_role;

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
  v_fee_rate numeric(5,2);
  v_yen_per_coin numeric(12,4);
  v_fee_yen bigint;
  v_tx_id uuid;
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
    UPDATE public.lesson_offers SET status = 'closed' WHERE id = p_lesson_offer_id;
    RETURN jsonb_build_object('success', false, 'error', 'このレッスンは定員に達しています');
  END IF;

  SELECT COALESCE(s.lesson_match_fee_percent, 10),
         COALESCE(s.coin_purchase_yen_per_coin, 10)
  INTO v_fee_rate, v_yen_per_coin
  FROM public.coin_rate_settings s WHERE s.id = 1;
  IF NOT FOUND OR v_fee_rate < 0 OR v_fee_rate > 100 OR v_yen_per_coin <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'レッスン成立手数料の設定が正しくありません');
  END IF;
  v_fee_yen := CEIL(GREATEST(v_lesson_fee, 0)::numeric * v_fee_rate / 100.0)::bigint;
  v_charge := CEIL(v_fee_yen / v_yen_per_coin)::integer;

  SELECT u.coin_balance, u.account_status
  INTO v_balance, v_teacher_status
  FROM public.users u WHERE u.id = v_teacher_user_id FOR UPDATE;
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
  IF v_charge > 0 THEN
    UPDATE public.users SET coin_balance = v_new_balance WHERE id = v_teacher_user_id;
    INSERT INTO public.coin_transactions (
      user_id, amount, transaction_type, description, balance_after,
      created_by_user_id, idempotency_key
    ) VALUES (
      v_teacher_user_id, -v_charge, 'lesson_match_fee', 'レッスン成立手数料',
      v_new_balance, v_teacher_user_id, 'lesson_match_fee:' || v_application_id::text
    ) RETURNING id INTO v_tx_id;
  ELSE
    v_new_balance := v_balance;
  END IF;

  INSERT INTO public.lesson_fee_snapshots (
    lesson_application_id, lesson_offer_id, payer_user_id, base_amount_yen,
    fee_percent, fee_amount_yen, yen_per_coin, fee_amount_coins,
    coin_transaction_id, charged_at
  ) VALUES (
    v_application_id, p_lesson_offer_id, v_teacher_user_id, v_lesson_fee,
    v_fee_rate, v_fee_yen, v_yen_per_coin, v_charge, v_tx_id,
    CASE WHEN v_charge > 0 THEN now() ELSE NULL END
  );

  UPDATE public.lesson_offers
  SET status = CASE WHEN v_matched_count + 1 >= v_capacity THEN 'closed' ELSE status END
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
  v_status text;
  v_matched_count integer;
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

  SELECT COUNT(*)::integer INTO v_matched_count
  FROM public.lesson_applications WHERE lesson_offer_id = p_offer_id AND status = 'matched';
  IF v_matched_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'マッチング成立後は募集条件を編集できません');
  END IF;
  IF p_capacity < v_matched_count THEN
    RETURN jsonb_build_object('success', false, 'error', format('定員は成立済み人数（%s人）以上にしてください', v_matched_count));
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
    target_levels = ARRAY(SELECT DISTINCT lv.level FROM unnest(p_target_levels) lv(level) ORDER BY lv.level)
  WHERE id = p_offer_id;

  RETURN jsonb_build_object('success', true, 'message', '募集内容を更新しました');
END;
$function$;

COMMIT;
