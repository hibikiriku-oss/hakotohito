# Hakotohito Phase 2 v20 — lock-order and migration preflight follow-up

Date: 2026-11-18 (JST)
Baseline: v19 candidate.
Scope: static source and SQL review only. No PostgreSQL execution or live DB access.

## 1. v19 defects corrected

Migration `20261118_007_atomic_invitation_and_chat_writes.sql` checked for the two GET RPCs using signatures that omitted their final `p_line_user_id text` argument. The actual function definitions and API calls use the text argument. The preflight checks now use the exact seven-/three-argument signatures. This prevents the migration's duplicate-function guard from silently checking the wrong overload.

## 2. Stripe global-lock ordering issue found

The exported DB function definitions showed that `manage_stripe_payment_incident` and `complete_stripe_coin_purchase` lock rows with `SELECT ... FOR UPDATE` before a subsequent UPDATE statement reaches the global mutation-gate trigger. The `claim_stripe_webhook_event` implementation relies on its table trigger to acquire the gate during the initial INSERT statement; that implicit dependency is less explicit and harder to audit.

Migration `20261118_009_stripe_global_lock_order.sql` recreates all three functions with an explicit `pg_advisory_xact_lock(2147483000, 20261116)` immediately after `BEGIN`, before validation, DML, or row locks. Business logic is preserved from the uploaded function export / migration 005. Ownership and service_role-only EXECUTE grants are reasserted. Preflight requires the expected global-gate helper, postgres ownership/SECURITY DEFINER, Stripe tables, and enabled gate triggers (bound to the exact helper function) on the relevant write tables, including the coin ledger.

This closes the known Stripe lock-order inversion between the ordered incident RPC (gate then incident row) and the admin incident RPC (formerly incident row then gate). It also makes coin fulfillment and webhook claim lock ordering explicit.

## 3. Remaining Stripe ordering limitation

Stripe `event.created` has second-level granularity. v20 removes the lexicographic tie-break. If distinct events for the same incident share the same creation second, the RPC returns `ambiguousOrdering` without mutating the incident; the webhook route raises a controlled error, leaving the event visible for retry/manual reconciliation. Exact same-event replay remains idempotent. This is fail-closed but still requires operator reconciliation; it does not establish true chronology.

## 4. Verification boundaries

- The source function definitions were taken from the uploaded `supabase関数全体.txt` export and the uploaded migration 005. They are not evidence that the live target currently has exactly those definitions.
- No PostgreSQL parser/runtime, disposable database, concurrency test, build, lint, test, typecheck, or local project check was run.
- No Supabase, GitHub, or Vercel mutation was performed.
- The current post-reset business-row snapshot remains unavailable in uploaded materials.
- Release remains **BLOCKED** pending read-only target preflight, function-definition/hash comparison, PostgreSQL validation, and controlled LINE tests.
