# Phase 2 v40 — admin-only dual-role boundary reconciliation (2026-11-18)

## Corrected interpretation of the supplied Supabase data

The latest supplied data dump (`貼り付けたテキスト（1）(20261113-130305).txt`, corroborated by `data.sql`) contains two active users. One has `users.user_type = 'facility'` and owns both a facility profile and a performer profile. This is **not, by itself, a defect**: the established product policy explicitly allows dual-role accounts only when configured by an administrator. The data dump does not identify who created the secondary profile, so it cannot prove either an authorized or unauthorized creation path.

The schema stores only the primary role in `users.user_type`; it permits one row in each of `performers` and `facilities` per user through separate unique constraints. It does not store an administrator grant/audit record for the secondary role. Therefore, the policy boundary must be enforced by server-side provisioning paths, not inferred from the mere presence of both rows.

## Confirmed source-level boundary defect and correction

- `POST /api/performers` verified the caller's LINE ID token and active account, but selected only `users.id` and upserted a performer row for that user without checking the primary `user_type` or administrator authority. A facility-primary user could therefore create a secondary performer profile through the ordinary self-service route.
- The route now selects `id, user_type` and rejects non-performer primary accounts with HTTP 403 before avatar/profile writes. This preserves ordinary performer onboarding and prevents this public route from creating an administrator-only secondary role.
- Existing administrator-configured facility-primary dual-role accounts retain their performer profile and can use the existing profile GET/PATCH path, which requires an already-existing performer row and does not create one.
- `POST /api/facilities` already requires `user_type='facility'`, so a performer-primary account cannot create a secondary facility profile through that self-service route.
- `/api/users` POST creates a primary user only when no active account exists; an existing active account is returned unchanged. It does not provide role switching.
- `/api/admin/users` currently exposes administrator-authenticated user search only. No dedicated application API for granting/revoking a secondary role was found in the inspected source. The current administrator provisioning mechanism therefore remains external to this API surface and must be documented/controlled separately if it is intended to be performed through the product UI.

## Dual-role lifecycle and v39 migration review

- The dual-profile row in the data snapshot is treated as an expected administrator-configured account, not as proof of an authorization breach.
- The withdrawal risk remains real: later withdrawal migrations branch on primary `users.user_type`, whereas migration 006 discovered both profile rows. For an authorized facility-primary dual-role account, a primary-role-only withdrawal can leave performer-side data/activity behind.
- Candidate migration `20261118_016_integrated_withdrawal_dual_role_lifecycle_notifications.sql` independently discovers and locks both profiles, processes both role-owned activity sets, and preserves the deferred direct-invitation fee lifecycle. It remains candidate-only and is not approved for application until the exact target catalog and full migration chain are verified.
- Migration 016's preflight intentionally requires the preceding global mutation gate, application-attempt, Outbox, and withdrawal wrapper objects. It is not a standalone hotfix for the currently exported database snapshot.
- The supplied schema/data snapshots predate later application-attempt and Outbox migrations. The 2026-11-17 function inventory does not prove that all later migrations are applied. The user's statement that the database has not changed since the latest upload is retained as the current-state premise, but it does not make older exports complete for later schema objects.

## Cross-cutting checks (24 items)

1. Loaded the latest timestamped Supabase data dump and corroborating `data.sql`.
2. Confirmed two active user rows in the supplied data snapshot.
3. Confirmed one facility-primary account owns both profile types.
4. Corrected the audit interpretation: dual-role existence is allowed when administrator-configured.
5. Confirmed the data snapshot cannot identify the actor who created the secondary profile.
6. Confirmed `users.user_type` represents the primary role only.
7. Confirmed separate unique constraints on `performers.user_id` and `facilities.user_id`; both profile rows can coexist.
8. Found that public performer POST lacked a primary-role/admin boundary.
9. Added a fail-closed primary-role check before avatar/profile writes.
10. Preserved normal performer-primary onboarding.
11. Confirmed performer profile PATCH requires an existing performer row and does not create one.
12. Confirmed facility POST already requires facility-primary role.
13. Confirmed existing active accounts cannot change `user_type` through `/api/users` POST.
14. Confirmed no role-switch API was found in the inspected routes.
15. Confirmed `/api/admin/users` is admin-authenticated search, not secondary-role provisioning.
16. Rechecked withdrawal migration 006 versus later 009/013 replacement behavior.
17. Rechecked candidate migration 016 discovers both profiles independently.
18. Rechecked global mutation gate acquisition precedes account row locks in migration 016.
19. Rechecked protected matched lessons and disputed matches block withdrawal.
20. Rechecked pending lesson counterpart notifications are captured before withdrawal cleanup.
21. Rechecked no-debit direct invitations are rejected without fabricating a refund.
22. Rechecked attempt rows are closed alongside rejected applications.
23. Rechecked band invitations and disband notifications are collected before membership cleanup.
24. Rechecked root/nested source and migration copies are synchronized.

## Remaining release gates

- Decide/document the administrator-only secondary-role provisioning procedure. If provisioning must occur inside the app, add a dedicated `requireAdmin` route that identifies the target user explicitly; do not reuse the self-service performer POST route.
- Review the v39 migration 016 against the exact current Tokyo database catalog and migration history before any application.
- Verify profile/avatar atomic-write behavior and the remaining Outbox/Cron operational constraints.
- PostgreSQL validation, SQL execution, LINE device checks, build, tests, lint, typecheck, local checks, deployment, commit, and push were not performed.
- No Supabase, GitHub, or Vercel state was changed.
- Stripe coin purchase remains disabled; lesson functionality remains enabled.

**Release status: BLOCKED.** This batch corrects the dual-role policy interpretation and closes the identified public performer-profile creation boundary in the candidate source.
