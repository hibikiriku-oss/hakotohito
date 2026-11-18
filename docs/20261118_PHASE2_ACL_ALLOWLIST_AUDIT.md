# 2026-11-18 Phase 2 ACL allowlist correction

## Finding

The v5 migration `20261118_003_lock_down_security_definer_rpc_acl.sql` listed the 49 new/current candidate RPC signatures, but omitted three existing `public` SECURITY DEFINER helpers present in the supplied 2026-11-17 database function export:

- `configured_coin_fee(text, integer)`
- `configured_lesson_fee(integer)`
- `set_initial_coin_balance()`

The migration rejects any unlisted public SECURITY DEFINER function before changing ACLs. Therefore, against the supplied function export, the v5 migration would abort before applying its ACL changes. This was a deterministic static mismatch, not a live database execution result.

## Correction in this candidate

- Add the omitted existing exact signatures to the explicit reviewed allowlist. The list now contains 53 exact signatures: 49 candidate signatures plus four existing database signatures (the three helpers above and the legacy cancellation wrapper).
- Apply the same `pg_catalog, public, pg_temp` search path and revoke `PUBLIC`, `anon`, and `authenticated` EXECUTE from the three helpers.
- Do not grant direct `service_role` EXECUTE to `set_initial_coin_balance()`: it is a trigger function and should remain callable through its installed trigger, not directly by the API role.
- The two `configured_*` helpers remain executable by `service_role`, consistent with the candidate's server-side RPC execution model. Their owner retains execution for nested calls from SECURITY DEFINER functions.

## Remaining gate

This correction is based on the supplied 2026-11-17 function export and static candidate SQL. Before any production application, obtain a fresh read-only function inventory and compare exact signatures, owners, ACLs, trigger bindings, and `search_path`. No SQL was executed and no database was changed for this correction.

## Additional v6 findings and corrections

- The supplied 2026-11-17 function export also contains `cancel_event_request_with_refund(uuid, uuid)` as a SECURITY DEFINER wrapper. It was absent from the v5 ACL allowlist, so v5 would still abort on that export even after adding the three helper functions. v6 adds it to the reviewed allowlist and retains its direct `service_role` EXECUTE grant during the compatibility window, because an older deployed application may still call it until the Outbox route is deployed and old instances are drained.
- The facility application-accept API used `select("*")` for `performance_requests` but consumed only `id`, `request_type`, and `status`. v6 narrows the server-side read to those fields, avoiding unnecessary retrieval of venue and other private request fields.
- Favorites authentication now also requires `account_status = active`, matching the active-account gate used by other privacy-sensitive APIs.

## Trigger-only EXECUTE privilege correction

The ACL loop must not grant direct `service_role` EXECUTE to trigger functions. PostgreSQL invokes an installed trigger function as part of the triggering statement; the caller does not need direct EXECUTE on the trigger function. v6 therefore keeps the following trigger-only functions out of the service-role grant while still revoking `PUBLIC`, `anon`, and `authenticated` and hardening their search paths: `acquire_global_mutation_gate_trigger`, `set_initial_coin_balance`, `enqueue_application_attempt_line_notifications`, `enqueue_band_invitation_line_notification`, `enqueue_completion_report_line_notifications`, `enqueue_lesson_application_line_notification`, `enqueue_lesson_offer_update_line_notifications`, `enqueue_match_completion_line_notifications`, and `enqueue_match_established_line_notifications`.

The legacy `cancel_event_request_with_refund(uuid, uuid)` wrapper remains granted to `service_role` during this pre-deployment compatibility stage, because the currently deployed application may still call it until the new Outbox route is deployed and old instances are drained. It should be considered for revocation only in a separate post-deployment migration after that drain is verified.
