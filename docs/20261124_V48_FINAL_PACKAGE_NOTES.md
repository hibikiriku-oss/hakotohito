# V48最終修正パッケージ — 2026-11-24

## 統合元
- Production source archive: `hakotohito-1258308fbb7aaaca8d140e061032c36fb139464d.zip`（Production commit `1258308fbb7aaaca8d140e061032c36fb139464d`）
- V48 candidate source: V12 coin purchase resumption candidate, as integrated in the V3 package
- Supabase exports: 2026-11-23 16:45–16:54 JST uploaded function definitions for `cancel_match_with_direct_invite_refund`, `cancel_event_request_with_refund_internal`, `withdraw_user_account`, and direct-invitation refund helpers

## Included changes
- New migration `20261124_001_v48_source_linked_refunds_and_fee_lifecycle.sql` adds source debit references and a unique source refund index, defines an atomic refund helper, and replaces the two production cancellation RPCs using the supplied live definitions.
- Direct-invitation rejection and withdrawal refund writers now call the source-linked helper.
- Existing V48 event/rental match-time transaction fees and facility reward fees are refunded from their exact source debit rows on individual and request-wide cancellation. Existing legacy refund rows are linked rather than paid again when their idempotency key and payload match.
- The request-level once-only event/rental initial fee is linked only when the existing request-wide policy has actually refunded it.
- Completion-fee logic skips the legacy event/rental completion fee if the V48 per-match event transaction fee was already charged.
- Adds lesson cancellation RPC and authenticated API route. The refund source is taken from `lesson_fee_snapshots.coin_transaction_id`.
- Integrated withdrawal migration updated: facility withdrawal continues to cancel its active matches; performer withdrawal does not cancel established matches and instead queues counterpart notification. Leadership handover uses `band_members.joined_at`; only bands without an eligible active successor are disbanded.

## Important compatibility notes
- The source-linked refund helper deliberately fails closed if a historical refund key exists with a payer, amount, or reference mismatch. It does not guess which old ledger row is the source.
- The V48.005 lesson snapshot table is a prerequisite. The final migration checks this and other required objects before changing functions.
- The integrated withdrawal migration (`20261118_016`) must be included in the ordered Supabase migration set. If already applied, the new migration set still needs the final updated function definition from the package to be deployed; do not re-run old migrations blindly.
- Coin purchase remains disabled. Stripe Connect, marketplace flows, and band coin transfers remain disabled.

## Execution status
This package was assembled from uploaded archives and Supabase function exports. No Supabase SQL was executed, no production data was changed, no GitHub Push or Vercel Deploy was performed, and no build/lint/test/typecheck/local checks were run. Therefore it is a consolidated release candidate, not a claim of live deployment success. Apply SQL only after confirming which existing migrations are already applied and taking a production backup.
