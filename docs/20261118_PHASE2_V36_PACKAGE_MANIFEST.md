# Phase 2 v36 package manifest

- Baseline: v35 candidate.
- Scope: 28-point source-only audit.
- New candidate migration: `20261118_015_expired_application_notification_outbox.sql`.
- Migration behavior: enqueue counterpart notifications only when the latest application attempt expired and the application transitions pending -> rejected.
- Recipients: active performer account for individual/direct invitation; active band members for band application.
- Manual rejection is intentionally excluded. The migration preflight requires the hardened recipient-binding trigger and columns from migration 004.
- Root and nested migration/document copies synchronized.
- No SQL executed; no build/test/lint/typecheck/local checks.
- No Supabase/GitHub/Vercel changes.
- Release status: BLOCKED.
