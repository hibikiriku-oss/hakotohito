-- V47 READ-ONLY POSTFLIGHT. Run after successful migration.
SELECT 'full_application_id_unique_constraints' AS check_name, count(*) AS remaining
FROM pg_constraint c
WHERE c.conrelid = 'public.matches'::regclass AND c.contype = 'u'
  AND array_length(c.conkey,1) = 1
  AND c.conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid='public.matches'::regclass AND attname='application_id');

SELECT m.id AS match_id, m.application_id, aa.id AS attempt_id, aa.status AS attempt_status
FROM public.matches m
LEFT JOIN public.application_attempts aa
  ON aa.match_id = m.id AND aa.application_id = m.application_id
WHERE m.status = 'active' AND m.performance_status IN ('scheduled','active')
  AND COALESCE(m.completion_fee_eligible,false)
  AND (aa.id IS NULL OR aa.status <> 'matched');

SELECT pg_get_functiondef('public.complete_match_with_fee(uuid,text)'::regprocedure) AS complete_rpc_definition;


SELECT 'active_application_duplicate_matches' AS check_name, count(*) AS remaining
FROM (
  SELECT application_id
  FROM public.matches
  WHERE status = 'active' AND application_id IS NOT NULL
  GROUP BY application_id
  HAVING count(*) > 1
) duplicates;

SELECT 'attempt_message_snapshot_columns' AS check_name,
       count(*) AS present_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'application_attempts'
  AND column_name IN ('message_snapshot', 'message_snapshot_available');

SELECT aa.id AS attempt_id, aa.match_id, aa.status,
       aa.message_snapshot_available,
       CASE WHEN aa.message_snapshot_available THEN aa.message_snapshot ELSE NULL END AS message_snapshot
FROM public.application_attempts aa
WHERE aa.match_id IS NOT NULL
ORDER BY aa.started_at DESC
LIMIT 100;
