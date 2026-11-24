-- V48.001: immutable submission-time participant snapshots and permanent
-- same-request participant/band trade claims. Apply after V47.002.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'V48.001 stopped: global mutation gate function is missing';
  END IF;
  IF to_regclass('public.application_attempts') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regclass('public.matches') IS NULL
     OR to_regclass('public.band_members') IS NULL
     OR to_regclass('public.bands') IS NULL
     OR to_regclass('public.performers') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'V48.001 stopped: required matching/band/account tables are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.application_attempts'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'V48.001 stopped: application_attempts global mutation gate is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.matches'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'V48.001 stopped: matches global mutation gate is missing';
  END IF;
END;
$preflight$;

ALTER TABLE public.application_attempts
  ADD COLUMN participant_performer_ids uuid[],
  ADD COLUMN participant_snapshot_available boolean NOT NULL DEFAULT false,
  ADD COLUMN band_name_snapshot text,
  ADD COLUMN band_description_snapshot text,
  ADD COLUMN band_leader_performer_id_snapshot uuid,
  ADD COLUMN band_snapshot_available boolean NOT NULL DEFAULT false,
  ADD COLUMN snapshot_quarantine_reason text;

ALTER TABLE public.matches
  ADD COLUMN participant_snapshot_available boolean NOT NULL DEFAULT false,
  ADD COLUMN band_name_snapshot text,
  ADD COLUMN band_description_snapshot text,
  ADD COLUMN band_leader_performer_id_snapshot uuid,
  ADD COLUMN band_snapshot_available boolean NOT NULL DEFAULT false;

CREATE TABLE public.application_participant_claims (
  request_id uuid NOT NULL REFERENCES public.performance_requests(id) ON DELETE RESTRICT,
  performer_id uuid NOT NULL REFERENCES public.performers(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL,
  band_id uuid REFERENCES public.bands(id) ON DELETE RESTRICT,
  source text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, performer_id)
);

CREATE TABLE public.application_band_trade_history (
  request_id uuid NOT NULL REFERENCES public.performance_requests(id) ON DELETE RESTRICT,
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL,
  first_attempted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, band_id)
);

ALTER TABLE public.application_participant_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_band_trade_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_participant_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.application_band_trade_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.application_participant_claims TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.application_band_trade_history TO service_role;

CREATE TRIGGER trg_global_mutation_gate
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.application_participant_claims
FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_global_mutation_gate_trigger();
CREATE TRIGGER trg_global_mutation_gate
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.application_band_trade_history
FOR EACH STATEMENT EXECUTE FUNCTION public.acquire_global_mutation_gate_trigger();

-- Backfill only identity relationships that are historically exact.
-- A personal/direct-invite attempt names one exact performer. For a band attempt,
-- the roster at submission cannot be reconstructed from today's band_members;
-- those rows are deliberately NOT expanded into participant claims.
WITH exact_personal AS (
  SELECT DISTINCT ON (aa.request_id, aa.performer_id)
    aa.request_id, aa.performer_id, aa.application_id, aa.id AS attempt_id,
    aa.band_id, aa.source, aa.started_at
  FROM public.application_attempts aa
  WHERE aa.band_id IS NULL
  ORDER BY aa.request_id, aa.performer_id, aa.started_at, aa.id
)
INSERT INTO public.application_participant_claims (
  request_id, performer_id, application_id, attempt_id, band_id, source, claimed_at
)
SELECT request_id, performer_id, application_id, attempt_id, NULL, source, started_at
FROM exact_personal
ON CONFLICT (request_id, performer_id) DO NOTHING;

WITH exact_band AS (
  SELECT DISTINCT ON (aa.request_id, aa.band_id)
    aa.request_id, aa.band_id, aa.application_id, aa.id AS attempt_id, aa.started_at
  FROM public.application_attempts aa
  WHERE aa.band_id IS NOT NULL
  ORDER BY aa.request_id, aa.band_id, aa.started_at, aa.id
)
INSERT INTO public.application_band_trade_history (
  request_id, band_id, application_id, attempt_id, first_attempted_at
)
SELECT request_id, band_id, application_id, attempt_id, started_at
FROM exact_band
ON CONFLICT (request_id, band_id) DO NOTHING;

-- Existing band attempts are quarantined rather than assigned today's roster.
UPDATE public.application_attempts
SET snapshot_quarantine_reason = 'V48 migration: submission-time band roster is unavailable; do not infer from current membership'
WHERE band_id IS NOT NULL
  AND participant_snapshot_available = false;

-- Personal historical snapshots are exact because performer_id is stored on the attempt.
UPDATE public.application_attempts
SET participant_performer_ids = ARRAY[performer_id]::uuid[],
    participant_snapshot_available = true
WHERE band_id IS NULL
  AND participant_snapshot_available = false;

-- Existing personal matches can be safely represented as their single performer.
UPDATE public.matches
SET participant_performer_ids = ARRAY[performer_id]::uuid[],
    participant_count = 1,
    participant_snapshot_available = true
WHERE band_id IS NULL
  AND participant_snapshot_available = false;
-- Existing band matches retain their old match-time participant list but are not
-- misrepresented as submission-time snapshots.

CREATE OR REPLACE FUNCTION public.capture_application_attempt_participant_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_band public.bands%ROWTYPE;
  v_ids uuid[];
  v_count integer;
BEGIN
  IF NEW.band_id IS NULL THEN
    NEW.participant_performer_ids := ARRAY[NEW.performer_id]::uuid[];
    NEW.participant_snapshot_available := true;
    NEW.band_snapshot_available := false;
    RETURN NEW;
  END IF;

  SELECT * INTO v_band
  FROM public.bands b
  WHERE b.id = NEW.band_id
  FOR SHARE;
  IF NOT FOUND OR v_band.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION '応募時のバンド情報を確認できません';
  END IF;

  SELECT array_agg(bm.performer_id ORDER BY bm.joined_at NULLS LAST, bm.performer_id),
         count(*)::integer
  INTO v_ids, v_count
  FROM public.band_members bm
  WHERE bm.band_id = NEW.band_id AND bm.status = 'active';

  IF COALESCE(v_count, 0) < 1 OR NOT (NEW.performer_id = ANY(COALESCE(v_ids, ARRAY[]::uuid[]))) THEN
    RAISE EXCEPTION '応募時のバンド参加者またはリーダーを確認できません';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.band_members bm
    LEFT JOIN public.performers p ON p.id = bm.performer_id
    LEFT JOIN public.users u ON u.id = p.user_id
    WHERE bm.band_id = NEW.band_id AND bm.status = 'active'
      AND (p.id IS NULL OR u.id IS NULL OR u.account_status IS DISTINCT FROM 'active')
  ) THEN
    RAISE EXCEPTION 'バンドの活動中メンバー全員に有効なアカウントが必要です';
  END IF;

  NEW.participant_performer_ids := v_ids;
  NEW.participant_snapshot_available := true;
  NEW.band_name_snapshot := v_band.name;
  NEW.band_description_snapshot := v_band.description;
  NEW.band_leader_performer_id_snapshot := NEW.performer_id;
  NEW.band_snapshot_available := true;
  NEW.snapshot_quarantine_reason := NULL;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_application_attempt_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_performer_id uuid;
BEGIN
  IF NEW.band_id IS NOT NULL THEN
    INSERT INTO public.application_band_trade_history (
      request_id, band_id, application_id, attempt_id, first_attempted_at
    ) VALUES (
      NEW.request_id, NEW.band_id, NEW.application_id, NEW.id, NEW.started_at
    );
  END IF;

  FOREACH v_performer_id IN ARRAY NEW.participant_performer_ids LOOP
    INSERT INTO public.application_participant_claims (
      request_id, performer_id, application_id, attempt_id, band_id, source, claimed_at
    ) VALUES (
      NEW.request_id, v_performer_id, NEW.application_id, NEW.id,
      NEW.band_id, NEW.source, NEW.started_at
    );
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_application_attempt_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.participant_performer_ids IS DISTINCT FROM OLD.participant_performer_ids
     OR NEW.participant_snapshot_available IS DISTINCT FROM OLD.participant_snapshot_available
     OR NEW.band_name_snapshot IS DISTINCT FROM OLD.band_name_snapshot
     OR NEW.band_description_snapshot IS DISTINCT FROM OLD.band_description_snapshot
     OR NEW.band_leader_performer_id_snapshot IS DISTINCT FROM OLD.band_leader_performer_id_snapshot
     OR NEW.band_snapshot_available IS DISTINCT FROM OLD.band_snapshot_available THEN
    RAISE EXCEPTION '応募試行の参加者・バンドスナップショットは変更できません';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_application_attempt_snapshot_to_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.application_attempts%ROWTYPE;
  v_overlap boolean;
BEGIN
  SELECT aa.* INTO v_attempt
  FROM public.application_attempts aa
  WHERE aa.application_id = NEW.application_id
    AND aa.request_id = NEW.request_id
    AND aa.status = 'pending'
  ORDER BY aa.started_at DESC, aa.id DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_attempt.participant_snapshot_available IS DISTINCT FROM true
     OR COALESCE(cardinality(v_attempt.participant_performer_ids), 0) < 1 THEN
    RAISE EXCEPTION '応募時の参加者スナップショットがないためマッチングを成立できません';
  END IF;
  IF v_attempt.performer_id IS DISTINCT FROM NEW.performer_id
     OR v_attempt.band_id IS DISTINCT FROM NEW.band_id THEN
    RAISE EXCEPTION '応募試行とマッチング対象が一致しません';
  END IF;
  IF NEW.band_id IS NOT NULL AND v_attempt.band_snapshot_available IS DISTINCT FROM true THEN
    RAISE EXCEPTION '応募時のバンド情報がないためマッチングを成立できません';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.matches existing
    JOIN unnest(v_attempt.participant_performer_ids) AS participant(performer_id)
      ON participant.performer_id = ANY(CASE WHEN COALESCE(cardinality(existing.participant_performer_ids), 0) > 0 THEN existing.participant_performer_ids ELSE ARRAY[existing.performer_id]::uuid[] END)
    WHERE existing.request_id = NEW.request_id
      AND existing.status = 'active'
  ) INTO v_overlap;
  IF v_overlap THEN
    RAISE EXCEPTION 'この案件では参加者の重複マッチングはできません';
  END IF;

  NEW.participant_performer_ids := v_attempt.participant_performer_ids;
  NEW.participant_count := cardinality(v_attempt.participant_performer_ids);
  NEW.participant_snapshot_available := true;
  NEW.band_name_snapshot := v_attempt.band_name_snapshot;
  NEW.band_description_snapshot := v_attempt.band_description_snapshot;
  NEW.band_leader_performer_id_snapshot := v_attempt.band_leader_performer_id_snapshot;
  NEW.band_snapshot_available := v_attempt.band_snapshot_available;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_match_participant_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.participant_performer_ids IS DISTINCT FROM OLD.participant_performer_ids
     OR NEW.participant_count IS DISTINCT FROM OLD.participant_count
     OR NEW.participant_snapshot_available IS DISTINCT FROM OLD.participant_snapshot_available
     OR NEW.band_name_snapshot IS DISTINCT FROM OLD.band_name_snapshot
     OR NEW.band_description_snapshot IS DISTINCT FROM OLD.band_description_snapshot
     OR NEW.band_leader_performer_id_snapshot IS DISTINCT FROM OLD.band_leader_performer_id_snapshot
     OR NEW.band_snapshot_available IS DISTINCT FROM OLD.band_snapshot_available THEN
    RAISE EXCEPTION 'マッチング成立時の参加者・バンドスナップショットは変更できません';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_capture_application_attempt_participants ON public.application_attempts;
CREATE TRIGGER trg_capture_application_attempt_participants
BEFORE INSERT ON public.application_attempts
FOR EACH ROW EXECUTE FUNCTION public.capture_application_attempt_participant_snapshot();

DROP TRIGGER IF EXISTS trg_claim_application_attempt_participants ON public.application_attempts;
CREATE TRIGGER trg_claim_application_attempt_participants
AFTER INSERT ON public.application_attempts
FOR EACH ROW EXECUTE FUNCTION public.claim_application_attempt_participants();

DROP TRIGGER IF EXISTS trg_prevent_application_attempt_snapshot_mutation ON public.application_attempts;
CREATE TRIGGER trg_prevent_application_attempt_snapshot_mutation
BEFORE UPDATE ON public.application_attempts
FOR EACH ROW EXECUTE FUNCTION public.prevent_application_attempt_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_apply_application_attempt_snapshot_to_match ON public.matches;
CREATE TRIGGER trg_apply_application_attempt_snapshot_to_match
BEFORE INSERT ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.apply_application_attempt_snapshot_to_match();

DROP TRIGGER IF EXISTS trg_prevent_match_participant_snapshot_mutation ON public.matches;
CREATE TRIGGER trg_prevent_match_participant_snapshot_mutation
BEFORE UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.prevent_match_participant_snapshot_mutation();

-- Trigger functions are not application RPCs. Keep direct EXECUTE restricted.
REVOKE ALL ON FUNCTION public.capture_application_attempt_participant_snapshot() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_application_attempt_participants() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_application_attempt_snapshot_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_application_attempt_snapshot_to_match() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_match_participant_snapshot_mutation() FROM PUBLIC, anon, authenticated, service_role;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.application_attempts'::regclass
      AND tgname='trg_capture_application_attempt_participants' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.matches'::regclass
      AND tgname='trg_apply_application_attempt_snapshot_to_match' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'V48.001 postflight failed: snapshot triggers are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.application_attempts aa
    WHERE aa.band_id IS NOT NULL AND aa.status='pending'
      AND aa.participant_snapshot_available=false
  ) THEN
    RAISE NOTICE 'Existing pending band attempts are quarantined; acceptance is intentionally blocked until a valid submission snapshot exists.';
  END IF;
END;
$postflight$;

-- Acceptance uses the immutable submission-time roster rather than the current band roster.
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

  -- ⑤ 応募試行に保存された提出時点の参加者スナップショットを使用する。
  -- 採用時点のband_membersを再読込して応募条件を変化させない。
  IF v_attempt.participant_snapshot_available IS DISTINCT FROM true
     OR COALESCE(cardinality(v_attempt.participant_performer_ids), 0) < 1 THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '応募時の参加者スナップショットがないため採用できません。応募を再確認してください'::text;
    RETURN;
  END IF;

  IF v_attempt.band_id IS DISTINCT FROM v_application_band_id
     OR v_attempt.performer_id IS DISTINCT FROM v_application_performer_id THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '応募試行と応募内容が一致しません'::text;
    RETURN;
  END IF;

  IF v_application_band_id IS NOT NULL
     AND v_attempt.band_snapshot_available IS DISTINCT FROM true THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::integer,
      '応募時のバンド情報がないため採用できません'::text;
    RETURN;
  END IF;

  v_participant_performer_ids := v_attempt.participant_performer_ids;
  v_participant_count := cardinality(v_participant_performer_ids);

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
REVOKE ALL ON FUNCTION public.accept_application_with_coins(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_application_with_coins(uuid,uuid,uuid) TO service_role;

COMMIT;
