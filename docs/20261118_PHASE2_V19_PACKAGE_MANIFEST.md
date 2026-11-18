# Phase 2 v19 package manifest

- Baseline: v18 candidate ZIP.
- Corrected the root-vs-nested repository mirror gap for four v17 API source files, three candidate migrations, and v17/v18/v19 audit artifacts.
- Added atomic Match chat GET and Band chat GET RPCs; both routes now call the corresponding RPC. All five invitation/chat RPCs bind the verified LINE subject to the current `users.line_user_id` inside the transaction.
- Added fail-closed atomic performance-request DELETE RPC/migration 008 and replaced the route's separate count/delete requests. It binds the verified LINE subject, preserves application-attempt history, and rejects unknown FK/DELETE-trigger dependencies.
- Extended migration 007 preflight to cover every referenced chat/invitation column and both new GET RPC signatures.
- Tightened migration 006 preflight for Stripe webhook `event_type` and event identity column types.
- Updated rollback notes, root/nested release checklists, and v19 static review.
- No SQL was executed. No live DB, GitHub, or Vercel state was changed.
- No build, lint, test, typecheck, or local project check was run.
- Current post-reset business-row snapshot remains unavailable in uploaded materials.
- Stripe equal-second ordering ambiguity and performance-request DELETE/FK uncertainty remain open.
- Release status: BLOCKED.
