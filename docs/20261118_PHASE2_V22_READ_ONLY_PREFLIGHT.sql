-- v21 read-only preflight. SELECT/catalog inspection only; no writes or locks requested.

-- 1) Database identity and migration prerequisites.
SELECT current_database() AS database_name,
       current_user AS executing_role,
       current_setting('server_version') AS server_version;

SELECT to_regprocedure('public.acquire_global_mutation_gate_trigger()') AS global_gate_helper,
       to_regprocedure('public.guard_active_account_mutation()') AS active_account_guard,
       to_regprocedure('public.guard_active_user_avatar_update()') AS avatar_guard;

-- 2) Required target columns.
WITH required(table_name,column_name) AS (
  VALUES
    ('users','id'),('users','account_status'),('users','avatar_type'),('users','avatar_emoji'),
    ('performers','user_id'),('facilities','user_id'),
    ('performance_requests','facility_id'),('lesson_offers','performer_id'),
    ('lesson_applications','lesson_offer_id'),('lesson_applications','applicant_performer_id'),
    ('inquiries','user_id'),('favorites','user_id'),('favorites','target_user_id')
)
SELECT r.table_name,r.column_name,
       (c.column_name IS NOT NULL) AS column_exists
FROM required r
LEFT JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=r.table_name
 AND c.column_name=r.column_name
ORDER BY r.table_name,r.column_name;

-- 3) Global gate and v21 account-guard trigger inventory.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       t.tgenabled AS enabled,
       p.proname AS trigger_function,
       pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public'
  AND t.tgname IN (
    'trg_global_mutation_gate',
    'trg_guard_active_account_mutation',
    'trg_guard_active_user_avatar_update'
  )
  AND NOT t.tgisinternal
ORDER BY c.relname,t.tgname;

-- 4) Functions' owner, SECURITY DEFINER and fixed search_path.
SELECT p.oid::regprocedure AS function_signature,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proconfig AS settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('guard_active_account_mutation','guard_active_user_avatar_update')
ORDER BY 1;

-- 5) Aggregate indicators only: no user IDs, names, messages, or free text.
SELECT
  (SELECT count(*) FROM public.lesson_offers lo
   JOIN public.performers p ON p.id=lo.performer_id
   JOIN public.users u ON u.id=p.user_id
   WHERE lo.status='open' AND u.account_status IS DISTINCT FROM 'active')
    AS open_lesson_offers_owned_by_inactive_accounts,
  (SELECT count(*) FROM public.performance_requests pr
   JOIN public.facilities f ON f.id=pr.facility_id
   JOIN public.users u ON u.id=f.user_id
   WHERE pr.status IN ('open','matched') AND u.account_status IS DISTINCT FROM 'active')
    AS open_requests_owned_by_inactive_accounts;

-- Expected after v21 migration 010:
-- * active-account guards exist on performers, facilities, performance_requests,
--   lesson_offers, lesson_applications, inquiries and favorites;
-- * avatar guard exists on users;
-- * every target table retains the global statement gate trigger.
-- This file is read-only and intentionally does not repair missing objects.

-- 6) Exact types for columns consumed by migration 010.
WITH required(table_name,column_name) AS (
  VALUES
    ('users','id'),('users','account_status'),('users','avatar_type'),('users','avatar_emoji'),
    ('performers','id'),('performers','user_id'),
    ('facilities','id'),('facilities','user_id'),
    ('performance_requests','facility_id'),
    ('lesson_offers','performer_id'),
    ('lesson_applications','lesson_offer_id'),('lesson_applications','applicant_performer_id'),
    ('inquiries','user_id'),('favorites','user_id'),('favorites','target_user_id')
)
SELECT r.table_name,r.column_name,c.data_type,c.udt_schema,c.udt_name,
       (c.column_name IS NOT NULL) AS column_exists
FROM required r
LEFT JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=r.table_name
 AND c.column_name=r.column_name
ORDER BY r.table_name,r.column_name;

-- 7) Confirm guard triggers are enabled and attached to the intended relations.
SELECT c.relname AS table_name,t.tgname,t.tgenabled,
       pg_get_triggerdef(t.oid,true) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND t.tgname IN ('trg_global_mutation_gate',
                   'trg_guard_active_account_mutation',
                   'trg_guard_active_user_avatar_update')
ORDER BY c.relname,t.tgname;

-- Read-only only. Do not infer successful migration application from this script's presence.
