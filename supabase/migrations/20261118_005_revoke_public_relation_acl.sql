-- Hakotohito: remove residual anon/authenticated ACLs from public relations.
-- Candidate only. Apply after 20261118_004 and after reviewing the default-ACL
-- preflight below. This does not touch storage schema permissions or RLS policies.
BEGIN;

SET LOCAL search_path TO pg_catalog, public, pg_temp;

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Run this migration as postgres; current_user=%', current_user;
  END IF;
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'Expected Supabase roles anon/authenticated are missing';
  END IF;
  IF to_regnamespace('public') IS NULL THEN
    RAISE EXCEPTION 'public schema is missing';
  END IF;
END;
$preflight$;

-- The 2026-11-18 catalog export showed residual REFERENCES, TRIGGER and
-- TRUNCATE grants to anon/authenticated on 26 existing public application
-- tables. RLS does not protect TRUNCATE. The application source in this
-- candidate uses the server-side service_role key for Supabase access; no
-- browser/anon-key Supabase client was found in src/.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

-- Prevent the same grants from being reintroduced by future objects created
-- by the migration owner in public. Existing service_role grants are untouched.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

DO $postflight$
DECLARE
  v_anon oid := (SELECT oid FROM pg_roles WHERE rolname = 'anon');
  v_authenticated oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        c.relacl,
        acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner)
      )
    ) a
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND a.grantee IN (0, v_anon, v_authenticated)
  ) THEN
    RAISE EXCEPTION 'public relation ACL postflight failed: PUBLIC/anon/authenticated grants remain';
  END IF;

  -- A global default ACL cannot be neutralized by a per-schema REVOKE. Fail
  -- closed if one exists so it can be reviewed rather than silently ignored.
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
      AND d.defaclnamespace = 0
      AND d.defaclobjtype IN ('r', 'S')
      AND a.grantee IN (0, v_anon, v_authenticated)
  ) THEN
    RAISE EXCEPTION 'global postgres default ACL grants to PUBLIC/anon/authenticated require separate review';
  END IF;
END;
$postflight$;

COMMIT;
