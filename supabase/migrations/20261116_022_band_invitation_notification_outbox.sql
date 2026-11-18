-- Enqueue band invitation create/response notices transactionally.
-- Candidate only; requires migration 014 and the existing band invitation schema.
BEGIN;
SELECT pg_advisory_xact_lock(2147483000, 20261116);

DO $preflight$
BEGIN
  IF to_regclass('public.line_notification_outbox') IS NULL
     OR to_regclass('public.band_invitations') IS NULL
     OR to_regclass('public.band_members') IS NULL THEN
    RAISE EXCEPTION 'Required band invitation/outbox objects are missing';
  END IF;
  IF to_regprocedure('public.enqueue_band_invitation_line_notification()') IS NOT NULL THEN
    RAISE EXCEPTION 'Band invitation notification function already exists';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enqueue_band_invitation_line_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_band_name text;
  v_sender_name text;
  v_invitee_name text;
  v_recipient_user_id uuid;
  v_text text;
  v_event_key text;
BEGIN
  SELECT COALESCE(NULLIF(b.name, ''), 'バンド')
  INTO v_band_name
  FROM public.bands b WHERE b.id = NEW.band_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
    SELECT p.user_id, COALESCE(NULLIF(p.name, ''), NULLIF(u.display_name, ''), '演奏者')
    INTO v_recipient_user_id, v_sender_name
    FROM public.performers p JOIN public.users u ON u.id = p.user_id
    WHERE p.id = NEW.invitee_performer_id AND u.account_status = 'active';
    IF v_recipient_user_id IS NULL THEN RETURN NEW; END IF;
    v_text := 'バンドへの参加依頼が届きました。バンド：' || COALESCE(v_band_name, 'バンド') ||
      CASE WHEN NULLIF(NEW.message, '') IS NOT NULL THEN E'\nメッセージ：' || NEW.message ELSE '' END ||
      E'\nLINEミニアプリのバンド招待一覧からご確認ください。';
    v_event_key := 'band_invitation_created:' || NEW.id::text || ':' || v_recipient_user_id::text;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM 'pending'
       OR NEW.status NOT IN ('accepted', 'rejected') THEN
      RETURN NEW;
    END IF;
    SELECT p.user_id, COALESCE(NULLIF(p.name, ''), NULLIF(u.display_name, ''), '演奏者')
    INTO v_recipient_user_id, v_invitee_name
    FROM public.performers p JOIN public.users u ON u.id = p.user_id
    WHERE p.id = NEW.inviter_performer_id AND u.account_status = 'active';
    IF v_recipient_user_id IS NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(NULLIF(p.name, ''), NULLIF(u.display_name, ''), '演奏者')
    INTO v_sender_name
    FROM public.performers p JOIN public.users u ON u.id = p.user_id
    WHERE p.id = NEW.invitee_performer_id;
    v_text := COALESCE(v_sender_name, '演奏者') || 'さんがバンド「' ||
      COALESCE(v_band_name, 'バンド') || '」への参加依頼を' ||
      CASE WHEN NEW.status = 'accepted' THEN '承認' ELSE '辞退' END || 'しました。';
    v_event_key := 'band_invitation_response:' || NEW.id::text || ':' || NEW.status || ':' || v_recipient_user_id::text;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.line_notification_outbox(event_key, recipient_line_user_id, messages)
  SELECT v_event_key, u.line_user_id,
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))
  FROM public.users u
  WHERE u.id = v_recipient_user_id
    AND u.account_status = 'active'
    AND NULLIF(u.line_user_id, '') IS NOT NULL
  ON CONFLICT (event_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enqueue_band_invitation_line_notification() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_band_invitation_line_notification() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enqueue_band_invitation_created_line_notification
AFTER INSERT ON public.band_invitations
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_band_invitation_line_notification();

CREATE TRIGGER trg_enqueue_band_invitation_response_line_notification
AFTER UPDATE OF status ON public.band_invitations
FOR EACH ROW
WHEN (OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected'))
EXECUTE FUNCTION public.enqueue_band_invitation_line_notification();

COMMIT;
