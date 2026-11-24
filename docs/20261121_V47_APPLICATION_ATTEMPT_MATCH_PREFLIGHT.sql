-- V47 READ-ONLY PREFLIGHT. Run before applying the migration; SELECT only.
SELECT 'application_attempts_table' AS check_name, to_regclass('public.application_attempts')::text AS result;
SELECT 'complete_rpc' AS check_name, to_regprocedure('public.complete_match_with_fee(uuid,text)')::text AS result;

-- Unique constraints/indexes on matches.application_id. Full uniqueness blocks reapplication;
-- partial uniqueness is intentionally preserved by V47.
SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.matches'::regclass AND c.contype = 'u'
  AND pg_get_constraintdef(c.oid) ILIKE '%(application_id)%';

SELECT i.indexrelid::regclass AS index_name, i.indisunique,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
WHERE i.indrelid = 'public.matches'::regclass
  AND pg_get_indexdef(i.indexrelid) ILIKE '%application_id%';

-- Must return zero rows before V47: active fee-eligible matches need one exact matched attempt.
SELECT m.id AS match_id, m.application_id, m.request_id, m.status, m.performance_status
FROM public.matches m
WHERE m.status = 'active'
  AND m.performance_status IN ('scheduled','active')
  AND COALESCE(m.completion_fee_eligible, false)
  AND NOT EXISTS (
    SELECT 1 FROM public.application_attempts aa
    WHERE aa.match_id = m.id AND aa.application_id = m.application_id
      AND aa.request_id = m.request_id AND aa.status = 'matched'
  );

-- Existing mapping quality; duplicates should be zero due to the per-match unique index.
SELECT aa.match_id, count(*) AS attempt_rows
FROM public.application_attempts aa
WHERE aa.match_id IS NOT NULL
GROUP BY aa.match_id HAVING count(*) > 1;

-- Related lifecycle RPC presence. These routines are match-ID keyed; V47 does not rewrite them.
SELECT proname, oid::regprocedure AS signature
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('register_completion_dispute','agree_completion_dispute',
                  'manage_completion_dispute_case','create_review_with_reward')
ORDER BY proname;


-- Must return zero rows: an application may have at most one active match.
SELECT application_id, count(*) AS active_match_count
FROM public.matches
WHERE status = 'active' AND application_id IS NOT NULL
GROUP BY application_id
HAVING count(*) > 1;

-- V47.002 adds immutable-per-attempt message snapshots; inspect current attempt counts.
SELECT a.id AS application_id, count(aa.id) AS attempt_count,
       count(*) FILTER (WHERE aa.match_id IS NOT NULL) AS matched_attempt_count
FROM public.applications a
JOIN public.application_attempts aa ON aa.application_id = a.id
GROUP BY a.id
HAVING count(aa.id) > 1
ORDER BY attempt_count DESC, a.id;
