# Phase 2 v23 — withdrawal lesson-application lifecycle follow-up

Date: 2026-11-18 (JST)  
Baseline: v22 candidate  
Scope: static review of migration 010 account guards against the existing `withdraw_user_account(text)` routine. No database execution or live DB access.

## Finding (P1 lifecycle consistency)

The existing withdrawal routine rejects withdrawal when a lesson application is already `matched`, then closes the performer's open lesson offers. It does not close pending `lesson_applications` where the withdrawing performer is either the applicant or the owner/teacher of the offer.

Migration `20261118_010_active_account_mutation_guards.sql` rejects updates to lesson applications whenever either participant is not active. Therefore, leaving pending rows behind can strand them: after withdrawal, ordinary API updates are correctly rejected by the guard, but no terminal transition has been performed by the withdrawal transaction.

## Candidate remediation

Added migration `20261118_011_close_pending_lesson_applications_on_withdrawal.sql`:

- Adds a `BEFORE UPDATE OF account_status` trigger on `public.users`.
- Runs only for `active` → `withdrawn` performer transitions.
- Locates the performer's profile and fails closed if it is missing.
- Changes only `pending` lesson applications to `rejected`, both those submitted by the performer and those received on the performer's lesson offers.
- Does not alter `matched`, `completed`, `cancelled`, or already rejected rows.
- Runs before the users row changes, so the existing active-account lesson guard still observes both participants as active during this controlled cleanup.
- Uses the already established global mutation gate and requires the users/lesson_applications gate triggers plus the v21 account guard.

The migration includes catalog preflight checks for required columns, the `rejected` enum label when status is an enum, and expected trigger/function presence. It is a candidate only; the target Tokyo schema and the status CHECK constraints must still be inspected before applying.

## Additional static checks

- Confirmed the existing `withdraw_user_account(text)` checks for matched lessons before the withdrawal cleanup and closes open teacher offers before changing `users.account_status`.
- Confirmed the existing routine's order permits a BEFORE-user-update cleanup to execute before the account becomes withdrawn.
- The migration is deliberately limited to pending applications; it does not cancel matched lessons or bypass the existing matched-lesson withdrawal block.

## Verification boundary

No PostgreSQL execution, disposable DB test, concurrency test, build, lint, test, typecheck, or local checks were performed. No Supabase, GitHub, or Vercel changes were made. Release remains **BLOCKED** pending read-only Tokyo preflight, migration execution validation, and controlled LINE verification.


## v24 follow-up: status constraint preflight and notification boundary

Static review found that v23 checked the `rejected` label only when the status
column is a PostgreSQL enum. A text/varchar column may instead have a CHECK
constraint that excludes `rejected`. The v24 candidate extends migration 011
to fail closed when a CHECK constraint referencing `status` does not visibly
permit `rejected`. This is a conservative catalog-text check, not proof that
all possible domain/custom validation logic is compatible; the Tokyo schema
and any domain constraints still require read-only inspection.

The existing lesson notification outbox migration enqueues on application
INSERT and lesson-offer updates, but does not establish a notification for
this withdrawal-driven application status transition. The current candidate
therefore guarantees transactional status cleanup only; it does not claim
that affected counterparties receive a dedicated rejection notification.
That notification behavior remains an explicit product/operations decision
and must be reviewed before release.

No live DB execution, PostgreSQL tests, build, lint, test, typecheck, or local
checks were performed.
