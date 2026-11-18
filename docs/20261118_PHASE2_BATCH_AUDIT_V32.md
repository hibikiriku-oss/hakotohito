# Phase 2 v32 — cross-chat reconciliation and batch audit

Date: 2026-11-18 (JST)
Baseline: v31 candidate, reconciled against the separate 548-file v29 candidate.

## Reconciliation conclusion

The alternate v29 candidate was not fully represented in the v31 line. Three profile items and the direct-invitation RPC regression were compared at source level. The following corrections are now merged into v32:

1. `POST /api/performers` now uses a private `no-store, no-cache, must-revalidate` response helper for success and error responses. This was absent from the v31 route, which only had a no-store header on one error path.
2. Performer instruments and genres are normalized (string-only, trim, remove empty values, deduplicate) before validation. The normalized arrays are the same arrays persisted. Empty-after-normalization values are rejected.
3. The later active-account guard migration `20261118_012_active_account_rpc_guards.sql` previously redefined `create_facility_invitation_with_coins` with an immediate hard-coded 100-coin `spend_coins` call, overwriting the deferred-fee implementation from migration 011. v32 replaces that function body with the corrected version from the alternate v29 candidate: both parties active after the global gate, configurable `direct_invitation_fee_coins`, balance precheck only, `application_attempts` insertion, seven-day expiry, rejected/expired retry lifecycle, and no charge at invitation creation. The band-creation active-account guard is retained.

## Confirmed retained items

- `20261116_011_matching_fee_deferred_to_match.sql` already contains the deferred direct-invitation lifecycle, configurable fee setting, attempt record and seven-day expiry. The defect was the later migration 012 override, not the base 011 definition.
- The cancellation/refund migration 013 remains unchanged; it preserves the existing direct-invitation refund and individual re-application lifecycle.
- The performer profile GET/PATCH route already uses the private cache helper; v32 adds the missing POST route behavior at `/api/performers`.
- The 548-file alternate v29 also records the profile/avatar partial-save issue, dual-role withdrawal, band transfer active-account checks, band application member-account checks, ordinary and lesson application notification gaps, invitation cancellation/disband notifications, and expiry notification gaps. These remain explicit audit items below; no speculative RPC/trigger was added for them.

## Remaining high-priority issues

| Priority | Area | Finding | Status |
|---|---|---|---|
| P1 | Dual-role withdrawal | Later withdrawal definition branches on primary `users.user_type`; secondary profile, matches, pending invites, applications, band membership and lesson cleanup may be missed | Unresolved; requires DB schema/role contract reconciliation |
| P1 | Profile/avatar writes | Performer registration, facility registration and facility PATCH use separate REST transactions for profile and avatar writes | Unresolved; needs a single transactional RPC preserving API contracts |
| P1 | Band transfer | RPC needs explicit active-account checks for both sender and recipient, not only active membership | Unresolved |
| P1 | Band application | Validate every active band member's account state, not only the submitting leader | Unresolved |
| P1 | Withdrawal notifications | Ordinary application rejection and lesson application rejection are not represented in withdrawal Outbox payloads | Unresolved; define recipient/message contract |
| P2 | Band notifications | Withdrawal-driven pending invitation cancellation and leader disband do not emit all counterpart/member notices | Unresolved |
| P2 | Event cancellation | Ordinary pending application rejection notifications are incomplete | Unresolved |
| P2 | Expiry notifications | Expiry changes attempts/applications without a corresponding status-transition event | Unresolved; product/operations decision |
| P2 | Outbox operations | Drain limit is 5 per invocation; scheduled cron is daily; no dedicated queue/retry UI found | Operational decision required |

## Static verification performed

- Compared the 548-file alternate v29, the 550-file local v29 and v31 archives directly.
- Confirmed the v31 active-account guard migration had one `spend_coins` call and no `application_attempts` insertion in the direct-invitation function.
- Confirmed the alternate v29 replacement migration has no `spend_coins` call, uses `direct_invitation_fee_coins`, creates an attempt, and sets `expires_at` to seven days.
- Confirmed both root and nested source copies are synchronized for every v32 edit.
- ZIP integrity and SHA-256 are recorded in the package manifest.

No SQL was executed. No PostgreSQL validation, build, test, lint, typecheck or local checks were run. Supabase, GitHub and Vercel were not changed.
