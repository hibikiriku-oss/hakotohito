-- Hakotohito matching-core lock redesign: read-only full routine export
-- Run on Tokyo Supabase SQL Editor using postgres role.
-- SELECT/catalog read only. No DDL, DML, RPC execution, or explicit locks.
-- Keep the output private; do not paste function bodies into public channels.

SELECT
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prokind AS routine_kind,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  p.proacl AS function_acl,
  pg_catalog.pg_get_functiondef(p.oid) AS routine_definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);
