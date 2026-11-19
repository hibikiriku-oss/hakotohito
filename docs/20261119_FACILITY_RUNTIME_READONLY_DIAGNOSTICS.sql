-- Hakotohito 2026-11-19 facility smoke-test diagnostics
-- READ ONLY. Run against the explicitly verified Tokyo Supabase project.
-- Do not use Supabase internal migration-history tables as the app migration ledger.
-- Each section is an independent SELECT; no INSERT/UPDATE/DELETE/DDL is performed.

-- Q1: Schema markers for facility request create/list behavior and limited-release coin purchase.
SELECT
  required.table_name,
  required.column_name,
  c.data_type,
  CASE WHEN c.column_name IS NULL THEN false ELSE true END AS present
FROM (VALUES
  ('performance_requests','venue_address'),
  ('payment_feature_settings','coin_purchase_enabled')
) AS required(table_name,column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema='public'
 AND c.table_name=required.table_name
 AND c.column_name=required.column_name
ORDER BY c.table_name, c.column_name;

-- Q2: Required RPC existence and direct-invitation fee timing markers.
-- expected: create_facility_invitation_with_coins exists, writes application_attempts,
-- checks balance, and does NOT call public.spend_coins directly.
-- expected: accept_direct_invitation_atomic exists and performs the match-time charge.
WITH routines AS (
  SELECT * FROM (VALUES
    ('public.delete_open_performance_request_atomic(uuid,uuid,text)'),
    ('public.create_facility_invitation_with_coins(uuid,uuid,uuid,text)'),
    ('public.accept_direct_invitation_atomic(uuid,uuid)')
  ) AS v(signature)
), resolved AS (
  SELECT signature, to_regprocedure(signature) AS routine_oid
  FROM routines
), definitions AS (
  SELECT signature, routine_oid,
    CASE WHEN routine_oid IS NULL THEN NULL ELSE pg_get_functiondef(routine_oid) END AS definition
  FROM resolved
)
SELECT
  signature,
  routine_oid IS NOT NULL AS exists,
  CASE WHEN definition IS NULL THEN NULL
       ELSE position('INSERT INTO public.application_attempts' IN definition) > 0 END
    AS inserts_application_attempt,
  CASE WHEN definition IS NULL THEN NULL
       ELSE position('FROM public.spend_coins(' IN definition) > 0 END
    AS directly_calls_spend_coins,
  CASE WHEN definition IS NULL THEN NULL
       ELSE position('direct_invite_match_fee:' IN definition) > 0 END
    AS has_match_time_fee_key,
  CASE WHEN definition IS NULL THEN NULL
       ELSE position('coin_balance' IN definition) > 0 END
    AS references_coin_balance,
  CASE WHEN definition IS NULL THEN NULL ELSE md5(definition) END AS definition_md5
FROM definitions
ORDER BY signature;

-- Q3: Application-attempt notification trigger presence and enabled state.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  p.proname AS trigger_function
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public'
  AND c.relname='application_attempts'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- Q4: Outbox table existence marker (safe even when the table is absent).
SELECT to_regclass('public.line_notification_outbox') IS NOT NULL
  AS line_notification_outbox_exists;

-- Q5: Run only if Q4 reports true. Counts only; no recipient IDs or payloads.
SELECT status, count(*) AS row_count,
       min(created_at) AS oldest_created_at,
       max(sent_at) AS newest_sent_at
FROM public.line_notification_outbox
GROUP BY status
ORDER BY status;

-- Q6: Direct-invitation fee ledger shape for the recent test window.
-- Match-time charging should normally have match_id populated. A NULL match_id
-- can indicate an old send-time charge or legacy data; correlate with timestamps
-- and application_attempts before drawing a conclusion.
SELECT
  transaction_type,
  (match_id IS NULL) AS match_id_is_null,
  (application_id IS NULL) AS application_id_is_null,
  count(*) AS transaction_count,
  sum(amount) AS total_amount,
  min(created_at) AS first_created_at,
  max(created_at) AS last_created_at
FROM public.coin_transactions
WHERE transaction_type='direct_invite_fee'
  AND created_at >= now() - interval '14 days'
GROUP BY transaction_type, (match_id IS NULL), (application_id IS NULL)
ORDER BY match_id_is_null DESC, application_id_is_null DESC;

-- Q7: Limited-release purchase switch (expected false).
SELECT id, coin_purchase_enabled
FROM public.payment_feature_settings
WHERE id=1;
