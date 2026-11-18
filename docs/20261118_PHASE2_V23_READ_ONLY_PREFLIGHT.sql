-- v23 migration 011 read-only preflight. SELECT/catalog inspection only.
SELECT current_database() AS database_name, current_user AS executing_role,
       current_setting('server_version') AS server_version;

SELECT to_regprocedure('public.acquire_global_mutation_gate_trigger()') AS global_gate_helper,
       to_regprocedure('public.guard_active_account_mutation()') AS active_account_guard,
       to_regprocedure('public.close_pending_lesson_applications_on_withdrawal()') AS withdrawal_cleanup_function;

WITH required(table_name,column_name) AS (
  VALUES ('users','id'),('users','user_type'),('users','account_status'),
         ('performers','id'),('performers','user_id'),
         ('lesson_offers','id'),('lesson_offers','performer_id'),
         ('lesson_applications','lesson_offer_id'),
         ('lesson_applications','applicant_performer_id'),('lesson_applications','status')
)
SELECT r.table_name,r.column_name,c.data_type,c.udt_schema,c.udt_name,
       (c.column_name IS NOT NULL) AS column_exists
FROM required r LEFT JOIN information_schema.columns c
 ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
ORDER BY r.table_name,r.column_name;

-- Status CHECK/enum definitions; inspect that `rejected` is permitted.
SELECT c.conname,pg_get_constraintdef(c.oid,true) AS definition
FROM pg_constraint c
WHERE c.conrelid='public.lesson_applications'::regclass AND c.contype='c'
ORDER BY c.conname;
SELECT t.typname,e.enumlabel,e.enumsortorder
FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
WHERE t.oid=(SELECT a.atttypid FROM pg_attribute a
             WHERE a.attrelid='public.lesson_applications'::regclass
               AND a.attname='status' AND a.attnum>0 AND NOT a.attisdropped)
ORDER BY e.enumsortorder;

-- Required gate/guard triggers and current cleanup trigger.
SELECT c.relname AS table_name,t.tgname,t.tgenabled,
       p.oid::regprocedure AS trigger_function,pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND ((c.relname IN ('users','lesson_applications') AND t.tgname IN
       ('trg_global_mutation_gate','trg_guard_active_account_mutation'))
       OR t.tgname='trg_close_pending_lesson_applications_on_withdrawal')
ORDER BY c.relname,t.tgname;

-- Aggregate only: pending lesson applications connected to inactive performers.
SELECT count(*) AS pending_applications_with_inactive_applicant
FROM public.lesson_applications la
JOIN public.performers p ON p.id=la.applicant_performer_id
JOIN public.users u ON u.id=p.user_id
WHERE la.status='pending' AND u.account_status IS DISTINCT FROM 'active';
SELECT count(*) AS pending_applications_on_inactive_teachers_offers
FROM public.lesson_applications la
JOIN public.lesson_offers lo ON lo.id=la.lesson_offer_id
JOIN public.performers p ON p.id=lo.performer_id
JOIN public.users u ON u.id=p.user_id
WHERE la.status='pending' AND u.account_status IS DISTINCT FROM 'active';

-- This script performs no writes and does not prove migration 011 is applied.
