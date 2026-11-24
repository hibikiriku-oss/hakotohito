-- Hakotohito 2026-11-20 early-release read-only preflight.
-- READ ONLY: no INSERT/UPDATE/DELETE/DDL or function execution.

-- 1. Live definitions, owner, SECURITY DEFINER, search_path, and service_role ACL.
SELECT p.oid::regprocedure AS routine,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS routine_settings,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
       md5(pg_get_functiondef(p.oid)) AS definition_md5,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'apply_to_lesson_offer', 'create_lesson_offer',
    'update_lesson_offer_with_levels', 'transfer_band_coins',
    'spend_coins_legacy', 'create_lesson_offer_with_levels_and_address',
    'apply_to_performance_request', 'apply_to_performance_request_as_band',
    'create_facility_invitation_with_coins'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

-- 2. Account status values and all account_status CHECK constraints.
SELECT account_status, COUNT(*) AS users
FROM public.users
GROUP BY account_status
ORDER BY account_status;

SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.users'::regclass
  AND c.contype = 'c'
  AND pg_get_constraintdef(c.oid) ILIKE '%account_status%'
ORDER BY c.conname;

-- 3. Current lesson virtual holds and open offers with already matched applicants.
SELECT COUNT(*) FILTER (WHERE COALESCE(lo.reserved_coins, 0) <> 0) AS nonzero_reserved_offers,
       COALESCE(SUM(lo.reserved_coins), 0) AS virtual_reserved_total,
       COUNT(*) FILTER (WHERE lo.status = 'open') AS open_offers
FROM public.lesson_offers lo;

SELECT lo.id AS lesson_offer_id, lo.status, COUNT(la.id) AS matched_applications,
       lo.lesson_date, lo.lesson_fee, lo.capacity
FROM public.lesson_offers lo
JOIN public.lesson_applications la ON la.lesson_offer_id = lo.id AND la.status = 'matched'
WHERE lo.status = 'open'
GROUP BY lo.id, lo.status, lo.lesson_date, lo.lesson_fee, lo.capacity
ORDER BY lo.lesson_date NULLS LAST, lo.id;

-- 4. Existing lesson self-matches (same user owns teacher and applicant profiles).
SELECT la.id AS lesson_application_id, lo.id AS lesson_offer_id,
       teacher.user_id AS teacher_user_id, applicant.user_id AS applicant_user_id,
       la.status
FROM public.lesson_applications la
JOIN public.lesson_offers lo ON lo.id = la.lesson_offer_id
JOIN public.performers teacher ON teacher.id = lo.performer_id
JOIN public.performers applicant ON applicant.id = la.applicant_performer_id
WHERE teacher.user_id = applicant.user_id
ORDER BY la.created_at DESC;

-- 5. Existing self-matches for individual/direct applications.
SELECT a.id AS application_id, a.request_id, a.performer_id, a.source, a.status,
       f.user_id AS facility_user_id, p.user_id AS performer_user_id
FROM public.applications a
JOIN public.performance_requests pr ON pr.id = a.request_id
JOIN public.facilities f ON f.id = pr.facility_id
JOIN public.performers p ON p.id = a.performer_id
WHERE f.user_id = p.user_id
ORDER BY a.created_at DESC;

-- 6. Existing band applications where an active member is also the facility owner.
SELECT a.id AS application_id, a.request_id, a.band_id, a.status,
       f.user_id AS facility_user_id, bm.performer_id, p.user_id AS member_user_id
FROM public.applications a
JOIN public.performance_requests pr ON pr.id = a.request_id
JOIN public.facilities f ON f.id = pr.facility_id
JOIN public.band_members bm ON bm.band_id = a.band_id AND bm.status = 'active'
JOIN public.performers p ON p.id = bm.performer_id
WHERE a.band_id IS NOT NULL AND f.user_id = p.user_id
ORDER BY a.created_at DESC;

-- 7. Open performance requests with one or more linked matches.
SELECT pr.id AS request_id, pr.status, COUNT(m.id) AS linked_matches
FROM public.performance_requests pr
JOIN public.matches m ON m.request_id = pr.id
WHERE pr.status = 'open'
GROUP BY pr.id, pr.status
ORDER BY pr.id;
