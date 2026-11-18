# Phase 2 v34 — profile input normalization parity and lifecycle batch audit

Date: 2026-11-18 JST  
Baseline: v33 candidate. No Tokyo preflight SQL was executed.

## Scope

A 26-point source-only review covered performer profile POST/PATCH input handling, cache headers, profile/avatar multi-write boundaries, facility profile POST/PATCH, dual-role withdrawal lineage, direct-invitation fee lifecycle, band transfer/application account guards, notification Outbox coverage and drain behavior, lesson application lifecycle, active-owner public visibility, API identity checks, mutation-gate ordering, and release checklist consistency.

## Changes in v34

1. Added `src/lib/profile-input.ts` with `normalizeRequiredStringArray`.
2. Performer profile POST now uses the shared normalizer for instruments and genres. It trims values, removes duplicates and blank strings, and rejects non-array or mixed-type payloads rather than silently discarding malformed elements.
3. Performer profile PATCH now uses the same normalizer, closing the POST/PATCH behavior gap. It persists the normalized values after validation.
4. Root and nested `music-matching/` source copies are synchronized.

The normalizer intentionally does not impose a maximum item count or string length because the current source snapshot does not establish a reliable matching DB/UI contract for those limits. No new limits are guessed.

## 26-point audit record

1. Performer profile POST cache policy — private no-store helper covers success and error responses.
2. Performer profile PATCH cache policy — private no-store helper covers success and error responses.
3. Performer POST instrument normalization — trimmed, deduplicated values validated before persistence.
4. Performer POST genre normalization — trimmed, deduplicated values validated before persistence.
5. Performer PATCH instrument normalization — now shares POST behavior.
6. Performer PATCH genre normalization — now shares POST behavior.
7. Mixed-type instrument arrays — now rejected instead of silently filtered.
8. Mixed-type genre arrays — now rejected instead of silently filtered.
9. Empty normalized instrument arrays — rejected.
10. Empty normalized genre arrays — rejected.
11. Performer status-level allowlist — `beginner`, `amateur`, `pro` remains enforced.
12. Performer POST avatar write — remains a separate REST transaction from profile upsert.
13. Performer POST failure after avatar write — partial persistence remains possible.
14. Facility POST avatar write — remains separate from facility upsert.
15. Facility PATCH profile/avatar writes — remain separate REST transactions.
16. Profile/avatar atomicity — requires a schema-verified transactional RPC; unresolved.
17. Dual-role withdrawal — migration 013 still selects lifecycle by primary `users.user_type`; secondary-role cleanup not proven.
18. Migration 006 dual-role logic — cannot be restored alone because later cancellation/refund/application-attempt logic must be preserved.
19. Direct invitation creation — no fee charged at creation in current candidate migration 012.
20. Direct invitation fee amount — configured `direct_invitation_fee_coins` is snapshotted.
21. Direct invitation attempt — `application_attempts` row and seven-day expiry retained.
22. Direct invitation match establishment — fee charged in match-creation transaction with attempt-specific idempotency.
23. Band transfer — migration 014 checks both active accounts and active membership; PostgreSQL execution remains unverified.
24. Band application — migration 014 checks every active member's owning account; PostgreSQL execution remains unverified.
25. Notification Outbox — ordinary/lesson application rejection, expiry, band invitation cancellation and disband events remain incomplete.
26. Outbox drain operations — worker clamps batches to five; cron is daily; backlog recovery and duplicate-delivery operations remain unresolved.

## Unresolved release blockers

| Priority | Area | Status |
|---|---|---|
| P1 | Dual-role withdrawal preserving migration 013 refund/accounting lifecycle | Unresolved; schema/function contract review required |
| P1 | Atomic performer/facility profile and avatar writes | Unresolved; no speculative RPC introduced |
| P1 | Withdrawal ordinary/lesson application counterpart notifications | Unresolved; recipient/message contract required |
| P2 | Band invitation cancellation and disband notifications | Unresolved |
| P2 | Expiry and event-application status notifications | Unresolved |
| P2 | Outbox backlog, retry, monitoring and duplicate delivery runbook | Unresolved |
| P2 | Tokyo DB relationship/constraint/function ACL verification | Pending; user currently has no execution environment |

## Verification boundary

Source-level inspection and text/package integrity checks only. No SQL execution, PostgreSQL parser/runtime validation, build, test, lint, typecheck, or local checks. No Supabase, GitHub, or Vercel changes. ZIP integrity, SHA-256, and root/nested source-copy equality were checked.

Release remains **BLOCKED**.
