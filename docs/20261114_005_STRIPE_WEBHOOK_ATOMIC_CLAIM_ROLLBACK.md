# 2026-11-14 Stripe webhook atomic claim migration candidate

## Status

Candidate only. Not applied to Supabase. The live schema must be inspected first.

## Purpose

Prevent concurrent Stripe deliveries of the same `stripe_event_id` from both
processing a row whose status is merely `received`. The claim function uses a
row lock, a per-attempt UUID token, and a five-minute lease. A failed or stale
attempt can be reclaimed; `processed` and `ignored` events remain terminal.

## Required source contract

The webhook route must call `claim_stripe_webhook_event(event.id, event.type)`
before doing any side effects. It must require `claimed=true`, retain the
returned `processingToken`, and include that token in every subsequent event
status update. If the event is already terminal, return a successful duplicate
response. If another worker owns a live lease, return a retryable non-2xx
response. Updates that affect zero rows must be treated as lost ownership and
must not be reported as successful processing.

## Apply prerequisites

1. Confirm the exact database project and environment.
2. Confirm `stripe_webhook_events` columns, constraints, owner, RLS, grants, and
   existing rows.
3. Confirm no existing claim/lease implementation or function with the same
   signature exists.
4. Back up the database and retain the current webhook route and migration
   history.
5. Apply only after the matching webhook source revision is approved.

## Rollback

Rollback must be performed only after webhook traffic is paused and no event is
in-flight. Drop `claim_stripe_webhook_event(text,text)`, then drop the partial
index, then remove the added check constraint and columns. Restore the original
`processing_status` check constraint to the exact pre-apply definition. Do not
blindly execute a rollback before capturing that definition, because this
migration intentionally replaces the status check constraint discovered on the
live table.
