# Supabase catalog baseline and public relation ACL audit (v15)

- Date: 2026-11-18 JST
- Source package: `Hakotohito_20261118_limited_release_phase2_privacy_acl_candidate_v14.zip`
- Source package SHA-256: `2011d3df2fbf4481d1202797ef1795e2a0983ec7bc859a08ff6ed2e2c16af5ec`
- Database evidence: user-uploaded `supabase関数全体.txt`, `①②③.txt`, and the two function-definition extracts timestamped 2026-11-17 UTC (2026-11-18 JST). These are catalog/function/ACL/trigger exports, not row-level business data.
- Scope: compare v14 migrations and source assumptions with the latest available uploaded Supabase catalog evidence. No live DB connection or SQL execution.

## 1. Evidence alignment

Migration `20261116_009_global_mutation_gate.sql` contains 31 preflight hashes for existing public functions. All **31/31** hashes match the uploaded `supabase関数全体.txt` function definitions after the migration's CRLF-to-LF normalization. This is strong evidence that the migration's function-definition baseline matches the uploaded database snapshot. It does not prove that the migration has been applied.

The uploaded catalog shows 37 public functions, 35 SECURITY DEFINER functions, 31 public tables with RLS enabled, and 13 triggers total. Only two application-schema triggers are present in the export (`matches.trg_prevent_disputed_match_cancellation` and `users.users_initial_coin_balance`); the remaining listed triggers are in `storage`.

The uploaded public-table inventory does not contain `application_attempts` or `line_notification_outbox`, and the trigger inventory does not contain `trg_global_mutation_gate`. Therefore, in this snapshot, migrations 009, 010, and 014-023 are not reflected as applied. Treat them as unapplied candidates and preserve their dependency order; do not infer that the current DB has the Outbox or global gate merely because the source package contains them.

## 2. SECURITY DEFINER ACL and search_path

The 35 uploaded public SECURITY DEFINER functions have no `PUBLIC`, `anon`, or `authenticated` EXECUTE grant in the exported ACL data. 33 are executable by `service_role`; two internal routines are executable only by `postgres`. This is a positive finding for the uploaded snapshot.

However, all 35 function settings use `search_path=public` or `search_path=public, pg_temp`; none begins with `pg_catalog`. Migration `20261118_003_lock_down_security_definer_rpc_acl.sql` is an EXECUTE-ACL allowlist migration; it does not normalize the search_path of the existing functions. The uploaded public schema ACL grants only USAGE (not CREATE) to anon/authenticated, reducing direct object-shadowing exposure, but search_path hardening remains a separate defense-in-depth task. Do not claim that 003 fixes search_path.

## 3. Residual public relation grants (new finding)

All 31 public tables in the uploaded RLS inventory have RLS enabled. Nevertheless, the relation ACL export shows `REFERENCES`, `TRIGGER`, and `TRUNCATE` privileges for both `anon` and `authenticated` on the same 26 existing public application tables, including `users`, `coin_transactions`, `matches`, `applications`, `messages`, and `performance_requests`.

No `SELECT`, `INSERT`, `UPDATE`, or `DELETE` grants to anon/authenticated were found on those 26 public application tables in this export. The five Stripe-related tables have explicit `REVOKE ALL` statements in the candidate migration. The public schema export shows USAGE but no CREATE for anon/authenticated.

`TRUNCATE` is not governed by RLS. The reviewed application source uses `SUPABASE_SERVICE_ROLE_KEY` in its server-side Supabase clients; no browser client or anon-key client was found in `src/`. No direct REST route that exposes TRUNCATE was identified. Accordingly, this is classified as a **P2 least-privilege ACL defect**, not a demonstrated remote data-deletion exploit. The remaining REFERENCES/TRIGGER grants are also unnecessary for the app roles.

### Candidate remediation

Added `supabase/migrations/20261118_005_revoke_public_relation_acl.sql` in both mirrored trees. It:

- revokes all relation privileges on existing public tables/sequences from PUBLIC, anon, and authenticated;
- revokes corresponding per-schema default privileges for objects created by postgres;
- leaves service_role privileges and the storage schema untouched;
- fails closed if a global postgres default ACL still grants relation privileges to PUBLIC/anon/authenticated, because a per-schema REVOKE cannot neutralize a global default grant;
- verifies no PUBLIC/anon/authenticated ACL remains on public relations before commit.

This migration is a candidate only. It has not been executed against any database. Before applying, inspect `pg_default_acl` read-only and verify the actual migration owner is `postgres`.

## 4. Data limitations

The latest uploaded Supabase files contain function definitions, function ACLs, RLS flags, relation permissions, schema permissions, and trigger definitions. They do **not** contain current business rows for `users`, `coin_transactions`, `applications`, `matches`, `payment_orders`, or Outbox rows. `Hakotohito_20261117_ReadOnly_Final_Gate_v2.sql` is a query script, not its result export. No older pre-reset business-row evidence was substituted. Balance reconciliation, fee/refund provenance, actual row counts, and test-record cleanup remain unverified until a current post-reset read-only result is supplied.

## 5. Release impact and remaining blockers

- Existing P1: Stripe webhook incident state can be overwritten by an older Stripe event; needs event-created ordering and an atomic incident RPC.
- Existing P2: band invitation authorization TOCTOU; needs atomic authorization + insert RPC.
- Existing P2: match-chat and band-chat authorization TOCTOU; needs atomic authorization + message insert RPCs.
- New P2: residual anon/authenticated relation ACLs; candidate migration 005 added.
- Request DELETE FK behavior remains unverified because the uploaded catalog extracts do not include the relevant FK definitions / `confdeltype` evidence.
- Outbox/global mutation gate/application-attempt migrations remain unapplied in the uploaded DB snapshot; apply only after preflight and in the documented dependency order.

## 6. Safety and verification

- No source API/UI implementation was changed in this checkpoint.
- One new SQL migration candidate and audit/checklist documentation were added.
- No production or test Supabase database was connected to or modified.
- No GitHub commit/push or Vercel deployment was performed.
- No build, tests, lint, typecheck, or local checks were run.
- ZIP integrity, root/mirror file equality, and SHA-256 were checked after packaging.
