-- Hakotohito: read-only execution-path evidence collection
-- 目的: trigger / routine / pg_cron / role grant の追加証拠を取得する。
-- 全文SELECTのみ。DDL/DML/関数実行/設定変更は含まない。
-- Supabase SQL Editorでは、対象プロジェクトを確認してから各セクションを個別実行する。
-- まずテスト環境（東京）で取得し、結果に秘密情報が含まれないか確認する。

-- [Q0] 実行先の識別（結果を必ず保存）
SELECT
  current_database() AS database_name,
  current_user AS current_role,
  session_user AS session_role,
  current_setting('server_version') AS server_version,
  current_setting('search_path') AS search_path,
  now() AS captured_at;

-- [Q1] インストール済み拡張と配置schema
SELECT e.extname, e.extversion, n.nspname AS extension_schema
FROM pg_catalog.pg_extension e
JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

-- [Q2] 全ユーザーtrigger（internal triggerを除く）と実行関数
SELECT
  n.nspname AS table_schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_state,
  pg_catalog.pg_get_triggerdef(t.oid, true) AS trigger_definition,
  pn.nspname AS function_schema,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS function_arguments,
  pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname, t.tgname;

-- [Q3] Event Trigger（DDLイベント起点の処理）
SELECT
  e.evtname,
  e.evtevent,
  e.evtenabled,
  e.evttags,
  pn.nspname AS function_schema,
  p.proname AS function_name,
  pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_event_trigger e
JOIN pg_catalog.pg_proc p ON p.oid = e.evtfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
ORDER BY e.evtname;

-- [Q4] public schema内の全routine一覧・実行属性・ACL
SELECT
  n.nspname AS routine_schema,
  p.proname AS routine_name,
  CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate' WHEN 'w' THEN 'window' ELSE p.prokind::text END AS routine_kind,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proparallel AS parallel_safety,
  p.proconfig AS function_settings,
  p.proacl AS function_acl,
  pg_catalog.pg_get_functiondef(p.oid) AS routine_definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- [Q5] pg_cronのjob一覧
-- pg_cronが未導入なら、このセクションだけ relation-not-found になる。その場合は
-- 「pg_cron未導入」または「cron schemaを参照できない」としてエラー全文を保存する。
-- command列にURL/token等が含まれる可能性があるため、共有前に必ず秘密情報を伏せる。
SELECT
  jobid,
  jobname,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active
FROM cron.job
ORDER BY jobid;

-- [Q6] pg_cronの直近実行履歴（権限がある場合）
SELECT
  j.jobid,
  j.jobname,
  d.runid,
  d.status,
  d.return_message,
  d.start_time,
  d.end_time
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT runid, status, return_message, start_time, end_time
  FROM cron.job_run_details d0
  WHERE d0.jobid = j.jobid
  ORDER BY d0.start_time DESC
  LIMIT 10
) d ON true
ORDER BY j.jobid, d.start_time DESC;

-- [Q7] DB role一覧（認証情報は含まない）
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
WHERE rolname !~ '^pg_'
ORDER BY rolname;

-- [Q8] public schema内routineに対する明示的な権限付与
SELECT
  n.nspname AS routine_schema,
  p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  p.proacl AS routine_acl
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- [Q9] public schema内のtable/view/materialized viewとRLS状態
SELECT
  n.nspname AS object_schema,
  c.relname AS object_name,
  c.relkind AS object_kind,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY c.relkind, c.relname;

-- [Q10] public schema内のRLS policy一覧
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
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
