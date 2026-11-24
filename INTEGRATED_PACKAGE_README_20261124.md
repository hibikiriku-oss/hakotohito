# Hakotohito V48 final remediation package — 2026-11-24

## Contents

This package combines the uploaded Production source archive (`1258308fbb7aaaca8d140e061032c36fb139464d`), the V48 V12 source candidate, the uploaded 2026-11-23 Supabase RPC definitions, the final source changes, ordered Supabase migrations, and release documentation.

## Final remediation included

- Atomic source-linked refund ledger (`coin_transactions.source_transaction_id`) with a unique constraint and exact payer/amount/business-reference validation.
- Source-linked refund integration for individual match cancellation, request-wide cancellation, direct invitation rejection, and withdrawal-time pending direct invitation refunds.
- Existing legacy refund rows are linked only when their known idempotency key and complete transaction payload match. Ambiguous or mismatched rows fail closed; no balance is guessed.
- Event/rental match-time transaction fees suppress the legacy completion-time fee for the same match, preventing double charge.
- Lesson match-fee source is obtained from `lesson_fee_snapshots.coin_transaction_id`; an authenticated lesson cancellation RPC and API route perform the pre-completion refund.
- Performer withdrawal does not automatically cancel already-established performance matches; counterpart facility notification is retained.
- Band leader withdrawal transfers leadership to the oldest active eligible member by `band_members.joined_at`; a band is disbanded only if no eligible active member exists.
- `PUBLIC_RELEASE_CHECKLIST.md` and operational notes updated.

## Supabase migration order

Apply only migrations not already applied, in chronological order. The V48 schema prerequisites are the `20261122_001` through `20261122_005` migrations, plus the existing application/outbox/lifecycle migrations through `20261118_016` and the `20261123` Stripe hardening migrations. Apply `20261124_001_v48_source_linked_refunds_and_fee_lifecycle.sql` after those prerequisites.

Do not replay historical migrations blindly. The production app migration ledger was not confirmed in the uploaded evidence. Back up production first, compare applied migrations, and use the package postflight instructions.

## Release status

**Consolidated remediation candidate — production execution still pending.** The SQL and source changes are included, but no Supabase migration has been executed, no production data has been changed, no GitHub push or Vercel deploy has been performed, and no LINE device test or local build/lint/test/typecheck was run. The package must not be described as live-deployed or production-verified until those steps succeed.

Coin purchase remains disabled pending checkout, webhook, balance-credit and legal review. Stripe Connect, marketplace and peer-to-peer/band coin transfers remain disabled.
