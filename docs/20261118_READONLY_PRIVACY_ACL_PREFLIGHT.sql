-- Hakotohito limited-release privacy / ACL preflight
-- Read-only catalog and metadata queries only.
-- Run only after confirming the selected Supabase project is the intended production project.
-- Do not run DDL/DML or RPC calls as part of this preflight.

-- [Q0] Confirm target database and execution role.
SELECT
  current_database() AS database_name,
  current_user AS current_role,
  session_user AS session_role,
  current_setting('server_version') AS server_version,
  current_setting('search_path') AS search_path,
  now() AS captured_at;

-- [Q1] Public/storage schema owners and effective CREATE privileges.
SELECT
  n.nspname AS schema_name,
  pg_catalog.pg_get_userbyid(n.nspowner) AS owner_name,
  n.nspacl AS schema_acl,
  has_schema_privilege('anon', n.oid, 'CREATE') AS anon_can_create,
  has_schema_privilege('authenticated', n.oid, 'CREATE') AS authenticated_can_create,
  has_schema_privilege('service_role', n.oid, 'CREATE') AS service_role_can_create
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname IN ('public', 'storage')
ORDER BY n.nspname;

-- [Q2] Default privileges affecting future objects in public/storage.
SELECT
  pg_catalog.pg_get_userbyid(d.defaclrole) AS grantor_role,
  CASE WHEN d.defaclnamespace = 0 THEN '(all schemas)'
       ELSE n.nspname END AS schema_name,
  d.defaclobjtype AS object_type,
  d.defaclacl AS default_acl
FROM pg_catalog.pg_default_acl AS d
LEFT JOIN pg_catalog.pg_namespace AS n
  ON n.oid = d.defaclnamespace
WHERE d.defaclnamespace = 0
   OR n.nspname IN ('public', 'storage')
ORDER BY grantor_role, schema_name, object_type;

-- [Q3] Public tables/views and RLS status.
SELECT
  n.nspname AS object_schema,
  c.relname AS object_name,
  c.relkind AS object_kind,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY n.nspname, c.relkind, c.relname;

-- [Q4] Exact RLS policies in public and storage.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- [Q5] Storage bucket exposure and restrictions.
-- Bucket names/flags are metadata; do not export object contents or signed URLs.
SELECT
  b.id,
  b.name,
  b."public" AS is_public,
  b.file_size_limit,
  b.allowed_mime_types
FROM storage.buckets AS b
ORDER BY b.name;

-- [Q6] SECURITY DEFINER routines: exact signatures, owner, settings, ACL, effective grants.
SELECT
  n.nspname AS routine_schema,
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prokind AS routine_kind,
  p.prosecdef AS security_definer,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  p.proconfig AS function_settings,
  p.proacl AS function_acl,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- [Q7] All non-internal triggers and their SECURITY DEFINER status.
SELECT
  n.nspname AS table_schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  pn.nspname AS function_schema,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS function_arguments,
  p.prosecdef AS function_security_definer,
  p.proconfig AS function_settings
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace AS pn ON pn.oid = p.pronamespace
WHERE NOT t.tgisinternal
  AND n.nspname IN ('public', 'storage')
ORDER BY n.nspname, c.relname, t.tgname;

-- [Q8] Role attributes (no passwords or authentication secrets).
SELECT
  rolname,
  rolsuper,
  rolinherit,
  rolcreaterole,
  rolcreatedb,
  rolcanlogin,
  rolreplication,
  rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname IN ('postgres', 'anon', 'authenticated', 'service_role', 'supabase_admin')
ORDER BY rolname;
