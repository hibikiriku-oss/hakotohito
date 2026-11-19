# v20 package manifest

Baseline: v19.

Changes:
- Corrected the exact `to_regprocedure` signatures for both atomic chat GET RPCs in migration 007.
- Added `20261118_009_stripe_global_lock_order.sql` to explicitly acquire the shared mutation gate before row locks in three Stripe functions.
- Removed lexicographic event-ID ordering for distinct Stripe events in the same second; the RPC now fails closed with `ambiguousOrdering` and the webhook route surfaces a controlled processing error.
- Added `docs/20261118_PHASE2_V20_LOCK_ORDER_AUDIT.md` and updated release checklist.
- Root project and nested `music-matching/` project copies are synchronized.

No build, lint, test, typecheck, local checks, live SQL, Git operation, GitHub push, or Vercel deploy was performed.
Release remains BLOCKED.
