-- Hakotohito V48 Stage 0 schema-presence check
-- READ ONLY: catalog access only. No table data, RPC calls, DDL, DML, or balance changes.
-- Run this single statement first against the confirmed target Supabase project.

WITH expected(table_name, expected_columns) AS (
  VALUES
    ('coin_transactions', ARRAY['id','user_id','amount','transaction_type','request_id','application_id','match_id','idempotency_key','created_at']::text[]),
    ('users', ARRAY['id','coin_balance','account_status']::text[]),
    ('matches', ARRAY['id','request_id','application_id','status','performance_status','completed_at']::text[]),
    ('performance_requests', ARRAY['id','request_type','reward']::text[]),
    ('applications', ARRAY['id','request_id','performer_id','status']::text[]),
    ('application_attempts', ARRAY['id','request_id','application_id','band_id','fee_amount','match_id','status']::text[]),
    ('match_fee_snapshots', ARRAY['match_id','request_id','application_id','fee_kind','payer_user_id','fee_amount_coins','coin_transaction_id','charged_at']::text[]),
    ('lesson_fee_snapshots', ARRAY['lesson_application_id','payer_user_id','fee_amount_coins','coin_transaction_id']::text[]),
    ('lesson_applications', ARRAY['id','offer_id','teacher_user_id','status']::text[])
)
SELECT e.table_name,
       to_regclass(format('public.%I', e.table_name)) IS NOT NULL AS table_exists,
       e.expected_columns,
       ARRAY(
         SELECT c.column_name
         FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = e.table_name
         ORDER BY c.ordinal_position
       ) AS columns_found,
       ARRAY(
         SELECT expected_column
         FROM unnest(e.expected_columns) AS expected_column
         WHERE NOT EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = 'public'
             AND c.table_name = e.table_name
             AND c.column_name = expected_column
         )
         ORDER BY expected_column
       ) AS expected_columns_missing
FROM expected e
ORDER BY e.table_name;
