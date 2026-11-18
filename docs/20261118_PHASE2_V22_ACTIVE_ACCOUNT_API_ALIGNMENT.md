# Hakotohito Phase 2 v22 — active-account API alignment audit

Date: 2026-11-18 (JST)  
Baseline: v21 candidate  
Scope: static source review and read-only preflight refinement. No PostgreSQL execution or live DB access.

## 1. Findings

The v21 database row guards are the authoritative defense against stale requests that passed LINE verification before account withdrawal. A second, earlier API-layer check was still missing in three profile entry paths:

- `src/app/api/facilities/route.ts`: `getFacilityUser()` resolved a LINE-linked user without filtering `account_status='active'`. This helper is used by facility profile GET/POST/PATCH.
- `src/app/api/performers/route.ts`: performer registration resolved the LINE-linked user without filtering active status before avatar/profile writes.
- `src/app/api/performers/profile/route.ts`: both GET and PATCH resolved the LINE-linked user without filtering active status.

This did not bypass the v21 database guards for protected writes, but it allowed withdrawn accounts with a still-resolvable LINE link to proceed farther through API logic and could expose retained profile data through GET paths. The API checks are now aligned with the active-account policy. Database row guards remain necessary because API checks alone cannot close the read-then-write race.

## 2. Source changes

Added `.eq('account_status', 'active')` to the user lookup in the facility helper, performer registration, and both performer profile lookup paths. No client-supplied user ID was introduced; identity continues to derive from the verified LINE ID token subject.

The four source files were synchronized between the archive root and nested `music-matching/` project. No SQL migration was changed in v22.

## 3. Direct-DML review and remaining partial-write issue

The static API inventory reconfirmed direct writes in:

- performer registration: avatar update followed by performer upsert;
- facility registration: avatar update followed by facility upsert;
- facility profile PATCH: facility update followed by avatar update;
- performer profile PATCH: performer-only update;
- performance request create/update: direct DML protected by v21 account/request guards and status/owner predicates;
- inquiries/favorites: direct DML protected by v21 account guards for INSERT; favorites DELETE only removes the caller's own relation;
- completion-report timestamps: direct match UPDATE uses active-match compare-and-set predicates and global gate.

The split avatar/profile requests remain a P2 consistency issue: a transient failure can leave only one half updated. This is not repaired by v22. A single profile RPC should be designed only after the exact target table columns, unique constraints, return contract, and current Tokyo DB schema are confirmed. No speculative RPC or schema assumption was added.

## 4. Read-only preflight refinement

Added `docs/20261118_PHASE2_V22_READ_ONLY_PREFLIGHT.sql` to report the exact `data_type`/`udt_name` for columns consumed by migration 010 and to inventory the active-account and global-gate triggers. It emits catalog metadata and aggregate counts only; it does not expose user identifiers or free text and performs no writes.

The uploaded Supabase materials currently available remain function/catalog/ACL/RLS/trigger exports, not a current post-reset operational row snapshot or complete table-column/constraint export. The 2026-11-13 business-row dump remains excluded as stale evidence.

## 5. Verification boundaries

- Static source edits only; no build, lint, test, typecheck, or local checks, per instruction.
- No PostgreSQL parser/runtime, disposable DB, concurrency test, or live Supabase query was run.
- No Supabase, GitHub, or Vercel mutation was performed.
- Stripe coin purchase remains disabled for limited release; lesson functionality remains enabled.
- Release remains **BLOCKED** pending target read-only preflight, migration execution tests, concurrency tests, and controlled LINE verification.
