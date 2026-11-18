-- READ ONLY: capture the same aggregate snapshot before and after each
-- controlled LINE test scenario. No writes; no LINE IDs or user names returned.
-- Run only after the relevant candidate migrations have been applied.

-- 1. Snapshot header and target database.
SELECT current_database() AS database_name,
       current_user AS execution_role,
       now() AS captured_at,
       current_setting('server_version') AS postgres_version;

-- 2. Hakotohito migration-stage markers. Supabase internal histories such as
-- auth.schema_migrations, realtime.schema_migrations and storage.migrations are
-- platform-managed and are NOT this app's SQL migration history. Record each
-- migration filename and successful COMMIT manually in PUBLIC_RELEASE_CHECKLIST.
SELECT marker, present
FROM (VALUES
  ('global_mutation_gate_function', to_regprocedure('public.acquire_global_mutation_gate_trigger()') IS NOT NULL),
  ('application_attempts_table', to_regclass('public.application_attempts') IS NOT NULL),
  ('line_notification_outbox_table', to_regclass('public.line_notification_outbox') IS NOT NULL),
  ('outbox_recipient_user_id_column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='line_notification_outbox' AND column_name='recipient_user_id')),
  ('outbox_lease_token_column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='line_notification_outbox' AND column_name='lease_token')),
  ('withdrawal_outbox_wrapper', to_regprocedure('public.withdraw_user_account_with_notification_outbox(text)') IS NOT NULL),
  ('lease_token_complete_rpc', to_regprocedure('public.complete_line_notification_outbox(uuid,uuid)') IS NOT NULL),
  ('lease_token_retry_rpc', to_regprocedure('public.retry_line_notification_outbox(uuid,uuid,text)') IS NOT NULL),
  ('legacy_complete_rpc', to_regprocedure('public.complete_line_notification_outbox(uuid)') IS NOT NULL),
  ('legacy_retry_rpc', to_regprocedure('public.retry_line_notification_outbox(uuid,text)') IS NOT NULL)
) AS markers(marker, present)
ORDER BY marker;

-- 3. Account counts; intentionally excludes LINE IDs and names.
SELECT user_type, account_status, COUNT(*) AS account_count
FROM public.users
GROUP BY user_type, account_status
ORDER BY user_type, account_status;

-- 4. Performance request counts.
SELECT request_type, status, COUNT(*) AS request_count
FROM public.performance_requests
GROUP BY request_type, status
ORDER BY request_type, status;

-- 5. Application lifecycle counts.
SELECT source, status, COUNT(*) AS application_count
FROM public.applications
GROUP BY source, status
ORDER BY source, status;

-- 6. Application-attempt lifecycle counts.
SELECT source, status, COUNT(*) AS attempt_count,
       COUNT(*) FILTER (WHERE expires_at <= now() AND status = 'pending') AS overdue_pending_count
FROM public.application_attempts
GROUP BY source, status
ORDER BY source, status;

-- 7. Match and dispute counts.
SELECT status, performance_status,
       (completion_disputed_at IS NOT NULL) AS has_open_dispute,
       COUNT(*) AS match_count
FROM public.matches
GROUP BY status, performance_status, (completion_disputed_at IS NOT NULL)
ORDER BY status, performance_status, has_open_dispute;

-- 8. Coin ledger aggregate by transaction type. No account identifiers.
SELECT transaction_type,
       COUNT(*) AS transaction_count,
       SUM(amount) AS net_amount,
       SUM(amount) FILTER (WHERE amount < 0) AS debited_amount,
       SUM(amount) FILTER (WHERE amount > 0) AS credited_amount
FROM public.coin_transactions
GROUP BY transaction_type
ORDER BY transaction_type;

-- 9. Outbox aggregate by event family and delivery status.
SELECT split_part(event_key, ':', 1) AS event_family,
       status,
       COUNT(*) AS row_count,
       MIN(created_at) AS oldest_created_at,
       MAX(created_at) AS newest_created_at,
       MAX(attempt_count) AS max_attempt_count
FROM public.line_notification_outbox
GROUP BY split_part(event_key, ':', 1), status
ORDER BY event_family, status;

-- 10. Outbox backlog health. A non-zero processing count should be investigated
-- before retiring legacy acknowledgements; pending rows are expected only when
-- they are waiting for their next retry/drain.
SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
       COUNT(*) FILTER (WHERE status = 'processing') AS processing_count,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
       COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
       MIN(created_at) FILTER (WHERE status IN ('pending', 'processing')) AS oldest_unsent_created_at,
       MAX(attempt_count) FILTER (WHERE status IN ('pending', 'processing', 'failed')) AS max_attempt_count
FROM public.line_notification_outbox;

-- 11. Lesson lifecycle counts.
SELECT status, COUNT(*) AS lesson_application_count
FROM public.lesson_applications
GROUP BY status
ORDER BY status;

SELECT status, COUNT(*) AS lesson_offer_count
FROM public.lesson_offers
GROUP BY status
ORDER BY status;

-- 12. Band lifecycle counts.
SELECT status, COUNT(*) AS band_count
FROM public.bands
GROUP BY status
ORDER BY status;

SELECT role, status, COUNT(*) AS membership_count
FROM public.band_members
GROUP BY role, status
ORDER BY role, status;

SELECT status, COUNT(*) AS invitation_count
FROM public.band_invitations
GROUP BY status
ORDER BY status;

-- 13. Stripe is disabled for limited release; only aggregate state is shown.
SELECT coin_purchase_enabled
FROM public.payment_feature_settings
WHERE id = 1;

SELECT payment_type, status, COUNT(*) AS order_count
FROM public.payment_orders
GROUP BY payment_type, status
ORDER BY payment_type, status;
