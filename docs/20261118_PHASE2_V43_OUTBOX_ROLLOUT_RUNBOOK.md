# v43 Outbox expand/contract rollout and safe migration procedure

## Purpose

Migration `20261118_004_harden_line_notification_outbox.sql` changes the claim result and adds lease-token-fenced acknowledgement RPCs. To avoid breaking the currently deployed application, v43 keeps the old acknowledgement signatures temporarily. Migration `20261118_017_retire_legacy_outbox_acknowledgement_rpcs.sql` removes them only after the new application is deployed and old instances have drained.

Migration 004 also no longer marks all queued notifications `failed`. It aborts if any Outbox row is `pending` or `processing`, so notification loss cannot be hidden by the migration.

## Required rollout order

1. **Take/verify a recoverable database backup** and confirm the target project. Do not start if the restore point is not known.
2. In Supabase SQL Editor, apply the prerequisite migration chain through `20261116_023` and `20261118_001`–`003` in the intended order. There is no Hakotohito-owned `supabase_migrations.schema_migrations` ledger; Supabase internal migration tables are not this app's history. Record each filename and successful COMMIT manually in `PUBLIC_RELEASE_CHECKLIST.md`, and use live function/table/column/trigger markers to avoid reapplying an existing migration.
3. Before migration 004, run `docs/20261118_OUTBOX_READONLY_PREFLIGHT.sql`. Review Outbox counts and duplicate active LINE IDs. If any row is `pending` or `processing`, **stop**. Drain the queue with the currently deployed worker or reconcile each row explicitly; do not mass-mark rows failed. Re-run the preflight and proceed only when both counts are zero and active LINE ID duplicates are zero.
4. Apply migration `20261118_004_harden_line_notification_outbox.sql`. It independently rejects any pending/processing row and duplicate active LINE IDs. It keeps the legacy complete/retry RPC signatures temporarily and adds the lease-token signatures. The currently deployed app can therefore continue using its old acknowledgement contract during the remaining SQL rollout.
5. Apply dependent migrations `20261118_005` through `20261118_016` in order, including `20261118_015` before `20261118_016`. Follow each migration's preflight and stop on any exception. Migration 016 must not be treated as standalone. **Do not apply migration 017 yet.**
6. Deploy the v43 application bundle. Wait for Vercel to report Ready and for old instances/requests to drain. The v43 worker uses the lease-token acknowledgement signatures whenever the claim result includes `lease_token`; its legacy branch is only a compatibility fallback.
7. Re-run the Outbox preflight/status query. If any row remains `processing`, wait for the lease to finish/expire and investigate; do not apply migration 017 yet.
8. Apply `20261118_017_retire_legacy_outbox_acknowledgement_rpcs.sql`. Its preflight requires the lease-token RPCs, a claim result exposing `lease_token`, and zero `processing` rows. It then drops only the old one-argument complete and two-argument retry signatures.
9. Run controlled test-account LINE notification flows. Confirm claim returns a lease token, complete/retry uses it, Outbox status transitions are correct, and no unintended recipient receives a push.

## Important stop conditions

- Backup/restore point is not verified.
- Any pending/processing Outbox rows before migration 004.
- Duplicate active `users.line_user_id` values.
- Missing prerequisite migration/function/trigger or an unexpected SECURITY DEFINER signature.
- The v43 Vercel deployment is not Ready or an old instance may still be executing before migration 017.
- A bulk migration command would apply migration 017 before the v43 deployment; split the migration run so 017 is applied manually only at step 8.
- Any `processing` Outbox row remains before migration 017.
- Target schema/function/trigger markers differ from the expected chain or a migration appears partially applied.

## Scope and limitations

This is a rollout-safety design based on static source inspection. No SQL was executed, no PostgreSQL parser/runtime was used, and the Tokyo database catalog was not queried. The target's actual schema/function/trigger markers must be verified with read-only SQL before any change; record the manual SQL Editor application log in the checklist.
