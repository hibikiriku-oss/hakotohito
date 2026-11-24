-- V48 refund source-ledger audit preflight.
-- READ ONLY: SELECT statements only. No RPC, DDL, DML, or row locks.
-- Run against the target DB only after confirming this exact schema is present.

-- 1. Inspect coin_transactions columns needed for a source-linked refund migration.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'coin_transactions'
ORDER BY ordinal_position;

-- 2. Inspect indexes/constraints before adding source_transaction_id uniqueness.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'coin_transactions'
ORDER BY indexname;

-- 3. New V48 per-match event/rental transaction fees without an obvious
-- matching positive admin_adjustment row. This is a candidate list, not
-- proof of a missing refund: legacy/manual adjustments may exist.
SELECT debit.id AS source_transaction_id,
       debit.user_id AS payer_user_id,
       debit.request_id,
       debit.application_id,
       debit.match_id,
       debit.amount AS debit_amount,
       debit.idempotency_key,
       debit.created_at
FROM public.coin_transactions debit
WHERE debit.transaction_type = 'match_fee'
  AND debit.amount < 0
  AND debit.idempotency_key LIKE 'event_match_transaction_fee:%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.coin_transactions credit
    WHERE credit.user_id = debit.user_id
      AND credit.amount = -debit.amount
      AND credit.transaction_type = 'admin_adjustment'
      AND credit.request_id IS NOT DISTINCT FROM debit.request_id
      AND credit.match_id IS NOT DISTINCT FROM debit.match_id
      AND credit.created_at >= debit.created_at
      AND (
        credit.idempotency_key = 'event_match_transaction_refund:' || debit.match_id::text
        OR credit.description ILIKE '%イベント%成立%返金%'
        OR credit.description ILIKE '%レンタル%成立%返金%'
      )
  )
ORDER BY debit.created_at, debit.id;

-- 4. V48 performance reward fees without an obvious matching positive
-- adjustment. Again, this is a candidate list, not proof.
SELECT debit.id AS source_transaction_id,
       debit.user_id AS payer_user_id,
       debit.request_id,
       debit.application_id,
       debit.match_id,
       debit.amount AS debit_amount,
       debit.idempotency_key,
       debit.created_at
FROM public.coin_transactions debit
WHERE debit.transaction_type = 'facility_reward_fee'
  AND debit.amount < 0
  AND debit.idempotency_key LIKE 'performance_reward_fee_match:%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.coin_transactions credit
    WHERE credit.user_id = debit.user_id
      AND credit.amount = -debit.amount
      AND credit.transaction_type = 'admin_adjustment'
      AND credit.request_id IS NOT DISTINCT FROM debit.request_id
      AND credit.match_id IS NOT DISTINCT FROM debit.match_id
      AND credit.created_at >= debit.created_at
      AND (
        credit.idempotency_key = 'performance_reward_fee_refund:' || debit.match_id::text
        OR credit.description ILIKE '%報酬手数料%返金%'
      )
  )
ORDER BY debit.created_at, debit.id;

-- 5. Request-level first event/rental fee debit rows. Verify one debit per
-- request and inspect its original match/application linkage.
SELECT request_id,
       COUNT(*) AS debit_count,
       SUM(-amount)::bigint AS total_debited,
       MIN(created_at) AS first_debit_at,
       ARRAY_AGG(id ORDER BY created_at, id) AS source_transaction_ids,
       ARRAY_AGG(match_id ORDER BY created_at, id) AS linked_match_ids
FROM public.coin_transactions
WHERE transaction_type = 'match_fee'
  AND amount < 0
  AND idempotency_key = 'event_match_fee:' || request_id::text
GROUP BY request_id
HAVING COUNT(*) <> 1
ORDER BY request_id;

-- 6. Potential duplicate positive refund credits using the current legacy
-- match-level keys/description conventions. Review before any backfill.
SELECT user_id, request_id, match_id, amount,
       COUNT(*) AS credit_count,
       ARRAY_AGG(idempotency_key ORDER BY created_at, id) AS refund_keys
FROM public.coin_transactions
WHERE transaction_type = 'admin_adjustment'
  AND amount > 0
  AND (
    idempotency_key LIKE '%_refund:%'
    OR description ILIKE '%返金%'
  )
GROUP BY user_id, request_id, match_id, amount
HAVING COUNT(*) > 1
ORDER BY credit_count DESC, request_id, match_id;
