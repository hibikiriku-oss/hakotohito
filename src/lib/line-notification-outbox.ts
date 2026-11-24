import type { SupabaseClient } from "@supabase/supabase-js";
import { sendLinePushMessage, type LineMessage } from "@/lib/line";

type OutboxRow = {
  id: string;
  recipient_line_user_id: string;
  messages: unknown;
  attempt_count: number;
  // Optional during the expand/contract rollout: the pre-hardening claim RPC
  // does not return a lease token. Deploy this bridge before migration 004.
  lease_token?: string | null;
};

export type OutboxDrainOptions = {
  /** Maximum number of rows claimed per batch. The database contract caps this at five. */
  batchLimit?: number;
  /** Number of sequential batches in one invocation. Defaults to one for request paths. */
  maxBatches?: number;
  /** Stop before the platform execution deadline; checked between batches. */
  maxDurationMs?: number;
};

export async function drainLineNotificationOutbox(
  supabase: SupabaseClient,
  limit = 5,
  options: OutboxDrainOptions = {},
) {
  const safeLimit = Math.max(1, Math.min(5, Math.floor(options.batchLimit ?? limit)));
  const maxBatches = Math.max(1, Math.min(20, Math.floor(options.maxBatches ?? 1)));
  const maxDurationMs = Math.max(1_000, Math.min(50_000, Math.floor(options.maxDurationMs ?? 45_000)));
  const deadline = Date.now() + maxDurationMs;

  let claimed = 0;
  let sent = 0;
  let retried = 0;
  let failedToRecord = 0;
  let batches = 0;

  for (let batch = 0; batch < maxBatches && Date.now() < deadline; batch += 1) {
    const { data: rows, error: claimError } = await supabase.rpc(
      "claim_line_notification_outbox",
      { p_limit: safeLimit },
    );
    if (claimError) {
      console.error("LINE通知Outbox取得エラー:", claimError.code ?? claimError.name);
      return { claimed, sent, retried, failedToRecord, batches, claimError: true };
    }

    const batchRows = (rows ?? []) as OutboxRow[];
    batches += 1;
    claimed += batchRows.length;
    if (batchRows.length === 0) break;

    await Promise.all(batchRows.map(async (row) => {
      const hasLeaseTokenField = Object.prototype.hasOwnProperty.call(row, "lease_token");
      const leaseToken = row.lease_token;
      if (hasLeaseTokenField && (typeof leaseToken !== "string" || !leaseToken)) {
        failedToRecord += 1;
        console.error("LINE通知Outbox lease token欠落:", "INVALID_LEASE_TOKEN");
        return;
      }

      const messages = Array.isArray(row.messages) ? row.messages as LineMessage[] : [];
      let result: { success: boolean; error?: string };
      try {
        result = await sendLinePushMessage(row.recipient_line_user_id, messages);
      } catch (error) {
        result = {
          success: false,
          error: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        };
      }

      if (result.success) {
        const { data, error } = leaseToken
          ? await supabase.rpc("complete_line_notification_outbox", {
              p_id: row.id,
              p_lease_token: leaseToken,
            })
          : await supabase.rpc("complete_line_notification_outbox", { p_id: row.id });
        if (error || data !== true) {
          failedToRecord += 1;
          console.error("LINE通知Outbox完了記録エラー:", error?.code ?? "STALE_LEASE");
        } else {
          sent += 1;
        }
      } else {
        const { data, error } = leaseToken
          ? await supabase.rpc("retry_line_notification_outbox", {
              p_id: row.id,
              p_lease_token: leaseToken,
              p_error: result.error ?? "LINE_PUSH_FAILED",
            })
          : await supabase.rpc("retry_line_notification_outbox", {
              p_id: row.id,
              p_error: result.error ?? "LINE_PUSH_FAILED",
            });
        if (error || data !== true) {
          failedToRecord += 1;
          console.error("LINE通知Outbox再送記録エラー:", error?.code ?? "STALE_LEASE");
        } else {
          retried += 1;
        }
      }
    }));

    // A short batch means the queue was drained at claim time. A full batch
    // may have more work, so continue while the bounded execution budget remains.
    if (batchRows.length < safeLimit) break;
  }

  return { claimed, sent, retried, failedToRecord, batches, claimError: false };
}

export async function enqueueLineNotification(
  supabase: SupabaseClient,
  eventKey: string,
  recipientLineUserId: string,
  message: string,
) {
  const { data: inserted, error } = await supabase.rpc("enqueue_line_notification", {
    p_event_key: eventKey,
    p_recipient_line_user_id: recipientLineUserId,
    p_text: message,
  });
  if (error) {
    console.error("LINE通知Outbox登録エラー:", error.code ?? error.name);
    return { queued: false, delivery: null };
  }
  const delivery = await drainLineNotificationOutbox(supabase, 5);
  return { queued: inserted === true, delivery };
}
