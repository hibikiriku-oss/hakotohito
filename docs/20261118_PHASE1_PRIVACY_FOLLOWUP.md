# 2026-11-18 Phase 1 privacy follow-up

## Scope

Candidate baseline: `Hakotohito_20261116_matching-core_課金移行候補_通知Outbox拡張_修正反映_未適用.zip`.
This follow-up changes only the working source package. It does not apply SQL or perform build, test, lint, typecheck, local checks, commit, push, or deployment.

## Fixes

- `src/app/api/map-search/route.ts`: removed the facility profile `address` from the facility relation query and stopped populating `map_address` from the facility profile. The registered facility address is not a substitute for a request-specific public venue address.
- `src/app/api/performer/invitations/route.ts`: removed the facility profile `address` from performer-facing direct-invitation responses.
- `src/app/api/favorites/route.ts`: removed the facility profile `address` from favorite target payloads.
- `src/app/api/reviews/route.ts`: removed the internal `reviewee_id` user UUID from the participant-facing review lookup response; the server still derives and passes the reviewee ID to the RPC.

The three changes are mirrored in the nested `music-matching/` tree.

## Remaining limitation

The map-search response now leaves `map_address` null for performance requests because this candidate query does not provide a request-specific address field. If request-level venue addresses are to be displayed on the map, that needs a separately verified request-address schema and explicit public disclosure flow; the facility registration address must not be reused.

## Verification status

Source edits only. No automated or local checks were run, and no database migration was applied.
