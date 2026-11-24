# Hakotohito V48 production deployment gate — 2026-11-22

## Decision (updated 2026-11-24)

**BLOCKED — do not apply V48 migrations and do not deploy the V48 application source yet.** The production catalog results received on 2026-11-24 are recorded in `docs/20261124_PRODUCTION_DB_EVIDENCE_AND_PACKAGE_STATUS.md`. They confirm that `application_attempts` exists, while `application_band_trade_history`, `application_participant_claims`, `match_fee_snapshots`, and `lesson_fee_snapshots` do not exist in `public`. `coin_transactions.idempotency_key` is unique, but the provided column/index inventory does not show a source-transaction reference column or index. Current RPC ACLs were received, but not complete live function definitions or an application migration ledger. A read-only collection script is included at `docs/20261124_PRODUCTION_RPC_AND_MIGRATION_LEDGER_PREFLIGHT.sql`.

The user's current priority is production rollout followed by LINE real-device validation and Supabase data collection. This gate narrows the remaining work to the items that can invalidate balances, lifecycle correctness, or production compatibility. It is not a reason to continue broad, repetitive audits.

## Release blockers that directly affect production safety

1. **Cancellation/refund coverage for new V48 charges**
   - V48.004 `event_match_transaction_fee:<match_id>` (`match_fee`) is not handled by all individual and request-wide cancellation paths.
   - V48.004 `facility_reward_fee` is snapshotted but not connected to cancellation/withdrawal refund logic.
   - V48.005 `lesson_match_fee` has a snapshot/debit path but no complete cancellation/withdrawal refund integration was established.
   - Application acceptance fee refund policy and other fee categories must be explicitly distinguished; do not invent refund behavior.
2. **Source-debit identity and idempotent refunds**
   - Existing refund writers do not consistently persist the source debit transaction ID.
   - A source-linked common refund path requires actual production schema/constraint/trigger/RLS and existing-ledger evidence. Do not add source columns, backfill, or rewrite refund RPCs based only on static assumptions.
3. **Event/rental completion fee compatibility**
   - The old completion-time fee path remains for event/rental. Its relationship to new acceptance-time charges must be decided and duplicate charging excluded.
   - The once-per-request initial fee must remain separate from the per-match fee and must not be charged again after cancellation/refund/rematch.
4. **Live database reconciliation**
   - V48 read-only preflight and V2 refund-source preflight have not been run against the target production DB in this workflow.
   - Exact migration state, live RPC definitions, `coin_transactions` schema/constraints/indexes/triggers/RLS and ledger rows remain unverified.
   - The execution procedure and result-capture table are now documented in `docs/20261122_V48_REFUND_PREFLIGHT_EXECUTION_GUIDE.md`; each SELECT should be run and saved separately.
5. **Full production operational gate**
   - Confirm backup/restore point, current Production commit, Vercel environment variables, Cron compatibility and postflight SQL before rollout.
   - Confirm withdrawal/leader handover, actor/admin authorization and remaining notification lifecycle requirements are either complete or explicitly excluded from this release scope.

## Candidate migration inventory

| Migration | Purpose | Current handling |
|---|---|---|
| `20261122_001_application_participant_snapshot_and_trade_claims.sql` | Submission-time participant snapshot and same-request trade claims | Candidate; live preflight required |
| `20261122_002_band_profile_edit_rpc.sql` | Leader-only band name/description edit | Candidate; live preflight required |
| `20261122_003_match_time_fee_rate_settings.sql` | Admin-configurable performance/lesson acceptance fee rates | Candidate; live preflight required |
| `20261122_004_performance_reward_fee_at_match.sql` | Performance reward fee and event/rental per-match charge at acceptance | Blocked by cancellation/refund and completion-fee integration |
| `20261122_005_lesson_match_fee_snapshots_and_no_holds.sql` | Lesson acceptance fee snapshot and no capacity-wide balance hold | Blocked by lifecycle/refund integration and live DB review |

## Work sequence to reach production

1. Preserve the current candidate and finish only the high-impact fee/lifecycle integration blockers above.
2. Run the read-only preflight against the actual target Supabase project and reconcile the output. No schema mutation during this step.
3. Produce the exact migration delta based on the real applied-migration state; review the transaction and rollback strategy.
4. Update this gate, package manifest, README, runbook and `PUBLIC_RELEASE_CHECKLIST.md` together. They must describe the same release state.
5. Obtain explicit approval before production SQL, GitHub push or Vercel deployment.
6. Apply approved migrations in the documented order, capture postflight evidence, then deploy the matching source.
7. Run controlled LINE tests and capture Supabase before/after evidence. Fix issues revealed by real data rather than extending static audits without a concrete blocker.

## Not performed

No production SQL, database mutation, Git commit/push, Vercel deployment, LINE real-device test, build, lint, test, typecheck or local check was performed while preparing this gate document.


## 2026-11-24 production evidence update

- `cancel_event_request_with_refund_internal(uuid,uuid,boolean)` is executable by `postgres` only; application callers must use an appropriately secured wrapper or a service-role RPC with explicit actor validation.
- `cancel_match_with_direct_invite_refund`, `complete_match_with_fee`, `spend_coins`, `apply_to_lesson_offer`, and `withdraw_user_account` have `service_role` execute grants. The received output contains signatures/ACL only; it is not the current function source.
- `auth.schema_migrations` and `realtime.schema_migrations` are not evidence of the app migration state.
- The business rules for `facility_reward_fee` and `lesson_match_fee` are now approved: refund the full original debit to the original payer only when canceled before performance/lesson completion; no refund after completion. Implementation remains a blocker until atomically source-linked across individual cancel, request-wide cancel, and withdrawal paths.
- See `docs/20261124_PRODUCTION_DB_EVIDENCE_AND_PACKAGE_STATUS.md` for the exact evidence and remaining stop conditions.


## 2026-11-24 ユーザー承認済みライフサイクル仕様の固定

以下は業務判断済みであり、今後の実装で再質問・再解釈しない。

- `facility_reward_fee`：演奏実施前キャンセル時、施設の元支払者へ元debit全額を返金。完了後は返金しない。
- `lesson_match_fee`：レッスン実施前キャンセル時、演奏者／講師の元支払者へ元debit全額を返金。完了後は返金しない。
- 返金は元debit IDに紐付け、payer・amount・transaction_type・request/application/match等の参照を照合し、残高更新と返金ledger INSERTを原子的に実施。source IDにDB一意制約を設ける。
- イベント／レンタル初回料金はrequest単位once-only。キャンセル・返金後に再マッチしても再徴収しない。per-match料金とは別sourceにする。
- イベント／レンタルの成立時課金と旧完了時課金を重複させない。
- 演奏者退会時、既成立案件を自動キャンセルしない。相手施設へ通知し、施設側の判断に委ねる。
- バンドリーダー退会時、バンドを解散せず、加入日時が最も古い有効メンバーへリーダーを引き継ぐ。
- 応募手数料、完了後、紛争成立時の返金は承認範囲外。実装で返金対象へ拡張しない。

実装に必要な本番RPC定義・アプリmigration ledger・制約／trigger／RLSの完全な証跡は `docs/20261124_PRODUCTION_RPC_AND_MIGRATION_LEDGER_PREFLIGHT.sql` でread-only取得する。署名・ACLだけでは既存RPCを安全に置換できないため、証跡取得前に本番関数を推測で再定義しない。
