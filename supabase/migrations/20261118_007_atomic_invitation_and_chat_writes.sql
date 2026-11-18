-- Hakotohito: atomic authorization + read/write RPCs for invitations and chat
-- Candidate only. Depends on global mutation gate migration 009 and the
-- band-invitation notification outbox triggers from migration 022.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NULL THEN
    RAISE EXCEPTION 'Global mutation gate helper is missing';
  END IF;
  IF position('pg_advisory_xact_lock(2147483000, 20261116)' IN
       pg_get_functiondef(to_regprocedure('public.acquire_global_mutation_gate_trigger()'))) = 0 THEN
    RAISE EXCEPTION 'Global mutation gate helper does not use the expected shared advisory lock';
  END IF;
  IF to_regclass('public.bands') IS NULL OR to_regclass('public.band_members') IS NULL
     OR to_regclass('public.band_invitations') IS NULL OR to_regclass('public.band_messages') IS NULL
     OR to_regclass('public.matches') IS NULL OR to_regclass('public.conversations') IS NULL
     OR to_regclass('public.messages') IS NULL OR to_regclass('public.users') IS NULL
     OR to_regclass('public.performers') IS NULL OR to_regclass('public.performance_requests') IS NULL
     OR to_regclass('public.facilities') IS NULL THEN
    RAISE EXCEPTION 'One or more required invitation/chat tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.bands'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.band_invitations'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.band_messages'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.conversations'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.performers'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.band_members'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.matches'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.performance_requests'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.facilities'::regclass
      AND tgname='trg_global_mutation_gate' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.acquire_global_mutation_gate_trigger()')) THEN
    RAISE EXCEPTION 'Global mutation gate triggers are missing from one or more target tables';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid='public.conversations'::regclass
      AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
      AND i.indnkeyatts=1 AND pg_get_indexdef(i.indexrelid) ILIKE '%(match_id)%'
  ) THEN
    RAISE EXCEPTION 'A non-partial unique index on conversations(match_id) is required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('users','id'),('users','account_status'),('users','user_type'),('users','line_user_id'),('users','display_name'),('users','picture_url'),
      ('performers','id'),('performers','user_id'),('performers','name'),
      ('bands','id'),('bands','status'),('bands','name'),
      ('band_members','band_id'),('band_members','performer_id'),('band_members','status'),('band_members','role'),
      ('band_invitations','band_id'),('band_invitations','inviter_performer_id'),('band_invitations','invitee_performer_id'),('band_invitations','message'),('band_invitations','status'),('band_invitations','created_at'),
      ('band_messages','id'),('band_messages','band_id'),('band_messages','sender_performer_id'),('band_messages','message'),('band_messages','created_at'),
      ('matches','id'),('matches','status'),('matches','performance_status'),('matches','request_id'),('matches','performer_id'),('matches','band_id'),
      ('performance_requests','id'),('performance_requests','facility_id'),
      ('facilities','id'),('facilities','user_id'),
      ('conversations','id'),('conversations','match_id'),
      ('messages','id'),('messages','conversation_id'),('messages','sender_id'),('messages','message'),('messages','read_at'),('messages','created_at')
    ) AS required(table_name,column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=required.table_name
     AND c.column_name=required.column_name
    WHERE c.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more required columns for atomic invitation/chat RPCs are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.band_invitations'::regclass
      AND tgname='trg_enqueue_band_invitation_created_line_notification' AND NOT tgisinternal AND tgenabled <> 'D'
      AND tgfoid=to_regprocedure('public.enqueue_band_invitation_line_notification()')) THEN
    RAISE EXCEPTION 'Band invitation creation notification outbox trigger is missing';
  END IF;
  IF to_regprocedure('public.create_band_invitation_atomic(uuid,uuid,uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.send_band_chat_message_atomic(uuid,uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.send_match_chat_message_atomic(uuid,uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.get_band_chat_messages_atomic(uuid,uuid,text)') IS NOT NULL
     OR to_regprocedure('public.get_match_chat_page_atomic(uuid,uuid,boolean,timestamptz,uuid,integer,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'One or more atomic invitation/chat RPCs already exist; inspect before applying';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.create_band_invitation_atomic(
  p_inviter_performer_id uuid,
  p_band_id uuid,
  p_invitee_performer_id uuid,
  p_message text,
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_band public.bands%ROWTYPE;
  v_invitation public.band_invitations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);

  IF p_inviter_performer_id IS NULL OR p_band_id IS NULL OR p_invitee_performer_id IS NULL
     OR p_inviter_performer_id = p_invitee_performer_id
     OR NULLIF(btrim(COALESCE(p_line_user_id, '')), '') IS NULL
     OR char_length(COALESCE(p_message, '')) > 500 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'invalid_input');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.performers p JOIN public.users u ON u.id=p.user_id
    WHERE p.id=p_inviter_performer_id AND u.account_status='active'
      AND u.user_type='performer' AND u.line_user_id=p_line_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'inviter_inactive');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.performers p JOIN public.users u ON u.id=p.user_id
    WHERE p.id=p_invitee_performer_id AND u.account_status='active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'invitee_not_found');
  END IF;

  SELECT * INTO v_band FROM public.bands WHERE id=p_band_id FOR UPDATE;
  IF NOT FOUND OR v_band.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'band_not_active');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.band_members
    WHERE band_id=p_band_id AND performer_id=p_inviter_performer_id
      AND status='active' AND role='leader'
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_active_leader');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.band_members
    WHERE band_id=p_band_id AND performer_id=p_invitee_performer_id AND status='active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'already_member');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.band_invitations
    WHERE band_id=p_band_id AND invitee_performer_id=p_invitee_performer_id AND status='pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'pending_invitation');
  END IF;

  BEGIN
    INSERT INTO public.band_invitations (
      band_id, inviter_performer_id, invitee_performer_id, message, status
    ) VALUES (
      p_band_id, p_inviter_performer_id, p_invitee_performer_id,
      NULLIF(btrim(COALESCE(p_message, '')), ''), 'pending'
    ) RETURNING * INTO v_invitation;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'pending_invitation');
  END;

  RETURN jsonb_build_object(
    'success', true,
    'invitation', jsonb_build_object(
      'id', v_invitation.id, 'status', v_invitation.status,
      'created_at', v_invitation.created_at
    ),
    'band', jsonb_build_object('id', v_band.id, 'name', v_band.name)
  );
END;
$function$;

CREATE FUNCTION public.send_band_chat_message_atomic(
  p_band_id uuid,
  p_sender_performer_id uuid,
  p_message text,
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_band public.bands%ROWTYPE;
  v_message public.band_messages%ROWTYPE;
  v_sender_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  IF p_band_id IS NULL OR p_sender_performer_id IS NULL
     OR NULLIF(btrim(COALESCE(p_message, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_line_user_id, '')), '') IS NULL
     OR char_length(p_message) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'invalid_input');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.performers p JOIN public.users u ON u.id=p.user_id
    WHERE p.id=p_sender_performer_id AND u.account_status='active'
      AND u.line_user_id=p_line_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'sender_inactive');
  END IF;
  SELECT * INTO v_band FROM public.bands WHERE id=p_band_id FOR UPDATE;
  IF NOT FOUND OR v_band.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'band_not_active');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.band_members
    WHERE band_id=p_band_id AND performer_id=p_sender_performer_id AND status='active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_active_member');
  END IF;
  SELECT name INTO v_sender_name FROM public.performers WHERE id=p_sender_performer_id;
  INSERT INTO public.band_messages (band_id, sender_performer_id, message)
  VALUES (p_band_id, p_sender_performer_id, btrim(p_message))
  RETURNING * INTO v_message;

  RETURN jsonb_build_object('success', true, 'message', jsonb_build_object(
    'id', v_message.id, 'band_id', v_message.band_id,
    'sender_performer_id', v_message.sender_performer_id,
    'sender_name', COALESCE(v_sender_name, '自分'),
    'message', v_message.message, 'created_at', v_message.created_at
  ));
END;
$function$;

CREATE FUNCTION public.send_match_chat_message_atomic(
  p_match_id uuid,
  p_user_id uuid,
  p_message text,
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_match public.matches%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_conversation_id uuid;
  v_message_row public.messages%ROWTYPE;
  v_display_name text;
  v_picture_url text;
  v_is_authorized boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  IF p_match_id IS NULL OR p_user_id IS NULL
     OR NULLIF(btrim(COALESCE(p_message, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_line_user_id, '')), '') IS NULL
     OR char_length(p_message) > 1000 THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'invalid_input');
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id=p_user_id;
  IF NOT FOUND OR v_user.account_status <> 'active'
     OR v_user.line_user_id IS DISTINCT FROM p_line_user_id THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'user_inactive');
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id=p_match_id;
  IF NOT FOUND OR v_match.status <> 'active'
     OR v_match.performance_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'match_unavailable');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.performance_requests pr
    JOIN public.facilities f ON f.id=pr.facility_id
    WHERE pr.id=v_match.request_id AND f.user_id=p_user_id
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    IF v_match.band_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.band_members bm
        JOIN public.performers p ON p.id=bm.performer_id
        WHERE bm.band_id=v_match.band_id AND bm.status='active'
          AND bm.role='leader' AND p.user_id=p_user_id
      ) INTO v_is_authorized;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.performers p
        WHERE p.id=v_match.performer_id AND p.user_id=p_user_id
      ) INTO v_is_authorized;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_authorized');
  END IF;

  INSERT INTO public.conversations (match_id)
  VALUES (p_match_id)
  ON CONFLICT (match_id) DO NOTHING;
  SELECT id INTO v_conversation_id
  FROM public.conversations WHERE match_id=p_match_id;
  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Conversation could not be created';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, message)
  VALUES (v_conversation_id, p_user_id, btrim(p_message))
  RETURNING * INTO v_message_row;

  SELECT display_name, picture_url INTO v_display_name, v_picture_url
  FROM public.users WHERE id=p_user_id;

  RETURN jsonb_build_object('success', true, 'message', jsonb_build_object(
    'id', v_message_row.id, 'message', v_message_row.message,
    'read_at', v_message_row.read_at, 'created_at', v_message_row.created_at,
    'users', jsonb_build_object('display_name', v_display_name, 'picture_url', v_picture_url)
  ));
END;
$function$;

CREATE FUNCTION public.get_band_chat_messages_atomic(
  p_band_id uuid,
  p_sender_performer_id uuid,
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_band public.bands%ROWTYPE;
  v_result jsonb;
BEGIN
  -- This endpoint is read-only: share the global gate so readers can coexist.
  -- All public-table writers take the exclusive gate before changing membership/band state.
  PERFORM pg_advisory_xact_lock_shared(2147483000, 20261116);
  IF p_band_id IS NULL OR p_sender_performer_id IS NULL
     OR NULLIF(btrim(COALESCE(p_line_user_id, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'invalid_input');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.performers p JOIN public.users u ON u.id=p.user_id
    WHERE p.id=p_sender_performer_id AND u.account_status='active'
      AND u.line_user_id=p_line_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'user_inactive');
  END IF;

  SELECT * INTO v_band FROM public.bands WHERE id=p_band_id FOR SHARE;
  IF NOT FOUND OR v_band.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'band_not_active');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.band_members
    WHERE band_id=p_band_id AND performer_id=p_sender_performer_id AND status='active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_active_member');
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'band', jsonb_build_object('id', v_band.id, 'name', v_band.name),
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page.id,
        'bandId', page.band_id,
        'senderPerformerId', page.sender_performer_id,
        'senderName', COALESCE(page.sender_name, '不明な演奏者'),
        'message', page.message,
        'createdAt', page.created_at,
        'isMine', page.sender_performer_id = p_sender_performer_id
      ) ORDER BY page.created_at ASC, page.id ASC)
      FROM (
        SELECT bm.id, bm.band_id, bm.sender_performer_id, bm.message, bm.created_at,
               p.name AS sender_name
        FROM public.band_messages bm
        LEFT JOIN public.performers p ON p.id=bm.sender_performer_id
        WHERE bm.band_id=p_band_id
        ORDER BY bm.created_at DESC, bm.id DESC
        LIMIT 100
      ) page
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE FUNCTION public.get_match_chat_page_atomic(
  p_match_id uuid,
  p_user_id uuid,
  p_summary boolean,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_page_size integer,
  p_line_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user public.users%ROWTYPE;
  v_match public.matches%ROWTYPE;
  v_conversation_id uuid;
  v_authorized boolean := false;
  v_unread_count bigint := 0;
  v_messages jsonb := '[]'::jsonb;
  v_has_more boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(2147483000, 20261116);
  IF p_match_id IS NULL OR p_user_id IS NULL
     OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100
     OR NULLIF(btrim(COALESCE(p_line_user_id, '')), '') IS NULL
     OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL))
     OR (COALESCE(p_summary, false) AND p_before_created_at IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'invalid_input');
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id=p_user_id;
  IF NOT FOUND OR v_user.account_status <> 'active'
     OR v_user.line_user_id IS DISTINCT FROM p_line_user_id THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'user_inactive');
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id=p_match_id;
  IF NOT FOUND OR v_match.status <> 'active'
     OR v_match.performance_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'match_unavailable');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.performance_requests pr
    JOIN public.facilities f ON f.id=pr.facility_id
    WHERE pr.id=v_match.request_id AND f.user_id=p_user_id
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    IF v_match.band_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.band_members bm
        JOIN public.performers p ON p.id=bm.performer_id
        WHERE bm.band_id=v_match.band_id AND bm.status='active'
          AND bm.role='leader' AND p.user_id=p_user_id
      ) INTO v_authorized;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.performers p
        WHERE p.id=v_match.performer_id AND p.user_id=p_user_id
      ) INTO v_authorized;
    END IF;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('success', false, 'errorCode', 'not_authorized');
  END IF;

  INSERT INTO public.conversations (match_id)
  VALUES (p_match_id)
  ON CONFLICT (match_id) DO NOTHING;
  SELECT id INTO v_conversation_id
  FROM public.conversations WHERE match_id=p_match_id;
  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Conversation could not be created';
  END IF;

  IF COALESCE(p_summary, false) THEN
    SELECT COUNT(*) INTO v_unread_count
    FROM public.messages
    WHERE conversation_id=v_conversation_id
      AND sender_id <> p_user_id AND read_at IS NULL;
    RETURN jsonb_build_object('success', true, 'unreadCount', v_unread_count);
  END IF;

  IF p_before_created_at IS NULL THEN
    UPDATE public.messages
    SET read_at=now()
    WHERE conversation_id=v_conversation_id
      AND sender_id <> p_user_id AND read_at IS NULL;
  END IF;

  WITH page AS (
    SELECT m.id, m.sender_id, m.message, m.read_at, m.created_at,
           u.id AS joined_user_id, u.display_name, u.picture_url,
           row_number() OVER (ORDER BY m.created_at DESC, m.id DESC) AS rn
    FROM public.messages m
    LEFT JOIN public.users u ON u.id=m.sender_id
    WHERE m.conversation_id=v_conversation_id
      AND (p_before_created_at IS NULL
        OR (m.created_at, m.id) < (p_before_created_at, p_before_id))
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT p_page_size + 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', page.id,
      'message', page.message,
      'read_at', page.read_at,
      'created_at', page.created_at,
      'isMine', page.sender_id=p_user_id,
      'users', CASE WHEN page.joined_user_id IS NULL THEN NULL
        ELSE jsonb_build_object('display_name', page.display_name, 'picture_url', page.picture_url) END
    ) ORDER BY page.created_at ASC, page.id ASC) FILTER (WHERE page.rn <= p_page_size), '[]'::jsonb),
    COALESCE(bool_or(page.rn > p_page_size), false)
  INTO v_messages, v_has_more
  FROM page;

  RETURN jsonb_build_object('success', true, 'messages', v_messages, 'hasMore', v_has_more);
END;
$function$;

ALTER FUNCTION public.create_band_invitation_atomic(uuid,uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.send_band_chat_message_atomic(uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.send_match_chat_message_atomic(uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.get_band_chat_messages_atomic(uuid,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.get_match_chat_page_atomic(uuid,uuid,boolean,timestamptz,uuid,integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_band_invitation_atomic(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_band_chat_message_atomic(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_match_chat_message_atomic(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_band_chat_messages_atomic(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_match_chat_page_atomic(uuid,uuid,boolean,timestamptz,uuid,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_band_invitation_atomic(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_band_chat_message_atomic(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.send_match_chat_message_atomic(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_band_chat_messages_atomic(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_match_chat_page_atomic(uuid,uuid,boolean,timestamptz,uuid,integer,text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
