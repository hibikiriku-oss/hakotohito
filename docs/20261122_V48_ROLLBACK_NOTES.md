# V48 rollback notes

V48 migrations are forward-oriented. Do not blindly drop participant claims, snapshot columns, or band trade history after real users have created new attempts: those rows are the permanent same-request no-retrade evidence required by the product policy.

If V48.001 fails, its transaction should roll back as a whole. Do not rerun until the reported preflight/constraint conflict has been reconciled.

If V48.002 fails, its transaction should roll back. The application PATCH route must not be deployed until `update_band_profile(uuid,uuid,text,text)` exists and its EXECUTE ACL is service_role-only.

For an application rollback, restore the previous application deployment only if it remains compatible with the applied database schema. Keep additive columns/tables/triggers in place unless a separately reviewed forward migration proves safe removal. Do not delete claim/history rows.
