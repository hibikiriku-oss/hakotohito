-- V45 read-only preflight. Run before applying 20261119_001.
-- No writes are performed by this file.

-- 1. Relevant routines and security attributes.
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

-- 2. Current virtual lesson reservations (they are not real debits).
SELECT COUNT(*) FILTER (WHERE COALESCE(reserved_coins, 0) <> 0) AS offers_with_virtual_reservation,
       COALESCE(SUM(reserved_coins), 0) AS virtual_reserved_total,
       COUNT(*) FILTER (WHERE status = 'open') AS open_lesson_offers
FROM public.lesson_offers;

-- 3. Account status distribution and account_status check constraints.
SELECT account_status, COUNT(*) AS users
FROM public.users
GROUP BY account_status
ORDER BY account_status;

SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.users'::regclass
  AND c.contype = 'c'
  AND pg_get_constraintdef(c.oid) ILIKE '%account_status%';

-- 4. Global mutation gate on users.
SELECT t.tgname, t.tgenabled, p.oid::regprocedure AS trigger_function
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND c.relname = 'users'
  AND NOT t.tgisinternal;

-- 5. Exact inspected production baseline hashes. These are read-only checks.
SELECT p.oid::regprocedure AS routine,
       md5(pg_get_functiondef(p.oid)) AS definition_md5,
       CASE p.oid::regprocedure::text
         WHEN 'apply_to_lesson_offer(uuid,uuid,text)' THEN '5be2c47bc9922aca406b3ee1570bf69b'
         WHEN 'create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)' THEN '295a8ab05d0688897a2a182bbad9d36f'
         WHEN 'update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])' THEN 'dddb28d69f43d213050324ee24f4ba58'
         WHEN 'transfer_band_coins(uuid,uuid,uuid,integer,text,text)' THEN 'b35615756e1253860b3ad142c3090cfa'
         WHEN 'spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)' THEN '8c946d0ad72d11b5a19303b565cfd4b2'
       END AS expected_definition_md5,
       md5(pg_get_functiondef(p.oid)) = CASE p.oid::regprocedure::text
         WHEN 'apply_to_lesson_offer(uuid,uuid,text)' THEN '5be2c47bc9922aca406b3ee1570bf69b'
         WHEN 'create_lesson_offer(uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer)' THEN '295a8ab05d0688897a2a182bbad9d36f'
         WHEN 'update_lesson_offer_with_levels(uuid,uuid,text,text,text[],text[],text,date,time without time zone,time without time zone,integer,integer,text[])' THEN 'dddb28d69f43d213050324ee24f4ba58'
         WHEN 'transfer_band_coins(uuid,uuid,uuid,integer,text,text)' THEN 'b35615756e1253860b3ad142c3090cfa'
         WHEN 'spend_coins_legacy(uuid,integer,text,text,text,uuid,uuid,uuid)' THEN '8c946d0ad72d11b5a19303b565cfd4b2'
       END AS matches_inspected_baseline
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('apply_to_lesson_offer','create_lesson_offer','update_lesson_offer_with_levels','transfer_band_coins','spend_coins_legacy')
ORDER BY p.proname, p.oid::regprocedure::text;
