-- Read-only verification after applying 20261118_003_lock_down_security_definer_rpc_acl.sql.
-- has_function_privilege includes privileges inherited from PUBLIC.
-- acquire_global_mutation_gate_trigger() should retain search_path=pg_catalog,pg_temp
-- and should not need a direct service_role EXECUTE grant (it runs via installed triggers).
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_userbyid(p.proowner) AS owner_name,
  p.proconfig AS function_settings,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc AS p
JOIN pg_namespace AS n
  ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- The SECURITY DEFINER search_path includes public, so untrusted roles must
-- not be able to create objects there. Both values should be false.
SELECT
  has_schema_privilege('anon', 'public', 'CREATE') AS anon_can_create_in_public,
  has_schema_privilege('authenticated', 'public', 'CREATE') AS authenticated_can_create_in_public;
