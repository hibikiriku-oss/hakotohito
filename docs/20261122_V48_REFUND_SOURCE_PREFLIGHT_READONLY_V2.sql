-- Hakotohito V48 refund-source preflight V2
-- READ ONLY: catalog/SELECT only. No RPC calls, DDL, DML, locks, or balance repair.
-- Run against the intended target database before designing/applying any source-linked refund migration.
-- Do not infer refund completion from descriptions alone; all result sets are review candidates.

-- [01] Exact coin ledger schema, defaults, identity, and generated columns.
SELECT c.ordinal_position, c.column_name, c.data_type, c.udt_name,
       c.is_nullable, c.column_default, c.is_identity, c.is_generated
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name = 'coin_transactions'
ORDER BY c.ordinal_position;

-- [02] All constraints on the coin ledger, including CHECK and UNIQUE definitions.
SELECT con.conname, con.contype, pg_get_constraintdef(con.oid, true) AS definition,
       con.convalidated
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public' AND rel.relname = 'coin_transactions'
ORDER BY con.contype, con.conname;

-- [03] Index definitions, including partial and expression indexes.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'coin_transactions'
ORDER BY indexname;

-- [04] Triggers and row-security status on the ledger.
SELECT t.tgname, pg_get_triggerdef(t.oid, true) AS trigger_definition,
       t.tgenabled
FROM pg_trigger t
WHERE t.tgrelid = to_regclass('public.coin_transactions')
  AND NOT t.tgisinternal
ORDER BY t.tgname;
SELECT c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
WHERE c.oid = to_regclass('public.coin_transactions');

-- [05] Current definitions and grants for all relevant financial/lifecycle RPCs.
-- Function source is returned for operator review; do not execute the returned text.
SELECT p.oid::regprocedure::text AS signature,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proacl AS acl,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = ANY (ARRAY[
    'spend_coins', 'spend_coins_legacy',
    'cancel_match_with_direct_invite_refund',
    'cancel_event_request_with_refund_internal',
    'withdraw_user_account',
    'complete_match_with_fee',
    'register_completion_dispute', 'agree_completion_dispute',
    'manage_completion_dispute_case',
    'reject_direct_invitation_with_refund',
    'reject_direct_invitation_with_refund_for_withdrawal'
  ])
ORDER BY p.proname, p.oid::regprocedure::text;

-- [06] Fee debit counts and idempotency-key uniqueness for V48 fee families.
SELECT transaction_type,
       COUNT(*) AS debit_rows,
       COUNT(DISTINCT idempotency_key) AS distinct_keys,
       COUNT(*) FILTER (WHERE idempotency_key IS NULL OR idempotency_key = '') AS missing_keys,
       SUM(-amount)::bigint AS debited_coins,
       COUNT(*) FILTER (WHERE request_id IS NULL) AS missing_request_refs,
       COUNT(*) FILTER (WHERE match_id IS NULL) AS missing_match_refs
FROM public.coin_transactions
WHERE amount < 0
  AND (
    idempotency_key LIKE 'event_match_fee:%'
    OR idempotency_key LIKE 'event_match_transaction_fee:%'
    OR idempotency_key LIKE 'performance_reward_fee_match:%'
    OR idempotency_key LIKE 'lesson_match_fee:%'
    OR idempotency_key LIKE 'direct_invite_fee:%'
  )
GROUP BY transaction_type
ORDER BY transaction_type;

SELECT idempotency_key, COUNT(*) AS rows,
       COUNT(DISTINCT user_id) AS distinct_payers,
       COUNT(DISTINCT amount) AS distinct_amounts,
       COUNT(DISTINCT COALESCE(request_id::text, '<null>')) AS request_refs,
       COUNT(DISTINCT COALESCE(application_id::text, '<null>')) AS application_refs,
       COUNT(DISTINCT COALESCE(match_id::text, '<null>')) AS match_refs
FROM public.coin_transactions
WHERE idempotency_key LIKE 'event_match_fee:%'
   OR idempotency_key LIKE 'event_match_transaction_fee:%'
   OR idempotency_key LIKE 'performance_reward_fee_match:%'
   OR idempotency_key LIKE 'lesson_match_fee:%'
   OR idempotency_key LIKE 'direct_invite_fee:%'
GROUP BY idempotency_key
HAVING COUNT(*) > 1
ORDER BY rows DESC, idempotency_key;

-- [07] Per-match event/rental debits, joined to match/request and payer profile.
SELECT debit.id AS debit_id, debit.user_id AS payer_user_id,
       debit.transaction_type, debit.amount, debit.request_id, debit.application_id,
       debit.match_id, debit.idempotency_key, pr.request_type,
       m.status AS match_status, m.performance_status, m.completed_at,
       debit.created_at
FROM public.coin_transactions debit
LEFT JOIN public.matches m ON m.id = debit.match_id
LEFT JOIN public.performance_requests pr
  ON pr.id = COALESCE(debit.request_id, m.request_id)
WHERE debit.amount < 0
  AND debit.idempotency_key LIKE 'event_match_transaction_fee:%'
ORDER BY debit.created_at, debit.id;

-- [08] Performance-reward fee snapshot ↔ debit integrity.
SELECT s.match_id, s.request_id, s.application_id, s.payer_user_id,
       s.fee_amount_coins, s.coin_transaction_id, s.charged_at,
       ct.user_id AS debit_payer_user_id, ct.amount AS debit_amount,
       ct.transaction_type, ct.idempotency_key,
       (ct.id IS NOT NULL AND ct.user_id = s.payer_user_id
          AND ct.amount = -s.fee_amount_coins
          AND ct.transaction_type = 'facility_reward_fee') AS snapshot_debit_matches
FROM public.match_fee_snapshots s
LEFT JOIN public.coin_transactions ct ON ct.id = s.coin_transaction_id
WHERE s.fee_kind = 'performance_reward'
ORDER BY s.created_at, s.match_id;

-- [09] Snapshot rows with no linked transaction despite a positive fee amount,
-- and debits with no corresponding snapshot.
SELECT COUNT(*) FILTER (WHERE s.fee_amount_coins > 0 AND s.coin_transaction_id IS NULL)
         AS positive_fee_snapshots_without_tx,
       COUNT(*) FILTER (WHERE s.coin_transaction_id IS NOT NULL AND ct.id IS NULL)
         AS snapshots_with_missing_tx,
       COUNT(*) AS performance_snapshot_rows
FROM public.match_fee_snapshots s
LEFT JOIN public.coin_transactions ct ON ct.id = s.coin_transaction_id
WHERE s.fee_kind = 'performance_reward';

SELECT COUNT(*) AS performance_fee_debits_without_snapshot
FROM public.coin_transactions ct
LEFT JOIN public.match_fee_snapshots s ON s.coin_transaction_id = ct.id
WHERE ct.transaction_type = 'facility_reward_fee'
  AND ct.amount < 0
  AND ct.idempotency_key LIKE 'performance_reward_fee_match:%'
  AND s.id IS NULL;

-- [10] Request-level initial event/rental fee uniqueness and linked match references.
SELECT debit.request_id, COUNT(*) AS debit_count,
       COUNT(DISTINCT debit.user_id) AS payer_count,
       COUNT(DISTINCT -debit.amount) AS amount_count,
       ARRAY_AGG(debit.id ORDER BY debit.created_at, debit.id) AS debit_ids,
       ARRAY_AGG(debit.match_id ORDER BY debit.created_at, debit.id) AS original_match_ids
FROM public.coin_transactions debit
WHERE debit.transaction_type = 'match_fee'
  AND debit.amount < 0
  AND debit.idempotency_key = 'event_match_fee:' || debit.request_id::text
GROUP BY debit.request_id
HAVING COUNT(*) <> 1 OR COUNT(DISTINCT debit.user_id) <> 1 OR COUNT(DISTINCT -debit.amount) <> 1
ORDER BY debit.request_id;

-- [11] Refund-like credits grouped by exact business references.
-- This is intentionally a candidate list only: description/key matching is not proof.
SELECT credit.user_id AS credited_user_id, credit.transaction_type,
       credit.request_id, credit.application_id, credit.match_id,
       credit.amount, credit.idempotency_key, credit.description, credit.created_at
FROM public.coin_transactions credit
WHERE credit.amount > 0
  AND (
    credit.transaction_type = 'admin_adjustment'
    OR credit.idempotency_key ILIKE '%refund%'
    OR credit.description ILIKE '%返金%'
  )
ORDER BY credit.created_at, credit.id;

-- [12] Existing source_transaction_id support, inspected without assuming the column exists.
SELECT COUNT(*) FILTER (WHERE to_jsonb(ct)->>'source_transaction_id' IS NOT NULL)
         AS rows_with_source_transaction_id,
       COUNT(DISTINCT to_jsonb(ct)->>'source_transaction_id')
         AS distinct_source_transaction_ids
FROM public.coin_transactions ct;

SELECT to_jsonb(ct)->>'source_transaction_id' AS source_transaction_id,
       COUNT(*) AS refund_rows,
       COUNT(DISTINCT ct.user_id) AS credited_users,
       COUNT(DISTINCT ct.amount) AS amounts
FROM public.coin_transactions ct
WHERE to_jsonb(ct)->>'source_transaction_id' IS NOT NULL
GROUP BY to_jsonb(ct)->>'source_transaction_id'
HAVING COUNT(*) > 1
ORDER BY refund_rows DESC;

-- [13] Aggregate ledger balance reconciliation. Opening-balance treatment may
-- make a non-zero difference legitimate; do not auto-adjust based on this query.
SELECT u.account_status, COUNT(*) AS users,
       SUM(u.coin_balance)::bigint AS current_balance_total,
       SUM(COALESCE(l.ledger_net, 0))::bigint AS ledger_net_total,
       SUM(u.coin_balance - COALESCE(l.ledger_net, 0))::bigint AS balance_minus_ledger_total,
       COUNT(*) FILTER (WHERE u.coin_balance <> COALESCE(l.ledger_net, 0)) AS users_with_difference
FROM public.users u
LEFT JOIN (
  SELECT user_id, SUM(amount)::bigint AS ledger_net
  FROM public.coin_transactions GROUP BY user_id
) l ON l.user_id = u.id
GROUP BY u.account_status
ORDER BY u.account_status;

-- [14] Relevant table/column availability for attempt-aware source provenance.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = ANY (ARRAY[
    'application_attempts', 'matches', 'applications',
    'match_fee_snapshots', 'lesson_fee_snapshots', 'coin_transactions'
  ])
  AND column_name = ANY (ARRAY[
    'id', 'application_attempt_id', 'attempt_id', 'match_id',
    'application_id', 'request_id', 'band_id', 'source_transaction_id',
    'coin_transaction_id', 'payer_user_id', 'fee_amount_coins', 'idempotency_key'
  ])
ORDER BY table_name, ordinal_position;
