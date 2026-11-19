# 2026-11-12 cancellation patch rollback notes

1. Before applying the migration, run `20261112_001_known_audit_fixes_preflight.sql` and export the full result.
2. Keep the exported `pg_get_functiondef` text for every function being replaced.
3. To roll back, execute the saved pre-change `CREATE OR REPLACE FUNCTION ...` definition for `cancel_match_with_direct_invite_refund` from that export.
4. Restore source files by extracting the untouched original `Hakotohito_Stripe決済基盤_20261112.zip` over the worktree.

This rollback note intentionally does not invent a prior function body. The live DB definition is authoritative and must be captured immediately before application. No SQL in this package has been applied to Supabase.
