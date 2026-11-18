SUPERSEDED - DO NOT APPLY

The following draft Stripe migrations are retained here only for audit history:
- 20261112_002_stripe_payment_foundation.sql
- 20261112_003_stripe_coin_purchase_hardening.sql

They were replaced by supabase/migrations/20261113_004_stripe_coin_purchase_only.sql.
Do not move these files back into supabase/migrations and do not apply them in
Supabase SQL Editor. The old 002 migration includes generic/Connect/service
payment foundations that are outside the coin-purchase-only limited release.
