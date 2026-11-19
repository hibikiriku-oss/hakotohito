-- V45 read-only postflight. Run after applying 20261119_001.

-- 1. No lesson offers retain virtual holds.
SELECT COUNT(*) AS nonzero_reserved_offers,
       COALESCE(SUM(reserved_coins), 0) AS reserved_total
FROM public.lesson_offers
WHERE COALESCE(reserved_coins, 0) <> 0;

-- 2. Approval metadata exists.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND column_name IN ('approved_at', 'approved_by_user_id')
ORDER BY column_name;

-- 3. Verify the deployed definitions are the V45 versions (compare hashes
-- with the migration/package ledger after deployment).
SELECT p.oid::regprocedure AS routine,
       p.prosecdef AS security_definer,
       p.proconfig AS routine_settings,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
       md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'apply_to_lesson_offer', 'create_lesson_offer',
    'update_lesson_offer_with_levels', 'transfer_band_coins', 'spend_coins_legacy'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

-- 4. Verify the account status constraint allows the pending state.
SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.users'::regclass
  AND c.contype = 'c'
  AND c.conname = 'users_account_status_check';

-- 5. Pending queue and approvals.
SELECT account_status, COUNT(*) AS users,
       COUNT(*) FILTER (WHERE approved_at IS NOT NULL) AS with_approval_timestamp
FROM public.users
GROUP BY account_status
ORDER BY account_status;
