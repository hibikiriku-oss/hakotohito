# Phase 2 v33 — batch audit and band account guards

Date: 2026-11-18 JST
Baseline: v32 reconciled candidate. No Tokyo preflight SQL was executed.

## Scope and outcome

A 30-point source-only review covered: direct invitation fee lifecycle; application-attempt expiry/retry; match establishment charging; performer/facility profile and avatar write boundaries; dual-role withdrawal; band transfer and band application account ownership; notification Outbox events; lesson lifecycle; API auth/cache boundaries; SECURITY DEFINER ACLs; mutation-gate lock ordering; cancellation/refund paths; Stripe limited-release controls; public profile visibility; venue address exposure; and release checklist consistency.

## Changes in this candidate

1. Added migration `20261118_014_active_band_member_account_guards.sql` (root and nested copies).
2. `transfer_band_coins` now rejects transfer unless both sender and recipient user accounts are active, in addition to requiring active membership in the band.
3. `apply_to_performance_request_as_band` now rejects the application if any active band member lacks an active owning user account. The check also fails closed for a missing user row.
4. Both functions retain the global mutation gate as their first lock operation. The existing transaction/idempotency/coin ledger logic is retained from the current candidate definitions.

## Direct-invitation fee regression — retained and rechecked

The v32 correction remains present in migration 012: invitation creation does not call `spend_coins`; it snapshots the configured `direct_invitation_fee_coins` into a pending `application_attempts` record with a seven-day expiry; and match-establishment migration 012 charges the stored fee only in the match-creation transaction using idempotency key `direct_invite_match_fee:<attempt_id>`. The attempt payer must match the facility user. Rejected/expired attempts can be retried through the application lifecycle. No second charge was introduced here.


## Audited checklist (24 source-level checks)

1. Direct invitation creation fee timing — no charge at creation.
2. Direct invitation fee configuration — configured `direct_invitation_fee_coins` is snapshotted.
3. Direct invitation attempt creation — `application_attempts` row is created.
4. Direct invitation expiry — seven-day expiry is retained.
5. Direct invitation retry — rejected/expired application can be retried.
6. Direct invitation party status — facility and performer are checked active after global gate.
7. Direct invitation match establishment — charge occurs in match-creation transaction.
8. Direct invitation payer identity — attempt payer must equal facility user.
9. Direct invitation idempotency — match-fee key is attempt-specific.
10. Individual application fee timing — fee is deferred to match establishment.
11. Band application fee timing — fee is deferred to match establishment.
12. Band application submitting account — active user guard exists.
13. Band application leader authority — active leader membership is required.
14. Band application member levels — every active member is checked against target levels.
15. Band application member account status — migration 014 adds active-owner guard.
16. Band transfer sender membership — active band membership is required.
17. Band transfer recipient membership — active band membership is required.
18. Band transfer sender account status — migration 014 adds active-user guard.
19. Band transfer recipient account status — migration 014 adds active-user guard.
20. Band transfer idempotency — both ledger legs and payload consistency are checked.
21. Band transfer balance locking — user rows are locked in UUID order.
22. Profile/avatar persistence — still split across REST transactions.
23. Dual-role withdrawal — secondary-role cleanup remains unproven.
24. Notification lifecycle — withdrawal, expiry, disband and status-change event coverage remains incomplete.

## Findings retained as unresolved

| Priority | Area | Finding | Status |
|---|---|---|---|
| P1 | Dual-role withdrawal | Current withdrawal routine branches on primary `users.user_type`; secondary-role cleanup is not proven complete. | Unresolved; requires DB role/schema contract reconciliation. |
| P1 | Profile/avatar atomicity | Performer POST, facility POST and facility PATCH still write avatar and profile via separate REST transactions. | Unresolved; do not invent RPC schema without live/catalog confirmation. |
| P1 | Band transfer | Fixed by new candidate migration 014; still requires migration application and DB verification. | Candidate only. |
| P1 | Band application | All active band members now checked for active owning accounts in candidate migration 014; level check remains separate. | Candidate only. |
| P1 | Withdrawal notifications | Pending ordinary and lesson application rejections are not represented by complete counterpart notification events. | Unresolved; recipient/message contract required. |
| P2 | Band notifications | Withdrawal-driven invitation cancellation and leader disband do not notify all affected members/counterparties. | Unresolved. |
| P2 | Event cancellation notifications | Ordinary pending application rejection event coverage remains incomplete. | Unresolved. |
| P2 | Expiry notifications | Expiry worker updates attempts/applications without a complete status-change notification event. | Unresolved; product/operations decision. |
| P2 | Outbox operations | Drain batch is five; schedule is daily; retry/monitoring UX not found in source. | Operational decision. |
| P2 | Profile normalization | Performer POST normalization is corrected in v32; profile PATCH path still needs a separate normalization parity review. | Follow-up. |

## Static observations

- `create_facility_invitation_with_coins` in migration 012 uses configured `direct_invitation_fee_coins`, does not charge at creation, creates `application_attempts`, and sets `expires_at = now() + interval '7 days'`.
- `accept_direct_invitation_with_fee` in migration 012 validates `facility_invite` attempt/payer and charges direct invitation fee during match establishment.
- `transfer_band_coins` in migration 009 checked active band membership but did not check `users.account_status` for both participants; migration 014 adds this.
- Band application RPC in migration 013 checked the submitting user but did not ensure every active member's owning user account was active; migration 014 adds this.
- Profile/avatar writes remain split between separate REST requests in the reviewed routes.
- Existing Outbox triggers cover selected INSERT/UPDATE events but not all withdrawal, expiry, disband and application status transitions.

## Verification boundary

Source-level inspection only. No SQL was executed, no PostgreSQL parser/runtime validation, no build/test/lint/typecheck/local checks, and no Supabase/GitHub/Vercel changes. ZIP integrity, SHA-256, and root/nested migration-copy equality were checked.

Release decision remains BLOCKED pending candidate migration review/application, DB read-only confirmation, unresolved P1 remediation, and real-device operational verification.
