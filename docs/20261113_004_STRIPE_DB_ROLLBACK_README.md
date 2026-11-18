# 004 migration rollback / recovery policy

The Stripe coin-purchase migration creates financial order, webhook, incident,
and audit-history records. A simple `DROP TABLE` rollback is unsafe after any
real Checkout session, payment, refund, dispute, or admin action has been
recorded.

## Immediate containment

1. Disable `coin_purchase_enabled` in the admin payment settings.
2. Disable or pause the Stripe webhook endpoint only if necessary to stop a
   confirmed incident; preserve Stripe event delivery and dashboard records.
3. Do not delete payment orders, webhook events, payment incidents, incident
   actions, or coin ledger rows.
4. Take a fresh Supabase backup and export the affected orders, ledger rows,
   webhook events, and incidents.
5. Reconcile every paid / paid_review / refunded / disputed order with Stripe
   before deciding whether a code or schema rollback is appropriate.

## Schema rollback

No automatic destructive rollback SQL is supplied. After financial activity,
removing the tables or `coin_purchase_yen_per_coin` can destroy audit evidence
and break the coin ledger's relationship to actual Stripe payments. Any schema
rollback must be designed against the live records and approved separately.

## Before any payment activity

Even before the first payment, do not apply a generic `DROP` script without
confirming that the migration was applied exactly once, that no webhook events
or orders exist, and that the current source has been disabled. Preserve the
migration file and its history for audit purposes.
