# Phase 2 follow-up audit v10 — 2026-11-18

## Scope
Static source review of v9 candidate, focusing on Outbox transaction locking, notification drain scheduling, account privacy, and API call paths. No live Supabase connection, SQL execution, build, lint, test, typecheck, Git operation, push, or deploy was performed.

## P0/P1 finding fixed in candidate

### Migration 004 lock-order inversion
`20261118_004_harden_line_notification_outbox.sql` previously acquired only its migration-specific advisory lock, then took DDL/table locks, and later updated `line_notification_outbox`. The table's statement trigger acquires the application-wide mutation gate (`2147483000, 20261116`). A concurrent application writer could therefore hold the global gate while waiting for the migration's table lock, while the migration held that table lock and waited for the global gate. This is a lock-order inversion and can deadlock during migration.

**v10 change:** acquire the application-wide mutation gate immediately after the migration-specific advisory lock, before any DDL/table lock. Preflight now also fails closed unless the Outbox global-gate trigger and helper function exist. This serializes the migration against application writers using the same lock contract.

## P1 operational finding — Outbox drain schedule

`vercel.json` schedules `/api/cron/line-notification-outbox` at `5 2 * * *` (once daily). The worker clamps every drain invocation to at most five parallel deliveries, including callers passing 20 or 100. API-triggered drains cover immediate notifications but can leave the remainder of event-wide or high-fanout notifications pending. With a daily cron, leftover messages may wait close to a day if no later API action drains them.

No cron schedule change is made in v10 because the appropriate remedy depends on the Vercel plan and operational choice. Vercel documents Hobby cron as once per day (±59 minutes) and Pro/Enterprise as once per minute. Before release, confirm the project's plan and choose either a supported frequent Vercel schedule or an external scheduler. Do not represent daily cron as timely retry delivery.

## Other reviewed areas

- Withdrawal wrapper excludes the withdrawing LINE identity from all three notification arrays; counterpart recipient UUID resolution is performed by the Outbox trigger.
- Direct-invite acceptance coin-insufficiency notice targets the facility payer.
- Cancellation wrappers validate actor ownership/role before invoking the existing refund/cancellation routines.
- Facility profile address is returned only through the owner-authenticated profile route; public request/map paths use per-request `venue_address`, not facility profile address.
- Stripe Connect onboarding route is hard-disabled (403) for limited release; coin-purchase POST is hard-disabled (403), while the webhook remains present for already-created sessions. Existing sessions and live DB flags still require operational review.
- Several API user lookups rely on the withdrawal routine rewriting the LINE ID to `withdrawn:<uuid>`; active-status filtering is inconsistent. Because withdrawn LINE IDs are rewritten, this is not by itself a demonstrated access bypass, but adding `account_status='active'` consistently remains a hardening follow-up.

## Release blockers still open

1. Run `docs/20261118_OUTBOX_READONLY_PREFLIGHT.sql` against the intended Tokyo database and review pending/processing counts and duplicate active LINE IDs.
2. Confirm whether dropping legacy pending/processing Outbox rows to `failed` is operationally acceptable before applying migration 004.
3. Confirm Vercel plan/scheduler capability and change the daily drain schedule or provide an external scheduler.
4. Execute migrations in dependency order on a disposable/test DB, then perform LINE real-device delivery/retry/withdrawal tests.
5. Confirm existing Stripe Checkout sessions are reconciled; do not assume disabling new purchases cancels old sessions.

## Candidate status

Candidate-only source/documentation changes. No production DB, repository, GitHub, or Vercel changes. No build/test/lint/typecheck/local checks. Release decision remains **BLOCKED** pending the operational and database evidence above.
