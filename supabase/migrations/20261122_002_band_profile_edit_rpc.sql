-- V48.002: leader-only atomic band name/description editing.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

CREATE OR REPLACE FUNCTION public.update_band_profile(
  p_band_id uuid,
  p_performer_id uuid,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_band public.bands%ROWTYPE;
BEGIN
  IF p_band_id IS NULL OR p_performer_id IS NULL
     OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 100
     OR (p_description IS NOT NULL AND char_length(p_description) > 1000) THEN
    RETURN jsonb_build_object('success', false, 'error', 'バンド名または紹介文の入力内容が正しくありません');
  END IF;

  SELECT p.user_id INTO v_user_id
  FROM public.performers p
  WHERE p.id = p_performer_id;
  IF NOT FOUND OR v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id=v_user_id AND u.account_status='active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '有効な演奏者アカウントが必要です');
  END IF;

  SELECT * INTO v_band
  FROM public.bands b
  WHERE b.id=p_band_id AND b.status='active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '活動中のバンドが見つかりません');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.band_members bm
    WHERE bm.band_id=p_band_id AND bm.performer_id=p_performer_id
      AND bm.role='leader' AND bm.status='active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'バンド情報を編集できるのはリーダーだけです');
  END IF;

  UPDATE public.bands
  SET name=btrim(p_name),
      description=NULLIF(btrim(COALESCE(p_description,'')),''),
      updated_at=now()
  WHERE id=p_band_id;

  SELECT * INTO v_band FROM public.bands WHERE id=p_band_id;
  RETURN jsonb_build_object(
    'success', true,
    'band', jsonb_build_object('id',v_band.id,'name',v_band.name,'description',v_band.description)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_band_profile(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_band_profile(uuid,uuid,text,text) TO service_role;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='update_band_profile'
      AND pg_get_function_identity_arguments(p.oid)='p_band_id uuid, p_performer_id uuid, p_name text, p_description text'
  ) THEN
    RAISE EXCEPTION 'V48.002 postflight failed: update_band_profile RPC is missing';
  END IF;
END;
$postflight$;

COMMIT;
