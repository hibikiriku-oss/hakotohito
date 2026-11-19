-- Hakotohito: global mutation gate (candidate; not applied)
-- Source: Tokyo Production pg_get_functiondef export supplied 2026-11-16.
-- All public-table DML is gated by a BEFORE STATEMENT trigger; public mutation
-- RPCs acquire the same xact lock at entry before taking row/advisory locks.
-- One lock serializes all writers. Transaction-scoped; no timeout by design.
BEGIN;

-- Cutover barrier: existing public-table writers must finish before the gate is
-- installed. SHARE ROW EXCLUSIVE permits reads but blocks concurrent DML until
-- this migration commits. Acquire in a stable order to reduce lock-order risk.
DO $cutover_barrier$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      -- Creating a statement trigger on a partitioned parent automatically
      -- creates cloned triggers on its partitions. Skip inherited children so
      -- the loop does not try to drop/recreate those clones independently.
      AND NOT EXISTS (
        SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.oid
      )
    ORDER BY c.oid
  LOOP
    EXECUTE format('LOCK TABLE %I.%I IN SHARE ROW EXCLUSIVE MODE', r.nspname, r.relname);
  END LOOP;
END;
$cutover_barrier$;

DO $preflight$
DECLARE
  v_oid oid;
  v_actual text;
BEGIN
  v_oid := to_regprocedure('public.accept_application_with_coins(uuid,uuid,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.accept_application_with_coins(uuid,uuid,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '1c694d2e19b6d8d7ec2a9a03fd8bc9ae' THEN RAISE EXCEPTION 'Routine definition changed since export: public.accept_application_with_coins(uuid,uuid,uuid)'; END IF;
  v_oid := to_regprocedure('public.accept_direct_invitation_atomic(uuid,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.accept_direct_invitation_atomic(uuid,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '0be091e856f9dd492b6135970e077b2a' THEN RAISE EXCEPTION 'Routine definition changed since export: public.accept_direct_invitation_atomic(uuid,uuid)'; END IF;
  v_oid := to_regprocedure('public.admin_grant_coins(uuid,integer,text,uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.admin_grant_coins(uuid,integer,text,uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '97bdc7e8dc523d38575f2d9455e36f4c' THEN RAISE EXCEPTION 'Routine definition changed since export: public.admin_grant_coins(uuid,integer,text,uuid,text)'; END IF;
  v_oid := to_regprocedure('public.agree_completion_dispute(uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.agree_completion_dispute(uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'b5da724cdfc175335608312f0e2dfa79' THEN RAISE EXCEPTION 'Routine definition changed since export: public.agree_completion_dispute(uuid,text)'; END IF;
  v_oid := to_regprocedure('public.apply_to_lesson_offer(uuid,uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.apply_to_lesson_offer(uuid,uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '38d90c7da704b430a2a8977c2e180bc3' THEN RAISE EXCEPTION 'Routine definition changed since export: public.apply_to_lesson_offer(uuid,uuid,text)'; END IF;
  v_oid := to_regprocedure('public.apply_to_performance_request(uuid,uuid,uuid,text,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.apply_to_performance_request(uuid,uuid,uuid,text,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '880e1202a653e938c12e07b31f77383e' THEN RAISE EXCEPTION 'Routine definition changed since export: public.apply_to_performance_request(uuid,uuid,uuid,text,uuid)'; END IF;
  v_oid := to_regprocedure('public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'dfe70fca226adb6299e98cfc9981fea9' THEN RAISE EXCEPTION 'Routine definition changed since export: public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)'; END IF;
  v_oid := to_regprocedure('public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '225b141420bb91339a3a87da1ee98a28' THEN RAISE EXCEPTION 'Routine definition changed since export: public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)'; END IF;
  v_oid := to_regprocedure('public.cancel_match_with_direct_invite_refund(uuid,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.cancel_match_with_direct_invite_refund(uuid,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '3eb719fb883549c85ccd2701f380e4f6' THEN RAISE EXCEPTION 'Routine definition changed since export: public.cancel_match_with_direct_invite_refund(uuid,uuid)'; END IF;
  v_oid := to_regprocedure('public.complete_match_with_fee(uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.complete_match_with_fee(uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'b4dd7278e76f607d9c402eff9db2bdf3' THEN RAISE EXCEPTION 'Routine definition changed since export: public.complete_match_with_fee(uuid,text)'; END IF;
  v_oid := to_regprocedure('public.complete_stripe_coin_purchase(uuid,text,text,integer,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.complete_stripe_coin_purchase(uuid,text,text,integer,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '2d79316b27cf713f69147404980250ac' THEN RAISE EXCEPTION 'Routine definition changed since export: public.complete_stripe_coin_purchase(uuid,text,text,integer,text)'; END IF;
  v_oid := to_regprocedure('public.create_band_with_leader(uuid,text,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.create_band_with_leader(uuid,text,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'a0422cdb98c071ebc5b0cd2ba4de0bff' THEN RAISE EXCEPTION 'Routine definition changed since export: public.create_band_with_leader(uuid,text,text)'; END IF;
  v_oid := to_regprocedure('public.create_facility_invitation_with_coins(uuid,uuid,uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.create_facility_invitation_with_coins(uuid,uuid,uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'ee2eeb5ad357835115ae7c46a44b1cd3' THEN RAISE EXCEPTION 'Routine definition changed since export: public.create_facility_invitation_with_coins(uuid,uuid,uuid,text)'; END IF;
  v_oid := to_regprocedure('public.create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '5f19d783d3f2d1678090799dbab84b9a' THEN RAISE EXCEPTION 'Routine definition changed since export: public.create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)'; END IF;
  v_oid := to_regprocedure('public.create_lesson_offer_with_levels(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.create_lesson_offer_with_levels(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'cac5ac186e12c0e6193ebe137d80a847' THEN RAISE EXCEPTION 'Routine definition changed since export: public.create_lesson_offer_with_levels(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])'; END IF;
  v_oid := to_regprocedure('public.create_lesson_offer_with_levels_and_address(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[],text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.create_lesson_offer_with_levels_and_address(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[],text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'f068e7bd1974cc2685e5f7a76aa635ec' THEN RAISE EXCEPTION 'Routine definition changed since export: public.create_lesson_offer_with_levels_and_address(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[],text)'; END IF;
  v_oid := to_regprocedure('public.create_review_with_reward(uuid,uuid,uuid,integer,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.create_review_with_reward(uuid,uuid,uuid,integer,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '57d8b314023cb92ddd7d5e210ff82b6e' THEN RAISE EXCEPTION 'Routine definition changed since export: public.create_review_with_reward(uuid,uuid,uuid,integer,text)'; END IF;
  v_oid := to_regprocedure('public.disband_band(uuid,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.disband_band(uuid,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'e7f93e418cfc0e184f32fb64a2a829c1' THEN RAISE EXCEPTION 'Routine definition changed since export: public.disband_band(uuid,uuid)'; END IF;
  v_oid := to_regprocedure('public.manage_completion_dispute_case(uuid,text,text,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.manage_completion_dispute_case(uuid,text,text,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'b7d0f2f7d3986e9d59ee979e3b56e336' THEN RAISE EXCEPTION 'Routine definition changed since export: public.manage_completion_dispute_case(uuid,text,text,text)'; END IF;
  v_oid := to_regprocedure('public.manage_stripe_payment_incident(uuid,text,text,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.manage_stripe_payment_incident(uuid,text,text,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '02ab2560c65add7e94f94d802d0b3d62' THEN RAISE EXCEPTION 'Routine definition changed since export: public.manage_stripe_payment_incident(uuid,text,text,text)'; END IF;
  v_oid := to_regprocedure('public.register_completion_dispute(uuid,text,text,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.register_completion_dispute(uuid,text,text,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '1324b3c499e615bfae55d2cf67e49340' THEN RAISE EXCEPTION 'Routine definition changed since export: public.register_completion_dispute(uuid,text,text,uuid)'; END IF;
  v_oid := to_regprocedure('public.reject_direct_invitation_with_refund(uuid,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.reject_direct_invitation_with_refund(uuid,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '8bbdb41a664bd115691e8b40907798df' THEN RAISE EXCEPTION 'Routine definition changed since export: public.reject_direct_invitation_with_refund(uuid,uuid)'; END IF;
  v_oid := to_regprocedure('public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'c6ef021b0ed08df0a25da1840e1097c4' THEN RAISE EXCEPTION 'Routine definition changed since export: public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)'; END IF;
  v_oid := to_regprocedure('public.respond_to_band_invitation(uuid,uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.respond_to_band_invitation(uuid,uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '78f1b6ab7bbf9f75607df8bfa0fbf9cd' THEN RAISE EXCEPTION 'Routine definition changed since export: public.respond_to_band_invitation(uuid,uuid,text)'; END IF;
  v_oid := to_regprocedure('public.spend_coins(uuid,integer,text,text,text,uuid,uuid,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.spend_coins(uuid,integer,text,text,text,uuid,uuid,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '4e55cceebfc8c98417f34ee34f797611' THEN RAISE EXCEPTION 'Routine definition changed since export: public.spend_coins(uuid,integer,text,text,text,uuid,uuid,uuid)'; END IF;
  v_oid := to_regprocedure('public.spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '4b2e70a03509944bc940d841e9e1f30d' THEN RAISE EXCEPTION 'Routine definition changed since export: public.spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)'; END IF;
  v_oid := to_regprocedure('public.submit_band_application_idempotent(uuid,uuid,uuid,uuid,uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.submit_band_application_idempotent(uuid,uuid,uuid,uuid,uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'dcd3b727a6c66aee0342abada71af4fb' THEN RAISE EXCEPTION 'Routine definition changed since export: public.submit_band_application_idempotent(uuid,uuid,uuid,uuid,uuid,text)'; END IF;
  v_oid := to_regprocedure('public.submit_personal_application_idempotent(uuid,uuid,uuid,uuid,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.submit_personal_application_idempotent(uuid,uuid,uuid,uuid,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> 'b7e170df14888f7fb4cbdcefaebb8b0b' THEN RAISE EXCEPTION 'Routine definition changed since export: public.submit_personal_application_idempotent(uuid,uuid,uuid,uuid,text)'; END IF;
  v_oid := to_regprocedure('public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '23665ccb99c7effdd5db3732b25b639b' THEN RAISE EXCEPTION 'Routine definition changed since export: public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)'; END IF;
  v_oid := to_regprocedure('public.update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '1c5b75b76d0c9b1f02976f18aab7ad65' THEN RAISE EXCEPTION 'Routine definition changed since export: public.update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])'; END IF;
  v_oid := to_regprocedure('public.withdraw_user_account(text)');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'Required routine missing: public.withdraw_user_account(text)'; END IF;
  v_actual := md5(replace(pg_get_functiondef(v_oid), E'\r\n', E'\n')); 
  IF v_actual <> '5008d08f0509ab41c9648d25dafb0dc8' THEN RAISE EXCEPTION 'Routine definition changed since export: public.withdraw_user_account(text)'; END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.acquire_global_mutation_gate_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  RETURN NULL;
END;
$function$;

ALTER FUNCTION public.acquire_global_mutation_gate_trigger() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acquire_global_mutation_gate_trigger() FROM PUBLIC;

DO $triggers$
DECLARE
  r record;
  v_trigger_count integer := 0;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.oid
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_global_mutation_gate ON %I.%I', r.nspname, r.relname);
    EXECUTE format(
      'CREATE TRIGGER trg_global_mutation_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_global_mutation_gate_trigger()',
      r.nspname, r.relname
    );
    v_trigger_count := v_trigger_count + 1;
  END LOOP;
  IF v_trigger_count = 0 THEN RAISE EXCEPTION 'No public tables found; refusing partial gate installation'; END IF;
END;
$triggers$;

-- Gate: public.accept_application_with_coins(uuid,uuid,uuid)
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

  v_invite record;
  v_original_fee record;
  v_refund_key text;
  v_refund_amount integer;
  v_refund_balance integer;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
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
    a.band_id
  INTO
    v_application_performer_id,
    v_application_status,
    v_application_band_id
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

  UPDATE public.applications
  SET status = 'accepted'
  WHERE id = p_application_id;

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
        100,
        'match_fee',
        'イベント・レンタル初回マッチング成立手数料',
        'event_match_fee:' || p_request_id::text,
        p_request_id,
        p_application_id,
        v_match_id
      );

      IF NOT COALESCE(v_coin_result.success, false) THEN
        RAISE EXCEPTION '%',
          COALESCE(
            v_coin_result.error_message,
            '施設側のコインが不足しています'
          );
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
      'match_fee:' || p_request_id::text ||
      ':' || p_application_id::text;

    SELECT *
    INTO v_coin_result
    FROM public.spend_coins(
      p_facility_user_id,
      100,
      'match_fee',
      'マッチング成立手数料',
      v_idempotency_key,
      p_request_id,
      p_application_id,
      v_match_id
    );

    IF NOT COALESCE(v_coin_result.success, false) THEN
      RAISE EXCEPTION '%',
        COALESCE(
          v_coin_result.error_message,
          '施設側のコインが不足しています'
        );
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

-- Gate: public.accept_direct_invitation_atomic(uuid,uuid)
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
  v_active_count integer;
  v_coin_result record;
  v_idempotency_key text;
  v_event boolean;
  v_first_event_match boolean;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
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
    SELECT COUNT(*)::integer
    INTO v_active_count
    FROM public.matches m
    WHERE m.request_id = v_request_id
      AND m.status = 'active'
      AND m.performance_status <> 'cancelled';

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

  UPDATE public.applications
  SET status = 'accepted'
  WHERE id = p_application_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION
      '承諾した依頼の状態を更新できませんでした';
  END IF;

  IF v_event THEN
    -- イベントは定員到達時のみ募集を終了
    SELECT COUNT(*)::integer
    INTO v_active_count
    FROM public.matches m
    WHERE m.request_id = v_request_id
      AND m.status = 'active'
      AND m.performance_status <> 'cancelled';

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
        100,
        'match_fee',
        'イベント・レンタル初回マッチング成立手数料',
        v_idempotency_key,
        v_request_id,
        p_application_id,
        v_match_id
      );

      IF NOT COALESCE(v_coin_result.success, false) THEN
        RAISE EXCEPTION '%',
          COALESCE(
            v_coin_result.error_message,
            '施設側のコインが不足しています'
          );
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
      'match_fee:' || v_request_id::text ||
      ':' || p_application_id::text;

    SELECT *
    INTO v_coin_result
    FROM public.spend_coins(
      v_facility_user_id,
      100,
      'match_fee',
      'マッチング成立手数料',
      v_idempotency_key,
      v_request_id,
      p_application_id,
      v_match_id
    );

    IF NOT COALESCE(v_coin_result.success, false) THEN
      RAISE EXCEPTION '%',
        COALESCE(
          v_coin_result.error_message,
          '施設側のコインが不足しています'
        );
    END IF;

    -- 施設負担の謝礼1%は演奏完了時に徴収する。
  END IF;

  RETURN QUERY SELECT
    true,
    v_match_id,
    NULL::text;
END;
$function$;

-- Gate: public.admin_grant_coins(uuid,integer,text,uuid,text)
CREATE OR REPLACE FUNCTION public.admin_grant_coins(p_user_id uuid, p_amount integer, p_description text, p_created_by_user_id uuid, p_idempotency_key text)
 RETURNS TABLE(success boolean, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_balance integer;
  v_new_balance bigint;
  v_existing public.coin_transactions%ROWTYPE;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 入力値の検証
  IF p_user_id IS NULL
     OR p_amount IS NULL
     OR p_amount <= 0
     OR p_description IS NULL
     OR btrim(p_description) = ''
     OR p_created_by_user_id IS NULL
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT
      false, NULL::integer,
      '付与内容が正しくありません'::text;
    RETURN;
  END IF;

  -- 二重実行を防ぐためのロック
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_idempotency_key, 0)
  );

  -- 同じキーの取引がすでに存在する場合
  SELECT ct.*
  INTO v_existing
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.transaction_type IS DISTINCT FROM 'admin_adjustment'
       OR v_existing.description IS DISTINCT FROM p_description
       OR v_existing.created_by_user_id
            IS DISTINCT FROM p_created_by_user_id THEN
      RETURN QUERY SELECT
        false, NULL::integer,
        '冪等キーが別の取引に使用されています'::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      true, v_existing.balance_after, NULL::text;
    RETURN;
  END IF;

  -- 付与先ユーザーをロックして残高を取得
  SELECT u.coin_balance
  INTO v_current_balance
  FROM public.users u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_balance IS NULL THEN
    RETURN QUERY SELECT
      false, NULL::integer,
      '付与先ユーザーが見つからないか、残高がありません'::text;
    RETURN;
  END IF;

  -- 管理者のユーザーレコードを確認
  PERFORM 1
  FROM public.users u
  WHERE u.id = p_created_by_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, v_current_balance,
      '管理者ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  -- integer の上限を超えないか確認
  v_new_balance := v_current_balance::bigint + p_amount::bigint;

  IF v_new_balance > 2147483647 THEN
    RETURN QUERY SELECT
      false, v_current_balance,
      '付与後の残高が上限を超えます'::text;
    RETURN;
  END IF;

  -- 残高を更新
  UPDATE public.users
  SET coin_balance = v_new_balance::integer
  WHERE id = p_user_id;

  -- 付与履歴を記録
  INSERT INTO public.coin_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    balance_after,
    created_by_user_id,
    idempotency_key
  )
  VALUES (
    p_user_id,
    p_amount,
    'admin_adjustment',
    p_description,
    v_new_balance::integer,
    p_created_by_user_id,
    p_idempotency_key
  );

  RETURN QUERY SELECT
    true, v_new_balance::integer, NULL::text;
END;
$function$;

-- Gate: public.agree_completion_dispute(uuid,text)
CREATE OR REPLACE FUNCTION public.agree_completion_dispute(p_match_id uuid, p_side text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  m public.matches%ROWTYPE;
  v_case_id uuid;
  agreed_at timestamptz := now();
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_side NOT IN ('facility', 'performer') THEN
    RAISE EXCEPTION 'invalid_side';
  END IF;

  -- 同じマッチングへの同意処理を直列化
  SELECT *
    INTO m
    FROM public.matches
   WHERE id = p_match_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  IF m.status <> 'active'
     OR m.performance_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'match_not_active';
  END IF;

  IF m.completion_disputed_at IS NULL THEN
    RAISE EXCEPTION 'no_active_dispute';
  END IF;

  -- 同意日時を記録。再送時は既存日時を維持
  UPDATE public.matches
     SET completion_dispute_facility_agreed_at =
           CASE
             WHEN p_side = 'facility'
             THEN COALESCE(completion_dispute_facility_agreed_at, agreed_at)
             ELSE completion_dispute_facility_agreed_at
           END,
         completion_dispute_performer_agreed_at =
           CASE
             WHEN p_side = 'performer'
             THEN COALESCE(completion_dispute_performer_agreed_at, agreed_at)
             ELSE completion_dispute_performer_agreed_at
           END
   WHERE id = p_match_id
   RETURNING * INTO m;

  -- 双方の同意がそろった場合
  IF m.completion_dispute_facility_agreed_at IS NOT NULL
     AND m.completion_dispute_performer_agreed_at IS NOT NULL THEN

    -- 従来の双方合意履歴を保存
    INSERT INTO public.completion_dispute_history (
      match_id,
      completion_disputed_at,
      completion_disputed_by,
      completion_dispute_reason,
      facility_agreed_at,
      performer_agreed_at,
      resolved_at
    )
    VALUES (
      m.id,
      m.completion_disputed_at,
      COALESCE(m.completion_disputed_by, 'unknown'),
      COALESCE(m.completion_dispute_reason, '理由の記録はありません'),
      m.completion_dispute_facility_agreed_at,
      m.completion_dispute_performer_agreed_at,
      agreed_at
    );

    -- 管理者対応案件も双方合意で解決済みにする
    UPDATE public.completion_dispute_admin_cases
       SET status = 'resolved',
           resolution_source = 'bilateral_agreement',
           resolved_at = agreed_at,
           resolved_by_line_user_id = NULL,
           resolution_note = '双方の合意により解決しました。',
           updated_at = agreed_at
     WHERE match_id = p_match_id
       AND status = 'in_progress'
    RETURNING id INTO v_case_id;

    -- 対応履歴にシステムによる解決を記録
    IF v_case_id IS NOT NULL THEN
      INSERT INTO public.completion_dispute_admin_actions (
        case_id,
        admin_line_user_id,
        action_type,
        note
      )
      VALUES (
        v_case_id,
        'system',
        'resolved',
        '双方の合意により異議申し立てが解決されました。'
      );
    END IF;

    -- matchesの異議申し立て情報を解除
    UPDATE public.matches
       SET completion_disputed_at = NULL,
           completion_disputed_by = NULL,
           completion_dispute_reason = NULL,
           completion_dispute_facility_agreed_at = NULL,
           completion_dispute_performer_agreed_at = NULL
     WHERE id = p_match_id;

    RETURN jsonb_build_object(
      'success', true,
      'resolved', true,
      'message', '双方の合意により異議申し立てを解除しました'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'resolved', false,
    'message', '同意を記録しました。相手側の同意を待っています'
  );
END;
$function$;

-- Gate: public.apply_to_lesson_offer(uuid,uuid,text)
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
  v_reserved_coins integer;
  v_matched_count integer;
  v_remaining_slots integer;
  v_application_id uuid;
  v_balance integer;
  v_new_balance integer;
  v_charge integer;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  SELECT
    lo.performer_id,
    p.user_id,
    lo.lesson_fee,
    lo.capacity,
    lo.status,
    lo.reserved_coins
  INTO
    v_teacher_performer_id,
    v_teacher_user_id,
    v_lesson_fee,
    v_capacity,
    v_offer_status,
    v_reserved_coins
  FROM public.lesson_offers AS lo
  JOIN public.performers AS p ON p.id = lo.performer_id
  WHERE lo.id = p_lesson_offer_id
  FOR UPDATE OF lo;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'レッスン募集が見つかりません'
    );
  END IF;

  IF v_offer_status <> 'open' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'このレッスンは募集を終了しています'
    );
  END IF;

  IF p_applicant_performer_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.performers
       WHERE id = p_applicant_performer_id
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '応募する演奏者が見つかりません'
    );
  END IF;

  IF p_applicant_performer_id = v_teacher_performer_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '自分自身のレッスンには応募できません'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lesson_applications
    WHERE lesson_offer_id = p_lesson_offer_id
      AND applicant_performer_id = p_applicant_performer_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'このレッスンにはすでに応募しています'
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_matched_count
  FROM public.lesson_applications
  WHERE lesson_offer_id = p_lesson_offer_id
    AND status = 'matched';

  IF v_matched_count >= v_capacity THEN
    UPDATE public.lesson_offers
    SET status = 'closed',
        reserved_coins = 0
    WHERE id = p_lesson_offer_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'このレッスンは定員に達しています'
    );
  END IF;

  v_remaining_slots := v_capacity - v_matched_count;

  -- レート変更前に作成した募集でも、予約時の料金を維持する
  IF v_remaining_slots <= 0
     OR COALESCE(v_reserved_coins, 0) <= 0
     OR MOD(v_reserved_coins, v_remaining_slots) <> 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'この募集の仮押さえコイン額を確認できません。募集を編集して設定を更新してください'
    );
  END IF;

  v_charge := v_reserved_coins / v_remaining_slots;

  SELECT u.coin_balance
  INTO v_balance
  FROM public.users AS u
  WHERE u.id = v_teacher_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '講師のコイン残高を取得できません'
    );
  END IF;

  IF v_balance < 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '講師のコイン残高がマイナスのため、新しいレッスンは成立できません。コインを補充してください'
    );
  END IF;

  IF v_balance < v_charge THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '講師のコイン残高が不足しているため成立できません'
    );
  END IF;

  INSERT INTO public.lesson_applications (
    lesson_offer_id,
    applicant_performer_id,
    message,
    status,
    matched_at
  )
  VALUES (
    p_lesson_offer_id,
    p_applicant_performer_id,
    p_message,
    'matched',
    now()
  )
  RETURNING id INTO v_application_id;

  v_new_balance := v_balance - v_charge;

  UPDATE public.users
  SET coin_balance = v_new_balance
  WHERE id = v_teacher_user_id;

  INSERT INTO public.coin_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    balance_after,
    created_by_user_id,
    idempotency_key
  )
  VALUES (
    v_teacher_user_id,
    -v_charge,
    'lesson_match_fee',
    'レッスン成立手数料',
    v_new_balance,
    v_teacher_user_id,
    'lesson_match_fee:' || v_application_id::text
  );

  IF v_matched_count + 1 >= v_capacity THEN
    UPDATE public.lesson_offers
    SET status = 'closed',
        reserved_coins = 0
    WHERE id = p_lesson_offer_id;
  ELSE
    UPDATE public.lesson_offers
    SET reserved_coins = reserved_coins - v_charge
    WHERE id = p_lesson_offer_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'application_id', v_application_id,
    'coins_charged', v_charge,
    'balance_after', v_new_balance,
    'lesson_fee', v_lesson_fee,
    'message', 'レッスンが成立しました'
  );
END;
$function$;

-- Gate: public.apply_to_performance_request(uuid,uuid,uuid,text,uuid)
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
  v_spend_success boolean;
  v_spend_error text;
  v_error_message text;
  v_is_reapply boolean := false;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

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

  -- 応募登録・コイン消費を同一トランザクション内で実行
  BEGIN
    IF v_is_reapply THEN
      UPDATE public.applications
      SET
        message = NULLIF(p_message, ''),
        status = 'pending',
        source = 'performer_apply'
      WHERE id = v_existing_id
      RETURNING id INTO v_application_id;
    ELSE
      INSERT INTO public.applications (
        request_id,
        performer_id,
        message,
        status,
        source,
        band_id
      )
      VALUES (
        p_request_id,
        p_performer_id,
        NULLIF(p_message, ''),
        'pending',
        'performer_apply',
        NULL
      )
      RETURNING id INTO v_application_id;
    END IF;

    -- 既存の手数料設定・残高管理・履歴記録を利用
    SELECT
      sc.success,
      sc.balance_after,
      sc.error_message
    INTO
      v_spend_success,
      v_balance_after,
      v_spend_error
    FROM public.spend_coins(
      p_user_id,
      10,
      'application_fee',
      '演奏案件への応募手数料',
      'application_fee:' || v_application_id::text
        || ':' || p_attempt_id::text,
      p_request_id,
      v_application_id,
      NULL
    ) AS sc;

    IF NOT COALESCE(v_spend_success, false) THEN
      RAISE EXCEPTION '%',
        COALESCE(v_spend_error, '応募コインの処理に失敗しました');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_error_message = MESSAGE_TEXT;

    RETURN QUERY SELECT
      false,
      NULL::uuid,
      NULL::integer,
      v_error_message,
      v_is_reapply;
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

-- Gate: public.apply_to_performance_request_as_band(uuid,uuid,uuid,uuid,text)
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
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

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
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::uuid, NULL::integer, 0,
      'ユーザー情報が見つかりません'::text;
    RETURN;
  END IF;

  -- 既存応募の状態確認
  IF v_application.id IS NOT NULL THEN
    IF v_application.status = 'accepted' THEN
      RETURN QUERY SELECT
        false, v_application.id, v_balance, 0,
        'このバンドはすでにこの案件に採用されています'::text;
      RETURN;
    END IF;

    IF v_application.status = 'pending' THEN
      -- すでに手数料が記録されている応募は重複として拒否する
      SELECT *
      INTO v_existing_transaction
      FROM public.coin_transactions ct
      WHERE ct.application_id = v_application.id
        AND ct.transaction_type = 'application_fee'
      ORDER BY ct.created_at DESC
      LIMIT 1;

      IF FOUND THEN
        RETURN QUERY SELECT
          false,
          v_application.id,
          v_balance,
          0,
          'このバンドはすでにこの案件に応募しています'::text;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- 新規応募または却下済み応募の再応募
  BEGIN
    IF v_application.id IS NOT NULL THEN
      UPDATE public.applications
      SET
        performer_id = p_performer_id,
        message = NULLIF(btrim(COALESCE(p_message, '')), ''),
        status = 'pending',
        source = 'band_apply'
      WHERE id = v_application.id
      RETURNING * INTO v_application;
    ELSE
      INSERT INTO public.applications (
        request_id,
        performer_id,
        band_id,
        message,
        status,
        source
      )
      VALUES (
        p_request_id,
        p_performer_id,
        p_band_id,
        NULLIF(btrim(COALESCE(p_message, '')), ''),
        'pending',
        'band_apply'
      )
      RETURNING * INTO v_application;
    END IF;

    -- この応募に対する過去の手数料取引数を数える
    SELECT count(*)::integer
    INTO v_attempt_count
    FROM public.coin_transactions ct
    WHERE ct.application_id = v_application.id
      AND ct.transaction_type = 'application_fee';

    -- 再応募ごとに異なる処理キーを発行
    v_idempotency_key :=
      'band_application_fee:'
      || v_application.id::text
      || ':'
      || (v_attempt_count + 1)::text;

    -- 既存のコイン消費関数を利用
    SELECT
      s.success,
      s.balance_after,
      s.error_message
    INTO
      v_spend_success,
      v_spend_balance,
      v_spend_error
    FROM public.spend_coins(
      p_user_id,
      v_required_coins,
      'application_fee',
      'バンド「' || v_band.name || '」の演奏案件応募手数料',
      v_idempotency_key,
      p_request_id,
      v_application.id,
      NULL
    ) s;

    IF NOT COALESCE(v_spend_success, false) THEN
      v_error_message := COALESCE(
        v_spend_error,
        '応募コインの処理に失敗しました'
      );

      RAISE EXCEPTION 'BAND_APPLICATION_FEE_FAILED';
    END IF;

    -- コイン履歴にバンドIDを記録
    UPDATE public.coin_transactions
    SET band_id = p_band_id
    WHERE idempotency_key = v_idempotency_key;

    RETURN QUERY SELECT
      true,
      v_application.id,
      v_spend_balance,
      v_required_coins,
      NULL::text;

    RETURN;

  EXCEPTION
    WHEN unique_violation THEN
      RETURN QUERY SELECT
        false, NULL::uuid, NULL::integer, 0,
        'このバンドはすでにこの案件に応募しています'::text;
      RETURN;

    WHEN OTHERS THEN
      RETURN QUERY SELECT
        false,
        NULL::uuid,
        NULL::integer,
        0,
        COALESCE(
          v_error_message,
          '応募登録またはコイン処理に失敗しました'
        );
      RETURN;
  END;
END;
$function$;

-- Gate: public.cancel_event_request_with_refund_internal(uuid,uuid,boolean)
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
  v_initial_refund_amount integer := 0;
  v_initial_fee_amount integer := 0;
  v_pending_direct_refund integer := 0;
  v_cancelled_count integer := 0;
  v_has_initial_fee boolean := false;
  v_has_completed_match boolean := false;

  -- 未承認の直接依頼の通知情報
  v_pending_direct_notifications jsonb := '[]'::jsonb;
  v_pending_direct_line_user_id text;
  v_pending_direct_performer_name text;
  v_facility_name text;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
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
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_fee_refund_key
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
        v_direct_refund_key :=
          'direct_invite_refund:' || v_application.id::text;

        PERFORM pg_advisory_xact_lock(
          hashtextextended(v_direct_refund_key, 0)
        );

        v_direct_fee_amount := 0;

        IF NOT EXISTS (
          SELECT 1
          FROM public.coin_transactions ct
          WHERE ct.idempotency_key = v_direct_refund_key
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
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_direct_refund_key
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

        -- 実際に返金した場合だけ通知対象に追加
        IF v_pending_direct_line_user_id IS NOT NULL THEN
          v_pending_direct_notifications :=
            v_pending_direct_notifications ||
            jsonb_build_array(
              jsonb_build_object(
                'lineUserId', v_pending_direct_line_user_id,
                'applicationId', v_application.id,
                'requestId', p_request_id,
                'requestTitle', v_request.title,
                'facilityName', v_facility_name,
                'performerName', v_pending_direct_performer_name,
                'refundAmount', v_direct_fee_amount
              )
            );
        END IF;
      END IF;
    END IF;

    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_application.id
      AND status = 'pending';
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
         FROM public.coin_transactions ct
         WHERE ct.idempotency_key = v_initial_refund_key
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

  -- 8. 残った未処理応募を却下
  UPDATE public.applications
  SET status = 'rejected'
  WHERE request_id = p_request_id
    AND status = 'pending';

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

-- Gate: public.cancel_match_with_direct_invite_refund(uuid,uuid)
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
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
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
    v_direct_refund_key :=
      'direct_invite_refund:' || v_application.id::text;

    -- 元の直接依頼手数料を厳密に特定
    SELECT -ct.amount
    INTO v_direct_fee_refund_amount
    FROM public.coin_transactions ct
    WHERE ct.application_id = v_application.id
      AND ct.request_id = v_request_id
      AND ct.user_id = v_facility_user_id
      AND ct.transaction_type = 'direct_invite_fee'
      AND ct.amount < 0
      AND ct.idempotency_key =
        'direct_invite_fee:'
        || v_request_id::text
        || ':'
        || v_application.performer_id::text
    ORDER BY ct.created_at
    LIMIT 1;

    v_has_direct_fee :=
      COALESCE(v_direct_fee_refund_amount, 0) > 0;
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
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_direct_refund_key
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
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_match_refund_key
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
      FROM public.coin_transactions ct
      WHERE ct.idempotency_key = v_fee_refund_key
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

  -- 10. マッチングをキャンセル
  UPDATE public.matches
  SET status = 'cancelled',
      performance_status = 'cancelled'
  WHERE id = v_match.id;

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

-- Gate: public.complete_match_with_fee(uuid,text)
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
    SELECT a.id, a.source
    INTO v_application_id, v_application_source
    FROM public.applications a
    WHERE a.id = v_match.application_id
      AND a.request_id = v_match.request_id
      AND a.status = 'accepted';

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

-- Gate: public.complete_stripe_coin_purchase(uuid,text,text,integer,text)
CREATE OR REPLACE FUNCTION public.complete_stripe_coin_purchase(p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text, p_paid_amount integer, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_balance integer;
  v_new_balance bigint;
  v_account_status text;
  v_existing_order_id uuid;
  v_idempotency_key text;
  v_has_incident boolean := false;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_order_id IS NULL
     OR NULLIF(p_checkout_session_id, '') IS NULL
     OR NULLIF(p_payment_intent_id, '') IS NULL
     OR p_paid_amount IS NULL OR p_paid_amount <= 0
     OR lower(COALESCE(p_currency, '')) <> 'jpy' THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が不正です');
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.payment_type <> 'coin_purchase' THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '購入注文が見つかりません');
  END IF;

  IF v_order.status IN ('paid','paid_review') THEN
    IF v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
       OR v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
       OR v_order.amount_jpy IS DISTINCT FROM p_paid_amount
       OR v_order.currency IS DISTINCT FROM lower(p_currency) THEN
      RETURN jsonb_build_object('success', false, 'errorMessage', '処理済み注文の決済情報が一致しません');
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'alreadyProcessed', true,
      'reviewRequired', (v_order.status = 'paid_review'),
      'status', v_order.status
    );
  END IF;

  IF v_order.status <> 'pending'
     OR (v_order.stripe_payment_intent_id IS NOT NULL AND v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id)
     OR v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
     OR v_order.amount_jpy IS DISTINCT FROM p_paid_amount
     OR v_order.currency IS DISTINCT FROM lower(p_currency)
     OR v_order.coin_amount::bigint * v_order.coin_rate_yen::bigint <> v_order.amount_jpy::bigint THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済情報が注文内容と一致しません');
  END IF;

  SELECT id INTO v_existing_order_id
  FROM public.payment_orders
  WHERE stripe_payment_intent_id = p_payment_intent_id
    AND id <> v_order.id;
  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'Payment Intentは別注文で使用済みです');
  END IF;

  -- Serialize fulfillment against account-status changes that update this row.
  SELECT COALESCE(coin_balance, 0), account_status
  INTO v_balance, v_account_status
  FROM public.users
  WHERE id = v_order.payer_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '購入ユーザーが見つかりません');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stripe_payment_incidents
    WHERE payment_order_id = v_order.id
  ) INTO v_has_incident;

  IF v_account_status IS DISTINCT FROM 'active' OR v_has_incident THEN
    UPDATE public.payment_orders
    SET status = 'paid_review',
        stripe_payment_intent_id = p_payment_intent_id,
        paid_at = now(),
        updated_at = now()
    WHERE id = v_order.id;

    IF v_account_status IS DISTINCT FROM 'active' THEN
      INSERT INTO public.stripe_payment_incidents (
        payment_order_id, incident_type, stripe_payment_intent_id,
        amount_jpy, currency, details
      ) VALUES (
        v_order.id, 'paid_after_account_withdrawal', p_payment_intent_id,
        v_order.amount_jpy, 'jpy',
        jsonb_build_object('account_status_at_fulfillment', v_account_status)
      )
      ON CONFLICT (payment_order_id, incident_type) DO NOTHING;
    END IF;

    UPDATE public.stripe_payment_incidents
    SET stripe_payment_intent_id = p_payment_intent_id
    WHERE payment_order_id = v_order.id
      AND stripe_payment_intent_id IS NULL;

    RETURN jsonb_build_object(
      'success', true,
      'alreadyProcessed', false,
      'reviewRequired', true,
      'reviewReason', CASE WHEN v_has_incident THEN 'payment_incident' ELSE 'account_withdrawn' END,
      'status', 'paid_review',
      'coinAmount', 0
    );
  END IF;

  v_new_balance := v_balance::bigint + v_order.coin_amount::bigint;
  IF v_new_balance > 2147483647 THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', 'コイン残高の上限を超えるため管理者確認が必要です');
  END IF;

  v_idempotency_key := 'stripe_purchase:' || v_order.id::text;

  UPDATE public.users
  SET coin_balance = v_new_balance::integer
  WHERE id = v_order.payer_user_id;

  INSERT INTO public.coin_transactions (
    user_id, amount, transaction_type, description, balance_after,
    created_by_user_id, idempotency_key
  ) VALUES (
    v_order.payer_user_id,
    v_order.coin_amount,
    'purchase_credit',
    'Stripeコイン購入（' || v_order.amount_jpy::text || '円）',
    v_new_balance::integer,
    v_order.payer_user_id,
    v_idempotency_key
  );

  UPDATE public.payment_orders
  SET status = 'paid',
      stripe_payment_intent_id = p_payment_intent_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'success', true,
    'alreadyProcessed', false,
    'reviewRequired', false,
    'status', 'paid',
    'coinAmount', v_order.coin_amount,
    'balanceAfter', v_new_balance::integer
  );
END;
$function$;

-- Gate: public.create_band_with_leader(uuid,text,text)
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

  -- 指定された演奏者プロフィールが存在することを確認
  PERFORM 1
  FROM public.performers
  WHERE id = p_performer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '演奏者プロフィールが見つかりません';
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

-- Gate: public.create_facility_invitation_with_coins(uuid,uuid,uuid,text)
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
  v_request_status text;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

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

  -- 4. 同じ案件・演奏者への重複依頼を確認
  IF EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.request_id = p_request_id
      AND a.performer_id = p_performer_id
  ) THEN
    RETURN QUERY
    SELECT
      false,
      NULL::uuid,
      NULL::integer,
      'この演奏者にはすでに応募または依頼済みです'::text;
    RETURN;
  END IF;

  -- 5. 既存の冪等性キーを維持
  v_idempotency_key :=
    'direct_invite_fee:'
    || p_request_id::text
    || ':'
    || p_performer_id::text;

  -- 6. 直接オファーを登録
  BEGIN
    INSERT INTO public.applications (
      request_id,
      performer_id,
      message,
      status,
      source
    )
    VALUES (
      p_request_id,
      p_performer_id,
      NULLIF(p_message, ''),
      'pending',
      'facility_invite'
    )
    RETURNING id INTO v_application_id;

  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY
    SELECT
      false,
      NULL::uuid,
      NULL::integer,
      'この演奏者にはすでに応募または依頼済みです'::text;
    RETURN;
  END;

  -- 7. 既存のコイン消費処理を利用
  SELECT *
    INTO v_coin_result
  FROM public.spend_coins(
    p_facility_user_id,
    100,
    'direct_invite_fee',
    '演奏者への直接依頼手数料',
    v_idempotency_key,
    p_request_id,
    v_application_id,
    NULL
  );

  -- 8. コイン消費に失敗した場合は登録を取り消す
  IF NOT COALESCE(v_coin_result.success, false) THEN
    DELETE FROM public.applications
    WHERE id = v_application_id;

    RETURN QUERY
    SELECT
      false,
      NULL::uuid,
      v_coin_result.balance_after,
      COALESCE(
        v_coin_result.error_message,
        'コインの消費に失敗しました'
      )::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    true,
    v_application_id,
    v_coin_result.balance_after,
    NULL::text;
END;
$function$;

-- Gate: public.create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)
CREATE OR REPLACE FUNCTION public.create_lesson_offer(p_performer_id uuid, p_title text, p_description text DEFAULT NULL::text, p_instruments text[] DEFAULT '{}'::text[], p_genres text[] DEFAULT '{}'::text[], p_area text DEFAULT NULL::text, p_lesson_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_lesson_fee integer DEFAULT 0, p_capacity integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_balance integer;
  v_reserved_total bigint;
  v_available bigint;
  v_charge bigint;
  v_required bigint;
  v_offer_id uuid;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_performer_id IS NULL
     OR p_title IS NULL
     OR btrim(p_title) = ''
     OR length(p_title) > 120
     OR p_lesson_fee IS NULL
     OR p_lesson_fee < 0
     OR p_capacity IS NULL
     OR p_capacity < 1
     OR p_capacity > 100 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '募集内容、料金、定員の指定が正しくありません'
    );
  END IF;

  IF (
    p_lesson_date IS NULL
    AND p_start_time IS NULL
    AND p_end_time IS NULL
  ) IS FALSE
     AND (
       p_lesson_date IS NULL
       OR p_start_time IS NULL
       OR p_end_time IS NULL
       OR p_end_time <= p_start_time
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '日時を設定する場合は日付・開始時間・終了時間が必要です'
    );
  END IF;

  SELECT p.user_id
  INTO v_user_id
  FROM public.performers AS p
  WHERE p.id = p_performer_id;

  IF NOT FOUND OR v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '演奏者プロフィールが見つかりません'
    );
  END IF;

  SELECT u.coin_balance
  INTO v_balance
  FROM public.users AS u
  WHERE u.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ユーザーのコイン残高を取得できません'
    );
  END IF;

  IF v_balance < 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'コイン残高がマイナスのため、新しいレッスン募集は作成できません。コインを補充してください'
    );
  END IF;

  -- 管理画面で設定した1人あたりの料金を使用
  v_charge := public.configured_lesson_fee(p_lesson_fee)::bigint;

  IF v_charge IS NULL OR v_charge < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'レッスン成立手数料の設定が正しくありません'
    );
  END IF;

  v_required := v_charge * p_capacity;

  IF v_required > 2147483647 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '必要な仮押さえコインが上限を超えています'
    );
  END IF;

  SELECT COALESCE(SUM(lo.reserved_coins), 0)
  INTO v_reserved_total
  FROM public.lesson_offers AS lo
  JOIN public.performers AS p ON p.id = lo.performer_id
  WHERE p.user_id = v_user_id
    AND lo.status = 'open';

  v_available := v_balance::bigint - v_reserved_total;

  IF v_available < v_required THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',
      format(
        'コインが不足しています。定員分の仮押さえに %s コイン必要です。現在の利用可能残高は %s コインです。',
        v_required,
        GREATEST(v_available, 0)
      ),
      'required_coins', v_required,
      'available_coins', GREATEST(v_available, 0)
    );
  END IF;

  INSERT INTO public.lesson_offers (
    performer_id,
    title,
    description,
    instruments,
    genres,
    area,
    lesson_date,
    start_time,
    end_time,
    lesson_fee,
    capacity,
    status,
    reserved_coins
  )
  VALUES (
    p_performer_id,
    btrim(p_title),
    NULLIF(btrim(COALESCE(p_description, '')), ''),
    COALESCE(p_instruments, '{}'),
    COALESCE(p_genres, '{}'),
    NULLIF(btrim(COALESCE(p_area, '')), ''),
    p_lesson_date,
    p_start_time,
    p_end_time,
    p_lesson_fee,
    p_capacity,
    'open',
    v_required::integer
  )
  RETURNING id INTO v_offer_id;

  RETURN jsonb_build_object(
    'success', true,
    'offer_id', v_offer_id,
    'reserved_coins', v_required,
    'balance', v_balance,
    'message', 'レッスン募集を登録し、必要なコインを仮押さえしました'
  );
END;
$function$;

-- Gate: public.create_lesson_offer_with_levels(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])
CREATE OR REPLACE FUNCTION public.create_lesson_offer_with_levels(p_performer_id uuid, p_title text, p_description text DEFAULT NULL::text, p_instruments text[] DEFAULT '{}'::text[], p_genres text[] DEFAULT '{}'::text[], p_area text DEFAULT NULL::text, p_lesson_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_lesson_fee integer DEFAULT 0, p_capacity integer DEFAULT 5, p_target_levels text[] DEFAULT ARRAY['初心者'::text, 'アマ'::text, 'プロ'::text])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_offer_id uuid;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 対象ランクの入力を検証
  IF p_target_levels IS NULL
     OR cardinality(p_target_levels) = 0
     OR EXISTS (
       SELECT 1
       FROM unnest(p_target_levels) AS lv(level)
       WHERE lv.level NOT IN ('初心者', 'アマ', 'プロ')
     )
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '対象ランクを1つ以上選択してください'
    );
  END IF;

  -- 既存の登録関数で、募集作成とコイン仮押さえを実行
  v_result := public.create_lesson_offer(
    p_performer_id,
    p_title,
    p_description,
    p_instruments,
    p_genres,
    p_area,
    p_lesson_date,
    p_start_time,
    p_end_time,
    p_lesson_fee,
    p_capacity
  );

  -- 既存関数が失敗した場合は、その結果を返す
  IF COALESCE((v_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_offer_id := (v_result ->> 'offer_id')::uuid;

  -- 作成した募集に対象ランクを保存
  UPDATE public.lesson_offers
  SET target_levels = ARRAY(
    SELECT DISTINCT lv.level
    FROM unnest(p_target_levels) WITH ORDINALITY AS lv(level, ord)
    ORDER BY lv.level
  )
  WHERE id = v_offer_id;

  RETURN v_result || jsonb_build_object(
    'target_levels', p_target_levels
  );
END;
$function$;

-- Gate: public.create_lesson_offer_with_levels_and_address(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[],text)
CREATE OR REPLACE FUNCTION public.create_lesson_offer_with_levels_and_address(p_performer_id uuid, p_title text, p_description text DEFAULT NULL::text, p_instruments text[] DEFAULT '{}'::text[], p_genres text[] DEFAULT '{}'::text[], p_area text DEFAULT NULL::text, p_lesson_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_lesson_fee integer DEFAULT 0, p_capacity integer DEFAULT 5, p_target_levels text[] DEFAULT ARRAY['初心者'::text, 'アマ'::text, 'プロ'::text], p_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_offer_id uuid;
  v_address text;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_target_levels IS NULL
     OR cardinality(p_target_levels) = 0
     OR EXISTS (
       SELECT 1
       FROM unnest(p_target_levels) AS lv(level)
       WHERE lv.level NOT IN ('初心者', 'アマ', 'プロ')
     )
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '対象ランクを1つ以上選択してください'
    );
  END IF;

  v_address := NULLIF(btrim(p_address), '');

  v_result := public.create_lesson_offer(
    p_performer_id,
    p_title,
    p_description,
    p_instruments,
    p_genres,
    p_area,
    p_lesson_date,
    p_start_time,
    p_end_time,
    p_lesson_fee,
    p_capacity
  );

  IF COALESCE((v_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  v_offer_id := (v_result ->> 'offer_id')::uuid;

  UPDATE public.lesson_offers
  SET
    target_levels = ARRAY(
      SELECT DISTINCT lv.level
      FROM unnest(p_target_levels) WITH ORDINALITY AS lv(level, ord)
      ORDER BY lv.level
    ),
    address = v_address
  WHERE id = v_offer_id;

  RETURN v_result || jsonb_build_object(
    'target_levels', p_target_levels,
    'address', v_address
  );
END;
$function$;

-- Gate: public.create_review_with_reward(uuid,uuid,uuid,integer,text)
CREATE OR REPLACE FUNCTION public.create_review_with_reward(p_match_id uuid, p_reviewer_id uuid, p_reviewee_id uuid, p_rating integer, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_match record;
  v_review_id uuid;
  v_reward_user_id uuid;
  v_balance integer;
  v_new_balance integer;
  v_reward_key text;
  v_reward_amount integer := 0;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 評価点の検証
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION '評価は1〜5の整数で入力してください';
  END IF;

  -- マッチング行をロックして取得
  SELECT
    m.id,
    m.request_id,
    m.performer_id,
    m.status,
    m.performance_status,
    m.completed_at,
    p.user_id AS performer_user_id,
    f.user_id AS facility_user_id
  INTO v_match
  FROM public.matches m
  JOIN public.performers p
    ON p.id = m.performer_id
  JOIN public.performance_requests pr
    ON pr.id = m.request_id
  JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE m.id = p_match_id
  FOR UPDATE OF m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'マッチングが見つかりません';
  END IF;

  -- 演奏完了後のみ評価可能
  IF v_match.performance_status IS DISTINCT FROM 'completed'
     OR v_match.completed_at IS NULL THEN
    RAISE EXCEPTION '演奏完了後に評価できます';
  END IF;

  -- キャンセル済みマッチングは評価不可
  IF v_match.status = 'cancelled' THEN
    RAISE EXCEPTION 'キャンセルされたマッチングは評価できません';
  END IF;

  -- 評価者・評価対象の組み合わせを検証
  IF p_reviewer_id = v_match.facility_user_id THEN
    -- 施設が演奏者を評価する
    IF p_reviewee_id IS DISTINCT FROM v_match.performer_user_id THEN
      RAISE EXCEPTION '評価対象が正しくありません';
    END IF;

    -- 報酬の受取人は演奏者
    v_reward_user_id := v_match.performer_user_id;
    v_reward_amount := p_rating;

  ELSIF p_reviewer_id = v_match.performer_user_id THEN
    -- 演奏者が施設を評価する
    IF p_reviewee_id IS DISTINCT FROM v_match.facility_user_id THEN
      RAISE EXCEPTION '評価対象が正しくありません';
    END IF;

    -- 演奏者による評価投稿には報酬を付与しない
    v_reward_user_id := NULL;
    v_reward_amount := 0;

  ELSE
    RAISE EXCEPTION '評価する権限がありません';
  END IF;

  -- 同じ評価者による二重評価を防止
  IF EXISTS (
    SELECT 1
    FROM public.reviews
    WHERE match_id = p_match_id
      AND reviewer_id = p_reviewer_id
  ) THEN
    RAISE EXCEPTION 'このマッチングはすでに評価済みです';
  END IF;

  -- 評価を保存
  INSERT INTO public.reviews (
    match_id,
    reviewer_id,
    reviewee_id,
    rating,
    comment
  )
  VALUES (
    p_match_id,
    p_reviewer_id,
    p_reviewee_id,
    p_rating,
    NULLIF(BTRIM(p_comment), '')
  )
  RETURNING id INTO v_review_id;

  -- 施設が評価した場合のみ演奏者に報酬を付与
  IF v_reward_user_id IS NOT NULL AND v_reward_amount > 0 THEN
    v_reward_key :=
      'review_reward:' || p_match_id::text || ':' || p_reviewer_id::text;

    -- 残高をロック
    SELECT COALESCE(coin_balance, 0)
    INTO v_balance
    FROM public.users
    WHERE id = v_reward_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '報酬の受取人が見つかりません';
    END IF;

    -- 報酬の二重付与を防止
    IF EXISTS (
      SELECT 1
      FROM public.coin_transactions
      WHERE idempotency_key = v_reward_key
    ) THEN
      RAISE EXCEPTION 'この評価報酬はすでに付与されています';
    END IF;

    UPDATE public.users
    SET coin_balance = COALESCE(coin_balance, 0) + v_reward_amount
    WHERE id = v_reward_user_id
    RETURNING coin_balance INTO v_new_balance;

    INSERT INTO public.coin_transactions (
      user_id,
      amount,
      transaction_type,
      description,
      balance_after,
      request_id,
      match_id,
      created_by_user_id,
      idempotency_key
    )
    VALUES (
      v_reward_user_id,
      v_reward_amount,
      'review_reward',
      '施設からの評価投稿報酬（' || p_rating || '点）',
      v_new_balance,
      v_match.request_id,
      p_match_id,
      p_reviewer_id,
      v_reward_key
    );
  ELSE
    SELECT COALESCE(coin_balance, 0)
    INTO v_new_balance
    FROM public.users
    WHERE id = p_reviewer_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reviewId', v_review_id,
    'rewardAmount', v_reward_amount,
    'rewardUserId', v_reward_user_id,
    'balanceAfter', v_new_balance
  );
END;
$function$;

-- Gate: public.disband_band(uuid,uuid)
CREATE OR REPLACE FUNCTION public.disband_band(p_band_id uuid, p_performer_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_band_id IS NULL OR p_performer_id IS NULL THEN
    RETURN QUERY
    SELECT false, '指定内容が正しくありません'::text;
    RETURN;
  END IF;

  -- バンドをロックし、同時実行による競合を防ぐ
  SELECT b.status
  INTO v_status
  FROM public.bands b
  WHERE b.id = p_band_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, 'バンドが見つかりません'::text;
    RETURN;
  END IF;

  IF v_status <> 'active' THEN
    RETURN QUERY
    SELECT false, 'このバンドはすでに解散済みです'::text;
    RETURN;
  END IF;

  -- アクティブなリーダーだけが解散できる
  IF NOT EXISTS (
    SELECT 1
    FROM public.band_members bm
    WHERE bm.band_id = p_band_id
      AND bm.performer_id = p_performer_id
      AND bm.role = 'leader'
      AND bm.status = 'active'
  ) THEN
    RETURN QUERY
    SELECT false, 'バンドのリーダーだけが解散できます'::text;
    RETURN;
  END IF;

  -- 未完了の演奏が残っている場合は解散させない
  IF EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.band_id = p_band_id
      AND m.status = 'active'
      AND m.performance_status = 'scheduled'
  ) THEN
    RETURN QUERY
    SELECT
      false,
      '未完了の演奏予定が残っています。演奏完了またはキャンセルの処理後に解散してください'::text;
    RETURN;
  END IF;

  -- 未回答の招待をキャンセル
  UPDATE public.band_invitations
  SET status = 'cancelled'
  WHERE band_id = p_band_id
    AND status = 'pending';

  -- メンバーの所属履歴は残し、所属を解除
  UPDATE public.band_members
  SET status = 'left'
  WHERE band_id = p_band_id
    AND status = 'active';

  -- バンドは削除せず、解散状態にする
  UPDATE public.bands
  SET status = 'disbanded'
  WHERE id = p_band_id;

  RETURN QUERY
  SELECT true, NULL::text;
END;
$function$;

-- Gate: public.manage_completion_dispute_case(uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.manage_completion_dispute_case(p_case_id uuid, p_admin_line_user_id text, p_action_type text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_match_id uuid;
  v_case public.completion_dispute_admin_cases%ROWTYPE;
  v_match public.matches%ROWTYPE;
  v_note text;
  v_now timestamptz := now();
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 入力チェック
  IF p_case_id IS NULL
     OR NULLIF(btrim(p_admin_line_user_id), '') IS NULL
     OR p_action_type NOT IN ('started', 'note', 'resolved') THEN
    RAISE EXCEPTION '入力内容が不正です。';
  END IF;

  v_note := btrim(coalesce(p_note, ''));

  IF v_note = '' OR char_length(v_note) > 2000 THEN
    RAISE EXCEPTION '記録内容は1〜2000文字で入力してください。';
  END IF;

  -- 先に対象matchを特定
  SELECT match_id
    INTO v_match_id
    FROM public.completion_dispute_admin_cases
   WHERE id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '異議申し立て案件が見つかりません。';
  END IF;

  -- 合意解決関数とロック順を統一するため、matchを先にロック
  SELECT *
    INTO v_match
    FROM public.matches
   WHERE id = v_match_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象のマッチングが見つかりません。';
  END IF;

  -- 続いて案件をロック
  SELECT *
    INTO v_case
    FROM public.completion_dispute_admin_cases
   WHERE id = p_case_id
   FOR UPDATE;

  IF NOT FOUND OR v_case.status <> 'in_progress' THEN
    RAISE EXCEPTION 'この案件は対応中ではありません。';
  END IF;

  IF p_action_type = 'resolved' THEN
    IF v_match.performance_status <> 'active'
       OR v_match.completion_disputed_at IS NULL THEN
      RAISE EXCEPTION '対象のマッチングは解決可能な異議申し立て状態ではありません。';
    END IF;

    -- 異議申し立て状態のみ解除。演奏完了・手数料徴収は行わない
    UPDATE public.matches
       SET completion_disputed_at = NULL,
           completion_disputed_by = NULL,
           completion_dispute_reason = NULL,
           completion_dispute_facility_agreed_at = NULL,
           completion_dispute_performer_agreed_at = NULL
     WHERE id = v_match_id;

    UPDATE public.completion_dispute_admin_cases
       SET status = 'resolved',
           resolution_source = 'admin',
           resolved_at = v_now,
           resolved_by_line_user_id = p_admin_line_user_id,
           resolution_note = v_note,
           updated_at = v_now
     WHERE id = p_case_id;

  END IF;

  INSERT INTO public.completion_dispute_admin_actions (
    case_id,
    admin_line_user_id,
    action_type,
    note,
    created_at
  )
  VALUES (
    p_case_id,
    p_admin_line_user_id,
    p_action_type,
    v_note,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'case_id', p_case_id,
    'action_type', p_action_type,
    'status', CASE
      WHEN p_action_type = 'resolved' THEN 'resolved'
      ELSE 'in_progress'
    END
  );
END;
$function$;

-- Gate: public.manage_stripe_payment_incident(uuid,text,text,text)
CREATE OR REPLACE FUNCTION public.manage_stripe_payment_incident(p_incident_id uuid, p_admin_line_user_id text, p_action text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_incident public.stripe_payment_incidents%ROWTYPE;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_incident_id IS NULL
     OR NULLIF(btrim(COALESCE(p_admin_line_user_id, '')), '') IS NULL
     OR p_action IS NULL
     OR p_action NOT IN ('under_review','resolved','dismissed')
     OR char_length(btrim(COALESCE(p_note, ''))) NOT BETWEEN 1 AND 2000 THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '入力内容が不正です');
  END IF;

  SELECT * INTO v_incident
  FROM public.stripe_payment_incidents
  WHERE id = p_incident_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'errorMessage', '決済事故記録が見つかりません');
  END IF;

  UPDATE public.stripe_payment_incidents
  SET resolution_status = p_action,
      resolved_at = CASE WHEN p_action IN ('resolved','dismissed') THEN now() ELSE NULL END,
      resolved_by_line_user_id = CASE WHEN p_action IN ('resolved','dismissed') THEN p_admin_line_user_id ELSE NULL END
  WHERE id = p_incident_id;

  INSERT INTO public.stripe_payment_incident_actions (
    incident_id, admin_line_user_id, action_type, note
  ) VALUES (
    p_incident_id, p_admin_line_user_id, p_action, btrim(p_note)
  );

  RETURN jsonb_build_object('success', true, 'incidentId', p_incident_id, 'resolutionStatus', p_action);
END;
$function$;

-- Gate: public.register_completion_dispute(uuid,text,text,uuid)
CREATE OR REPLACE FUNCTION public.register_completion_dispute(p_match_id uuid, p_disputed_by text, p_reason text, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_match public.matches%ROWTYPE;
  v_case_id uuid;
  v_disputed_at timestamptz := now();
  v_performer_id uuid;
  v_facility_id uuid;
  v_is_authorized boolean := false;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 入力検証
  IF p_disputed_by NOT IN ('facility', 'performer') THEN
    RAISE EXCEPTION 'Invalid dispute side';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0
     OR length(trim(p_reason)) > 1000 THEN
    RAISE EXCEPTION 'Invalid dispute reason';
  END IF;

  -- 対象マッチングをロック
  SELECT *
  INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  -- 施設側の本人確認
  IF p_disputed_by = 'facility' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.performance_requests pr
      INNER JOIN public.facilities f
        ON f.id = pr.facility_id
      WHERE pr.id = v_match.request_id
        AND f.user_id = p_user_id
    )
    INTO v_is_authorized;

  -- 演奏者側の本人確認
  ELSIF p_disputed_by = 'performer' THEN
    IF v_match.band_id IS NOT NULL THEN
      -- バンドの場合は有効なリーダーのみ
      SELECT EXISTS (
        SELECT 1
        FROM public.performers p
        INNER JOIN public.band_members bm
          ON bm.performer_id = p.id
        WHERE p.user_id = p_user_id
          AND bm.band_id = v_match.band_id
          AND bm.role = 'leader'
          AND bm.status = 'active'
      )
      INTO v_is_authorized;
    ELSE
      -- 個人演奏者本人のみ
      SELECT EXISTS (
        SELECT 1
        FROM public.performers p
        WHERE p.id = v_match.performer_id
          AND p.user_id = p_user_id
      )
      INTO v_is_authorized;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Not authorized to dispute this match';
  END IF;

  IF v_match.status <> 'active' THEN
    RAISE EXCEPTION 'Match is not active';
  END IF;

  IF v_match.performance_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Performance is already completed or cancelled';
  END IF;

  IF v_match.completion_disputed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Dispute already exists';
  END IF;

  -- 申し立てを登録
  UPDATE public.matches
  SET
    completion_disputed_at = v_disputed_at,
    completion_disputed_by = p_disputed_by,
    completion_dispute_reason = trim(p_reason)
  WHERE id = p_match_id;

  -- 管理者対応案件を作成
  INSERT INTO public.completion_dispute_admin_cases (
    match_id,
    status,
    dispute_reason,
    disputed_by,
    disputed_at
  )
  VALUES (
    p_match_id,
    'in_progress',
    trim(p_reason),
    p_disputed_by,
    v_disputed_at
  )
  RETURNING id INTO v_case_id;

  -- 受付履歴を記録
  INSERT INTO public.completion_dispute_admin_actions (
    case_id,
    admin_line_user_id,
    action_type,
    note
  )
  VALUES (
    v_case_id,
    'system',
    'started',
    '異議申し立てを受け付けました。'
  );

  RETURN v_case_id;
END;
$function$;

-- Gate: public.reject_direct_invitation_with_refund(uuid,uuid)
CREATE OR REPLACE FUNCTION public.reject_direct_invitation_with_refund(p_application_id uuid, p_performer_id uuid)
 RETURNS TABLE(success boolean, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_initial_performer_id uuid;
  v_initial_source text;
  v_request_status text;
  v_facility_user_id uuid;

  v_app record;
  v_fee record;

  v_balance integer;
  v_new_balance integer;
  v_refund_key text;
  v_refund_amount integer;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 応募情報を読み取る（まだロックしない）
  SELECT
    a.request_id,
    a.performer_id,
    a.source
  INTO
    v_request_id,
    v_initial_performer_id,
    v_initial_source
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF NOT FOUND
     OR v_initial_performer_id IS DISTINCT FROM p_performer_id
     OR v_initial_source IS DISTINCT FROM 'facility_invite' THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '直接依頼が見つかりません'::text;
    RETURN;
  END IF;

  -- 1. 案件行を最初にロック
  SELECT
    pr.status,
    f.user_id
  INTO
    v_request_status,
    v_facility_user_id
  FROM public.performance_requests pr
  JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE pr.id = v_request_id
  FOR UPDATE OF pr;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '案件または施設ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  IF v_request_status <> 'open' THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      'この案件はすでに締め切られています'::text;
    RETURN;
  END IF;

  -- 元の手数料履歴を取得
  SELECT ct.*
  INTO v_fee
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key =
      'direct_invite_fee:'
      || v_request_id::text
      || ':'
      || p_performer_id::text
    AND ct.transaction_type = 'direct_invite_fee'
    AND ct.amount < 0
    AND ct.application_id = p_application_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '元の手数料履歴が見つかりません'::text;
    RETURN;
  END IF;

  IF v_fee.user_id IS DISTINCT FROM v_facility_user_id THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '手数料の引き落とし元と施設所有者が一致しません'::text;
    RETURN;
  END IF;

  -- 2. 施設ユーザーの残高行をロック
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '施設ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  -- 3. 応募行をロック
  SELECT
    a.id,
    a.request_id,
    a.performer_id,
    a.source,
    a.status
  INTO v_app
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.request_id = v_request_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_app.performer_id IS DISTINCT FROM p_performer_id
     OR v_app.source IS DISTINCT FROM 'facility_invite' THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '直接依頼が見つかりません'::text;
    RETURN;
  END IF;

  IF v_app.status NOT IN ('pending', 'rejected') THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      'この依頼は辞退できない状態です'::text;
    RETURN;
  END IF;

  v_refund_amount := -v_fee.amount;
  v_refund_key :=
    'direct_invite_refund:' || v_app.id::text;

  -- 4. 返金キーをロックして二重返金を防止
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_refund_key, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.coin_transactions ct
    WHERE ct.idempotency_key = v_refund_key
  ) THEN
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_app.id
      AND status = 'pending';

    SELECT u.coin_balance
    INTO v_new_balance
    FROM public.users u
    WHERE u.id = v_facility_user_id;

    RETURN QUERY
    SELECT true, v_new_balance, NULL::text;
    RETURN;
  END IF;

  -- 5. 応募を辞退済みに変更
  UPDATE public.applications
  SET status = 'rejected'
  WHERE id = v_app.id;

  -- 6. 元の徴収額を返金
  v_new_balance := v_balance + v_refund_amount;

  UPDATE public.users
  SET coin_balance = v_new_balance
  WHERE id = v_facility_user_id;

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
    v_facility_user_id,
    v_refund_amount,
    'admin_adjustment',
    '直接依頼の辞退による手数料返金',
    v_new_balance,
    v_app.request_id,
    v_app.id,
    NULL,
    v_facility_user_id,
    v_refund_key
  );

  RETURN QUERY
  SELECT true, v_new_balance, NULL::text;
END;
$function$;

-- Gate: public.reject_direct_invitation_with_refund_for_withdrawal(uuid,uuid)
CREATE OR REPLACE FUNCTION public.reject_direct_invitation_with_refund_for_withdrawal(p_application_id uuid, p_performer_id uuid)
 RETURNS TABLE(success boolean, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_request_id uuid;
  v_facility_user_id uuid;
  v_app record;
  v_fee record;
  v_balance integer;
  v_new_balance integer;
  v_refund_amount integer;
  v_refund_key text;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  -- 初期情報取得。まだロックしない
  SELECT a.request_id
  INTO v_request_id
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.performer_id = p_performer_id
    AND a.source = 'facility_invite';

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '直接依頼が見つかりません'::text;
    RETURN;
  END IF;

  -- 1. 案件をロック
  SELECT f.user_id
  INTO v_facility_user_id
  FROM public.performance_requests pr
  JOIN public.facilities f
    ON f.id = pr.facility_id
  WHERE pr.id = v_request_id
  FOR UPDATE OF pr;

  IF NOT FOUND OR v_facility_user_id IS NULL THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '案件または施設ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  -- 元の手数料履歴を確認
  SELECT ct.*
  INTO v_fee
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key =
      'direct_invite_fee:'
      || v_request_id::text
      || ':'
      || p_performer_id::text
    AND ct.transaction_type = 'direct_invite_fee'
    AND ct.amount < 0
    AND ct.application_id = p_application_id
    AND ct.request_id = v_request_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '元の手数料履歴が見つかりません'::text;
    RETURN;
  END IF;

  IF v_fee.user_id IS DISTINCT FROM v_facility_user_id THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '手数料の引き落とし元と施設所有者が一致しません'::text;
    RETURN;
  END IF;

  -- 2. 施設ユーザーの残高行をロック
  SELECT u.coin_balance
  INTO v_balance
  FROM public.users u
  WHERE u.id = v_facility_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '施設ユーザーが見つかりません'::text;
    RETURN;
  END IF;

  -- 3. 応募行をロック
  SELECT
    a.id,
    a.request_id,
    a.performer_id,
    a.source,
    a.status
  INTO v_app
  FROM public.applications a
  WHERE a.id = p_application_id
    AND a.request_id = v_request_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_app.performer_id IS DISTINCT FROM p_performer_id
     OR v_app.source IS DISTINCT FROM 'facility_invite' THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      '直接依頼が見つかりません'::text;
    RETURN;
  END IF;

  IF v_app.status NOT IN ('pending', 'rejected') THEN
    RETURN QUERY
    SELECT false, NULL::integer,
      'この依頼は返金対象の状態ではありません'::text;
    RETURN;
  END IF;

  v_refund_amount := -v_fee.amount;
  v_refund_key :=
    'direct_invite_refund:' || v_app.id::text;

  -- 4. 返金キーをロック
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_refund_key, 0)
  );

  -- 既に返金済みなら残高を変えず成功扱い
  IF EXISTS (
    SELECT 1
    FROM public.coin_transactions ct
    WHERE ct.idempotency_key = v_refund_key
  ) THEN
    UPDATE public.applications
    SET status = 'rejected'
    WHERE id = v_app.id
      AND status = 'pending';

    SELECT u.coin_balance
    INTO v_new_balance
    FROM public.users u
    WHERE u.id = v_facility_user_id;

    RETURN QUERY
    SELECT true, v_new_balance, NULL::text;
    RETURN;
  END IF;

  -- 5. 応募を辞退済みにする
  UPDATE public.applications
  SET status = 'rejected'
  WHERE id = v_app.id;

  -- 6. 実際の徴収額を返金
  v_new_balance := v_balance + v_refund_amount;

  UPDATE public.users
  SET coin_balance = v_new_balance
  WHERE id = v_facility_user_id;

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
    v_facility_user_id,
    v_refund_amount,
    'admin_adjustment',
    '演奏者退会によるダイレクトオファー手数料返金',
    v_new_balance,
    v_app.request_id,
    v_app.id,
    NULL,
    v_facility_user_id,
    v_refund_key
  );

  RETURN QUERY
  SELECT true, v_new_balance, NULL::text;
END;
$function$;

-- Gate: public.respond_to_band_invitation(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.respond_to_band_invitation(p_invitation_id uuid, p_performer_id uuid, p_decision text)
 RETURNS TABLE(invitation_id uuid, band_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  invitation_row public.band_invitations%ROWTYPE;
  v_prelock_band_id uuid;
  v_band_status text;
  v_user_id uuid;
  v_account_status text;
  v_user_type text;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_invitation_id IS NULL OR p_performer_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF p_decision IS NULL
     OR p_decision NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  -- ① 招待されたperformerのユーザー行を特定
  SELECT p.user_id
  INTO v_user_id
  FROM public.performers AS p
  WHERE p.id = p_performer_id;

  IF NOT FOUND OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'performer_not_found';
  END IF;

  -- ② ユーザー行を先にロック（退会処理と順序を統一）
  SELECT u.account_status, u.user_type
  INTO v_account_status, v_user_type
  FROM public.users AS u
  WHERE u.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  IF v_account_status <> 'active' THEN
    RAISE EXCEPTION 'account_not_active';
  END IF;

  IF v_user_type <> 'performer' THEN
    RAISE EXCEPTION 'not_performer_account';
  END IF;

  -- ③ 招待のband_idを先に取得（ロックなし）
  SELECT bi.band_id
  INTO v_prelock_band_id
  FROM public.band_invitations AS bi
  WHERE bi.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found';
  END IF;

  -- ④ バンドをロック
  SELECT b.status
  INTO v_band_status
  FROM public.bands AS b
  WHERE b.id = v_prelock_band_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'band_not_found';
  END IF;

  -- ⑤ 招待をロック
  SELECT bi.*
  INTO invitation_row
  FROM public.band_invitations AS bi
  WHERE bi.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found';
  END IF;

  IF invitation_row.band_id IS DISTINCT FROM v_prelock_band_id THEN
    RAISE EXCEPTION 'invitation_updated';
  END IF;

  -- 招待された本人だけが回答できる
  IF invitation_row.invitee_performer_id <> p_performer_id THEN
    RAISE EXCEPTION 'not_invitee';
  END IF;

  IF invitation_row.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation_not_pending';
  END IF;

  IF p_decision = 'accepted' THEN
    IF v_band_status <> 'active' THEN
      RAISE EXCEPTION 'band_not_active';
    END IF;

    INSERT INTO public.band_members AS bm (
      band_id,
      performer_id,
      role,
      status,
      joined_at
    )
    VALUES (
      invitation_row.band_id,
      p_performer_id,
      'member',
      'active',
      now()
    )
    ON CONFLICT (band_id, performer_id)
    DO UPDATE SET
      role = 'member',
      status = 'active',
      joined_at = now();
  END IF;

  UPDATE public.band_invitations AS bi
  SET
    status = p_decision,
    responded_at = now()
  WHERE bi.id = invitation_row.id;

  RETURN QUERY
  SELECT
    invitation_row.id,
    invitation_row.band_id,
    p_decision;
END;
$function$;

-- Gate: public.spend_coins(uuid,integer,text,text,text,uuid,uuid,uuid)
CREATE OR REPLACE FUNCTION public.spend_coins(p_user_id uuid, p_amount integer, p_transaction_type text, p_description text, p_idempotency_key text, p_request_id uuid DEFAULT NULL::uuid, p_application_id uuid DEFAULT NULL::uuid, p_match_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_effective_amount integer;
  v_existing public.coin_transactions%ROWTYPE;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  v_effective_amount :=
    public.configured_coin_fee(p_transaction_type, p_amount);

  IF p_user_id IS NULL
     OR p_amount IS NULL
     OR v_effective_amount IS NULL
     OR v_effective_amount <= 0
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT
      false,
      NULL::integer,
      'コイン消費の指定が正しくありません'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_idempotency_key, 0)
  );

  -- レート変更後のリトライも、過去の取引額を変えずに扱う
  SELECT ct.*
  INTO v_existing
  FROM public.coin_transactions AS ct
  WHERE ct.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.transaction_type IS DISTINCT FROM p_transaction_type
       OR v_existing.request_id IS DISTINCT FROM p_request_id
       OR v_existing.application_id IS DISTINCT FROM p_application_id
       OR v_existing.match_id IS DISTINCT FROM p_match_id
       OR (
         p_transaction_type NOT IN (
           'application_fee',
           'direct_invite_fee',
           'match_fee'
         )
         AND v_existing.amount IS DISTINCT FROM -p_amount
       ) THEN
      RETURN QUERY SELECT
        false,
        NULL::integer,
        '冪等キーが別の取引です。二重処理を防ぐため中止しました'::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      true,
      v_existing.balance_after,
      NULL::text;
    RETURN;
  END IF;

  -- レートを適用した額で従来の残高検証・消費・履歴記録を行う
  RETURN QUERY
  SELECT
    result.success,
    result.balance_after,
    result.error_message
  FROM public.spend_coins_legacy(
    p_user_id,
    v_effective_amount,
    p_transaction_type,
    p_description,
    p_idempotency_key,
    p_request_id,
    p_application_id,
    p_match_id
  ) AS result;

  RETURN;
END;
$function$;

-- Gate: public.spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)
CREATE OR REPLACE FUNCTION public.spend_coins_legacy(p_user_id uuid, p_amount integer, p_transaction_type text, p_description text, p_idempotency_key text, p_request_id uuid DEFAULT NULL::uuid, p_application_id uuid DEFAULT NULL::uuid, p_match_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, balance_after integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_balance integer;
  v_new_balance integer;
  v_reserved_total bigint;
  v_existing public.coin_transactions%ROWTYPE;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_user_id IS NULL
     OR p_amount IS NULL
     OR p_amount <= 0
     OR p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT
      false, NULL::integer,
      'コイン消費の指定が正しくありません'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_idempotency_key, 0)
  );

  -- 既存取引の再試行は先に確認し、二重徴収を防ぐ
  SELECT ct.*
  INTO v_existing
  FROM public.coin_transactions ct
  WHERE ct.idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.amount IS DISTINCT FROM -p_amount
       OR v_existing.transaction_type IS DISTINCT FROM p_transaction_type
       OR v_existing.request_id IS DISTINCT FROM p_request_id THEN
      RETURN QUERY SELECT
        false, NULL::integer,
        '冪等キーが別の取引です。二重処理を防ぐため中止しました'::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      true, v_existing.balance_after, NULL::text;
    RETURN;
  END IF;

  -- ユーザー残高をロックして取得
  SELECT u.coin_balance
  INTO v_current_balance
  FROM public.users u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_current_balance IS NULL THEN
    RETURN QUERY SELECT
      false, NULL::integer,
      'ユーザーが見つからないか、残高を取得できません'::text;
    RETURN;
  END IF;

  -- マイナス残高のユーザーによる新規消費を禁止
  IF v_current_balance < 0 THEN
    RETURN QUERY SELECT
      false, v_current_balance,
      'コイン残高がマイナスのため、新しい取引はできません。コインを補充してください'::text;
    RETURN;
  END IF;

  -- オープン中のレッスン募集が予約しているコインを計算
  SELECT COALESCE(SUM(lo.reserved_coins), 0)
  INTO v_reserved_total
  FROM public.lesson_offers lo
  JOIN public.performers p
    ON p.id = lo.performer_id
  WHERE p.user_id = p_user_id
    AND lo.status = 'open';

  IF v_current_balance::bigint - v_reserved_total < p_amount THEN
    RETURN QUERY SELECT
      false, v_current_balance,
      '利用可能なコインが不足しています。レッスン募集の仮押さえ分は使用できません'::text;
    RETURN;
  END IF;

  v_new_balance := v_current_balance - p_amount;

  UPDATE public.users
  SET coin_balance = v_new_balance
  WHERE id = p_user_id;

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
    p_user_id,
    -p_amount,
    p_transaction_type,
    p_description,
    v_new_balance,
    p_request_id,
    p_application_id,
    p_match_id,
    p_user_id,
    p_idempotency_key
  );

  RETURN QUERY SELECT true, v_new_balance, NULL::text;
END;
$function$;

-- Gate: public.submit_band_application_idempotent(uuid,uuid,uuid,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.submit_band_application_idempotent(p_operation_id uuid, p_user_id uuid, p_performer_id uuid, p_band_id uuid, p_request_id uuid, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload_hash text;
  v_existing public.idempotency_operations%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_operation_id IS NULL OR p_user_id IS NULL
     OR p_performer_id IS NULL OR p_band_id IS NULL OR p_request_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_message', '応募情報が正しくありません', 'is_replay', false);
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'performer_id', p_performer_id,
    'band_id', p_band_id,
    'request_id', p_request_id,
    'message', COALESCE(p_message, '')
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended('application-operation:' || p_operation_id::text, 0));

  SELECT * INTO v_existing
  FROM public.idempotency_operations
  WHERE operation_id = p_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM p_user_id
       OR v_existing.operation_type IS DISTINCT FROM 'band_application'
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN jsonb_build_object('success', false, 'error_message', 'IDEMPOTENCY_CONFLICT', 'is_replay', false);
    END IF;
    RETURN v_existing.result || jsonb_build_object('is_replay', true);
  END IF;

  SELECT to_jsonb(r) INTO v_result
  FROM public.apply_to_performance_request_as_band(
    p_user_id, p_performer_id, p_band_id, p_request_id, p_message
  ) AS r;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_message', 'バンド応募処理結果を取得できませんでした', 'is_replay', false);
  END IF;

  v_result := v_result || jsonb_build_object('is_replay', false);

  IF COALESCE((v_result->>'success')::boolean, false) THEN
    INSERT INTO public.idempotency_operations(
      operation_id, actor_user_id, operation_type, payload_hash, result
    ) VALUES (
      p_operation_id, p_user_id, 'band_application', v_payload_hash, v_result
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- Gate: public.submit_personal_application_idempotent(uuid,uuid,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.submit_personal_application_idempotent(p_operation_id uuid, p_user_id uuid, p_request_id uuid, p_performer_id uuid, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload_hash text;
  v_existing public.idempotency_operations%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_operation_id IS NULL OR p_user_id IS NULL
     OR p_request_id IS NULL OR p_performer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_message', '応募情報が正しくありません', 'is_replay', false);
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'request_id', p_request_id,
    'performer_id', p_performer_id,
    'message', COALESCE(p_message, '')
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended('application-operation:' || p_operation_id::text, 0));

  SELECT * INTO v_existing
  FROM public.idempotency_operations
  WHERE operation_id = p_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM p_user_id
       OR v_existing.operation_type IS DISTINCT FROM 'personal_application'
       OR v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RETURN jsonb_build_object('success', false, 'error_message', 'IDEMPOTENCY_CONFLICT', 'is_replay', false);
    END IF;
    RETURN v_existing.result || jsonb_build_object('is_replay', true);
  END IF;

  SELECT to_jsonb(r) INTO v_result
  FROM public.apply_to_performance_request(
    p_user_id, p_request_id, p_performer_id, p_message, p_operation_id
  ) AS r;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_message', '応募処理結果を取得できませんでした', 'is_replay', false);
  END IF;

  v_result := v_result || jsonb_build_object('is_replay', false);

  -- Cache only successful mutations. Business rejections may be retried after state changes.
  IF COALESCE((v_result->>'success')::boolean, false) THEN
    INSERT INTO public.idempotency_operations(
      operation_id, actor_user_id, operation_type, payload_hash, result
    ) VALUES (
      p_operation_id, p_user_id, 'personal_application', v_payload_hash, v_result
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- Gate: public.transfer_band_coins(uuid,uuid,uuid,integer,text,text)
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

-- Gate: public.update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])
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
  v_other_reserved bigint;
  v_current_reserved integer;
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_offer_id IS NULL OR p_performer_id IS NULL
     OR p_title IS NULL OR btrim(p_title) = ''
     OR length(p_title) > 120
     OR p_lesson_fee IS NULL OR p_lesson_fee < 0
     OR p_capacity IS NULL OR p_capacity < 1 OR p_capacity > 100
     OR p_target_levels IS NULL
     OR cardinality(p_target_levels) = 0
     OR EXISTS (
       SELECT 1
       FROM unnest(p_target_levels) AS lv(level)
       WHERE lv.level NOT IN ('初心者', 'アマ', 'プロ')
     )
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '募集内容、料金、定員、対象ランクの指定が正しくありません'
    );
  END IF;

  IF NOT (
    p_lesson_date IS NULL
    AND p_start_time IS NULL
    AND p_end_time IS NULL
  ) AND (
    p_lesson_date IS NULL
    OR p_start_time IS NULL
    OR p_end_time IS NULL
    OR p_end_time <= p_start_time
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '日時を設定する場合は日付・開始時間・終了時間が必要です'
    );
  END IF;

  SELECT p.user_id, lo.status, lo.reserved_coins
  INTO v_user_id, v_status, v_current_reserved
  FROM public.lesson_offers AS lo
  JOIN public.performers AS p ON p.id = lo.performer_id
  WHERE lo.id = p_offer_id
    AND lo.performer_id = p_performer_id
  FOR UPDATE OF lo;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '募集が見つからないか、編集する権限がありません'
    );
  END IF;

  IF v_status <> 'open' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '募集中のレッスンのみ編集できます'
    );
  END IF;

  SELECT u.coin_balance
  INTO v_balance
  FROM public.users AS u
  WHERE u.id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'コイン残高を取得できません'
    );
  END IF;

  SELECT COUNT(*)::integer
  INTO v_matched_count
  FROM public.lesson_applications
  WHERE lesson_offer_id = p_offer_id
    AND status = 'matched';

  IF p_capacity < v_matched_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format(
        '定員は成立済み人数（%s人）以上にしてください',
        v_matched_count
      )
    );
  END IF;

  -- 編集時は最新のレートを使用
  v_charge :=
    public.configured_lesson_fee(p_lesson_fee)::bigint;

  IF v_charge IS NULL OR v_charge < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'レッスン成立手数料の設定が正しくありません'
    );
  END IF;

  v_required := v_charge * (p_capacity - v_matched_count);

  IF v_required > 2147483647 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', '必要な仮押さえコインが上限を超えています'
    );
  END IF;

  SELECT COALESCE(SUM(lo.reserved_coins), 0)
  INTO v_other_reserved
  FROM public.lesson_offers AS lo
  JOIN public.performers AS p ON p.id = lo.performer_id
  WHERE p.user_id = v_user_id
    AND lo.status = 'open'
    AND lo.id <> p_offer_id;

  IF v_balance < 0 AND v_required > v_current_reserved THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'コイン残高がマイナスのため、仮押さえコインを増やす編集はできません。コインを補充するか、料金・定員を見直してください。',
      'current_reserved_coins', v_current_reserved,
      'required_coins', v_required
    );
  END IF;

  IF v_balance >= 0
     AND v_balance::bigint - v_other_reserved < v_required THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'コインが不足しています。料金や定員を見直してください。',
      'required_coins', v_required,
      'available_coins',
        GREATEST(v_balance::bigint - v_other_reserved, 0)
    );
  END IF;

  UPDATE public.lesson_offers
  SET
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
    target_levels = ARRAY(
      SELECT DISTINCT lv.level
      FROM unnest(p_target_levels) AS lv(level)
      ORDER BY lv.level
    ),
    reserved_coins = v_required::integer
  WHERE id = p_offer_id;

  RETURN jsonb_build_object(
    'success', true,
    'reserved_coins', v_required,
    'message', '募集内容を更新しました'
  );
END;
$function$;

-- Gate: public.withdraw_user_account(text)
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
BEGIN
  -- Global transaction gate: acquired before any row/advisory locks.
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

  -- プロフィールIDと演奏者名を取得
  IF v_user.user_type = 'performer' THEN
    SELECT id, name
    INTO v_performer_id, v_performer_name
    FROM public.performers
    WHERE user_id = v_user.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '演奏者プロフィールが見つからないため退会できません';
    END IF;

  ELSIF v_user.user_type = 'facility' THEN
    SELECT id
    INTO v_facility_id
    FROM public.facilities
    WHERE user_id = v_user.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '施設プロフィールが見つからないため退会できません';
    END IF;

  ELSE
    RAISE EXCEPTION 'ユーザー種別が不正なため退会できません';
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
          v_user.user_type = 'facility'
          AND pr.facility_id = v_facility_id
        )
        OR
        (
          v_user.user_type = 'performer'
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
          v_user.user_type = 'facility'
          AND pr.facility_id = v_facility_id
        )
        OR
        (
          v_user.user_type = 'performer'
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

    v_refund_amount :=
      COALESCE(
        (v_cancel_result->>'refundAmount')::integer,
        0
      );

    -- 施設退会：参加演奏者全員分の通知情報を作成
    IF v_user.user_type = 'facility' THEN
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
      ) recipients;

    -- 演奏者退会：相手の施設に通知情報を作成
    ELSE
      v_match_notifications :=
        CASE
          WHEN v_match.facility_line_user_id IS NOT NULL
            AND v_match.facility_line_user_id NOT LIKE 'withdrawn:%'
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

    v_cancelled_count := v_cancelled_count + 1;
  END LOOP;

  -- 施設退会処理
  IF v_user.user_type = 'facility' THEN

    UPDATE public.applications a
    SET status = 'rejected'
    FROM public.performance_requests pr
    WHERE a.request_id = pr.id
      AND pr.facility_id = v_facility_id
      AND a.status = 'pending';

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
  IF v_user.user_type = 'performer' THEN

    -- 本人の未処理応募を終了
    UPDATE public.applications
    SET status = 'rejected'
    WHERE performer_id = v_performer_id
      AND status = 'pending';

    -- レッスン募集を終了。予約コインは残高に加算しない
    UPDATE public.lesson_offers
    SET
      status = 'closed',
      reserved_coins = 0
    WHERE performer_id = v_performer_id
      AND status = 'open';

    -- 本人が送信・受信した未回答の招待を終了
    UPDATE public.band_invitations
    SET
      status = 'cancelled',
      responded_at = now()
    WHERE status = 'pending'
      AND (
        inviter_performer_id = v_performer_id
        OR invitee_performer_id = v_performer_id
      );

    -- 現在のリーダー所属バンドだけを解散対象にする
    SELECT COALESCE(
      array_agg(DISTINCT bm.band_id),
      ARRAY[]::uuid[]
    )
    INTO v_withdrawn_band_ids
    FROM public.band_members bm
    JOIN public.bands b
      ON b.id = bm.band_id
    WHERE bm.performer_id = v_performer_id
      AND bm.status = 'active'
      AND bm.role = 'leader'
      AND b.status = 'active';

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
    'notifications', v_notifications
  );
END;
$function$;

DO $postflight$
DECLARE
  v_table_count integer;
  v_trigger_count integer;
BEGIN
  SELECT count(*) INTO v_table_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND t.tgname = 'trg_global_mutation_gate' AND NOT t.tgisinternal;
  IF v_table_count <> v_trigger_count THEN
    RAISE EXCEPTION 'Global gate trigger coverage mismatch: tables %, triggers %', v_table_count, v_trigger_count;
  END IF;
END;
$postflight$;

COMMIT;
