BEGIN;

SET LOCAL search_path TO pg_catalog, public, pg_temp;

-- All application RPC calls are made by server-side routes using service_role.
-- Do not leave SECURITY DEFINER functions executable by PUBLIC/anon/authenticated.
DO $acl$
DECLARE
  function_row record;
  app_function_signatures text[] := ARRAY[
    'accept_application_with_coins(uuid, uuid, uuid)',
    'accept_direct_invitation_atomic(uuid, uuid)',
    'acquire_global_mutation_gate_trigger()',
    'admin_grant_coins(uuid, integer, text, uuid, text)',
    'agree_completion_dispute(uuid, text)',
    'apply_to_lesson_offer(uuid, uuid, text)',
    'apply_to_performance_request(uuid, uuid, uuid, text, uuid)',
    'apply_to_performance_request_as_band(uuid, uuid, uuid, uuid, text)',
    'cancel_event_request_with_notification_outbox(uuid, uuid, uuid)',
    'cancel_event_request_with_refund(uuid, uuid)',
    'cancel_event_request_with_refund_internal(uuid, uuid, boolean)',
    'cancel_match_with_direct_invite_refund(uuid, uuid)',
    'cancel_match_with_notification_outbox(uuid, uuid, uuid, text)',
    'claim_line_notification_outbox(integer)',
    'claim_stripe_webhook_event(text, text)',
    'complete_line_notification_outbox(uuid)',
    'complete_match_with_fee(uuid, text)',
    'complete_stripe_coin_purchase(uuid, text, text, integer, text)',
    'configured_coin_fee(text, integer)',
    'configured_lesson_fee(integer)',
    'create_band_with_leader(uuid, text, text)',
    'create_facility_invitation_with_coins(uuid, uuid, uuid, text)',
    'create_lesson_offer(uuid, text, text, text[], text[], text, date, time without time zone, time without time zone, integer, integer)',
    'create_lesson_offer_with_levels(uuid, text, text, text[], text[], text, date, time without time zone, time without time zone, integer, integer, text[])',
    'create_lesson_offer_with_levels_and_address(uuid, text, text, text[], text[], text, date, time without time zone, time without time zone, integer, integer, text[], text)',
    'create_review_with_reward(uuid, uuid, uuid, integer, text)',
    'disband_band(uuid, uuid)',
    'enqueue_application_attempt_line_notifications()',
    'enqueue_band_invitation_line_notification()',
    'enqueue_completion_report_line_notifications()',
    'enqueue_lesson_application_line_notification()',
    'enqueue_lesson_offer_update_line_notifications()',
    'enqueue_line_notification(text, text, text)',
    'enqueue_match_completion_line_notifications()',
    'enqueue_match_established_line_notifications()',
    'expire_pending_application_attempts(integer)',
    'manage_completion_dispute_case(uuid, text, text, text)',
    'manage_stripe_payment_incident(uuid, text, text, text)',
    'register_completion_dispute(uuid, text, text, uuid)',
    'reject_direct_invitation_with_notification_outbox(uuid, uuid, uuid)',
    'reject_direct_invitation_with_refund(uuid, uuid)',
    'reject_direct_invitation_with_refund_for_withdrawal(uuid, uuid)',
    'respond_to_band_invitation(uuid, uuid, text)',
    'retry_line_notification_outbox(uuid, text)',
    'spend_coins(uuid, integer, text, text, text, uuid, uuid, uuid)',
    'spend_coins_legacy(uuid, integer, text, text, text, uuid, uuid, uuid)',
    'set_initial_coin_balance()',
    'submit_band_application_idempotent(uuid, uuid, uuid, uuid, uuid, text)',
    'submit_personal_application_idempotent(uuid, uuid, uuid, uuid, text)',
    'transfer_band_coins(uuid, uuid, uuid, integer, text, text)',
    'update_lesson_offer_with_levels(uuid, uuid, text, text, text[], text[], text, date, time without time zone, time without time zone, integer, integer, text[])',
    'withdraw_user_account(text)',
    'withdraw_user_account_with_notification_outbox(text)'
  ];
  -- These functions are introduced by the later Outbox hardening migration.
  -- They are accepted if present, but are not required before that migration.
  optional_outbox_signatures text[] := ARRAY[
    'bind_line_notification_outbox_recipient()',
    'guard_line_notification_outbox_identity_immutable()',
    'complete_line_notification_outbox(uuid, uuid)',
    'retry_line_notification_outbox(uuid, uuid, text)'
  ];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND NOT (
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
        = ANY (app_function_signatures)
        OR p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = ANY (optional_outbox_signatures)
      )
  ) THEN
    RAISE EXCEPTION 'Unreviewed SECURITY DEFINER signature exists in public; inspect it before applying ACL hardening';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(app_function_signatures) AS expected(signature)
    LEFT JOIN pg_proc AS p
      ON p.oid = to_regprocedure('public.' || expected.signature)
    WHERE p.oid IS NULL
       OR p.prosecdef IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'One or more reviewed signatures are missing or are not SECURITY DEFINER; inspect live definitions before applying ACL hardening';
  END IF;

  -- A SECURITY DEFINER search_path that includes public is safe only when
  -- untrusted API roles cannot create objects in that schema.
  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'anon/authenticated can CREATE in public; secure schema privileges before applying SECURITY DEFINER search_path hardening';
  END IF;

  FOR function_row IN
    SELECT p.oid::regprocedure AS function_signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n
      ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND (
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
        = ANY (app_function_signatures)
        OR p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = ANY (optional_outbox_signatures)
      )
  LOOP
    IF function_row.function_signature::oid = to_regprocedure('public.acquire_global_mutation_gate_trigger()')::oid THEN
      -- This trigger helper only calls pg_catalog functions. Keep public out
      -- of its search_path, matching the original hardened definition.
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path TO pg_catalog, pg_temp',
        function_row.function_signature
      );
    ELSE
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path TO pg_catalog, public, pg_temp',
        function_row.function_signature
      );
    END IF;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_row.function_signature
    );

    IF function_row.function_signature::oid NOT IN (
      to_regprocedure('public.acquire_global_mutation_gate_trigger()')::oid,
      COALESCE(to_regprocedure('public.bind_line_notification_outbox_recipient()')::oid, 0::oid),
      COALESCE(to_regprocedure('public.guard_line_notification_outbox_identity_immutable()')::oid, 0::oid),
      to_regprocedure('public.set_initial_coin_balance()')::oid,
      to_regprocedure('public.enqueue_application_attempt_line_notifications()')::oid,
      to_regprocedure('public.enqueue_band_invitation_line_notification()')::oid,
      to_regprocedure('public.enqueue_completion_report_line_notifications()')::oid,
      to_regprocedure('public.enqueue_lesson_application_line_notification()')::oid,
      to_regprocedure('public.enqueue_lesson_offer_update_line_notifications()')::oid,
      to_regprocedure('public.enqueue_match_completion_line_notifications()')::oid,
      to_regprocedure('public.enqueue_match_established_line_notifications()')::oid
    ) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO service_role',
        function_row.function_signature
      );
    END IF;
  END LOOP;
END;
$acl$;

COMMIT;
