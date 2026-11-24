# V48 Stripe coin purchase migration audit — 2026-11-23

## Scope
Read-only review of the exact production candidate v11 archive and the user-provided live-schema preflight results. No database changes, deployment, push, or purchase enablement were performed.

## Confirmed live state
- `coin_rate_settings` does not yet contain the three new rate columns.
- `stripe_webhook_events` has the legacy four-state CHECK constraint; lease columns and `claim_stripe_webhook_event(text,text)` are absent.
- The existing `stripe_event_id` unique index was previously reported and the CHECK definition matches the migration's exact normalization contract.
- Legacy refund/dispute incident rows missing event-order metadata: 0.
- `payment_orders`: 0 rows, 0 coin-purchase orders, 0 pending orders.
- All six global mutation-gate triggers are enabled.

## Review findings
- Migration 003 adds the purchase-rate column with default 10 and two independent fee-rate columns with default 10; it does not overwrite the existing fee columns or existing row values. The two new fee columns are part of the V48 rate-settings contract and should be treated as a single migration.
- Migration 005's exact legacy CHECK replacement matches the production definition supplied by the user. It adds lease fields and a service-role-only SECURITY DEFINER claim RPC with `search_path = pg_catalog, public, pg_temp`.
- Migration 006's RPC signature matches the webhook source call. Its preflight requires migration 005 and the existing global gate. The zero-row legacy metadata check satisfies its stated data precondition.
- Migration 011's partial unique index matches the intended pending-order rule. The live order table is empty.

## Candidate correction made in v12
The v11 versions of migrations 005 and 011 performed schema changes without first taking the repository's shared advisory mutation lock. This could race with existing gated writes or make the duplicate preflight less deterministic. v12 now takes `pg_advisory_xact_lock(2147483000, 20261116)` before the 005 preflight/DDL and wraps 011's duplicate preflight and index creation in one transaction under the same lock.

## Apply status
Candidate only. Do not apply until the user explicitly approves applying each production migration. No SQL was executed against Supabase. No build, lint, test, or local checks were run.
