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

export async function drainLineNotificationOutbox(
  supabase: SupabaseClient,
  limit = 5,
) {
  // LINE requests have a 10-second timeout. Cap a batch at five and send in
  // parallel so API routes do not spend minutes draining a large backlog.
  const safeLimit = Math.max(1, Math.min(5, Math.floor(limit)));
  const { data: rows, error: claimError } = await supabase.rpc(
    "claim_line_notification_outbox",
    { p_limit: safeLimit },
  );
  if (claimError) {
    console.error("LINE通知Outbox取得エラー:", claimError.code ?? claimError.name);
    // Surface claim failures to cron/route callers. Returning an all-zero
    // success-shaped result made a broken worker look healthy to monitoring.
    return { claimed: 0, sent: 0, retried: 0, failedToRecord: 0, claimError: true };
  }

  let sent = 0;
  let retried = 0;
  let failedToRecord = 0;
  await Promise.all(((rows ?? []) as OutboxRow[]).map(async (row) => {
    const hasLeaseTokenField = Object.prototype.hasOwnProperty.call(row, "lease_token");
    const leaseToken = row.lease_token;
    // A hardened claim response must always carry a non-empty token. Do not
    // silently fall back to the unfenced legacy RPC if the field exists but is
    // null/invalid; leave the lease to expire and surface the contract failure.
    if (hasLeaseTokenField && (typeof leaseToken !== "string" || !leaseToken)) {
      failedToRecord += 1;
      console.error("LINE通知Outbox lease token欠落:", "INVALID_LEASE_TOKEN");
      return;
    }

    const messages = Array.isArray(row.messages)
      ? row.messages as LineMessage[]
      : [];
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
      // Before migration 004, the legacy RPC accepts only p_id. After 004,
      // claim_line_notification_outbox returns lease_token and the new overload
      // must receive it. Legacy acknowledgement overloads remain available only
      // until migration 017 runs after the new application deployment is drained.
      const { data, error } = leaseToken
        ? await supabase.rpc("complete_line_notification_outbox", {
            p_id: row.id,
            p_lease_token: leaseToken,
          })
        : await supabase.rpc("complete_line_notification_outbox", {
            p_id: row.id,
          });
      if (error || data !== true) {
        failedToRecord += 1;
        console.error("LINE通知Outbox完了記録エラー:", error?.code ?? "STALE_LEASE");
        // LINE may already have accepted the push; fencing prevents stale DB writes,
        // but cannot retract an external push accepted before lease expiry.
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

  return { claimed: rows?.length ?? 0, sent, retried, failedToRecord, claimError: false };
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
