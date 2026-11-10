
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { sendLinePushMessage, type LineMessage } from "@/lib/line";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type WithdrawalNotification = {
  lineUserId: string;
  matchId: string;
  requestTitle: string | null;
  facilityName: string | null;
  performerName: string | null;
  withdrawnUserType: "performer" | "facility";
  refundAmount?: number;
};

type PendingDirectInviteNotification = {
  lineUserId: string;
  applicationId: string;
  requestId: string;
  requestTitle: string | null;
  facilityName: string | null;
  performerName: string | null;
  refundAmount: number;
};

async function sendWithdrawalNotification(
  lineUserId: string,
  message: LineMessage
): Promise<boolean> {
  if (!lineUserId || lineUserId.startsWith("withdrawn:")) {
    return false;
  }

  try {
    const result = await sendLinePushMessage(lineUserId, [message]);

    if (!result.success) {
      console.error("退会通知送信失敗:", result.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("退会通知例外:", error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;

    if (!idToken) {
      return NextResponse.json(
        { error: "認証情報がありません" },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified?.userId) {
      return NextResponse.json(
        { error: "本人確認に失敗しました" },
        { status: 401 }
      );
    }

    const { data, error } = await supabase.rpc(
      "withdraw_user_account",
      {
        p_line_user_id: verified.userId,
      }
    );

    if (error) {
      console.error("退会処理エラー:", error);

      return NextResponse.json(
        {
          error:
            error.message ||
            "退会処理に失敗しました。進行中の取引などをご確認ください。",
        },
        { status: 409 }
      );
    }

    if (!data?.success) {
      return NextResponse.json(
        { error: "退会処理が完了しませんでした" },
        { status: 500 }
      );
    }

    const appUrl = new URL(request.url).origin;

    const notifications = Array.isArray(data.notifications)
      ? (data.notifications as WithdrawalNotification[])
      : [];

    const pendingDirectNotifications = Array.isArray(
      data.pendingDirectInviteNotifications
    )
      ? (data.pendingDirectInviteNotifications as PendingDirectInviteNotification[])
      : [];

    const pendingDirectRefundNotifications = Array.isArray(
      data.pendingDirectInviteRefundNotifications
    )
      ? (data.pendingDirectInviteRefundNotifications as PendingDirectInviteNotification[])
      : [];

    let notificationSent = 0;
    let notificationFailed = 0;

    // マッチング中止通知
    for (const notification of notifications) {
      if (
        !notification.lineUserId ||
        notification.lineUserId.startsWith("withdrawn:")
      ) {
        continue;
      }

      const matchUrl =
        notification.withdrawnUserType === "facility"
          ? `${appUrl}/performer/matches/${notification.matchId}`
          : `${appUrl}/facility/matches/${notification.matchId}`;

      const withdrawnLabel =
        notification.withdrawnUserType === "facility"
          ? "施設"
          : "演奏者";

      const message = {
        type: "flex" as const,
        altText: "マッチング中止のお知らせ",
        contents: {
          type: "bubble" as const,
          body: {
            type: "box" as const,
            layout: "vertical" as const,
            contents: [
              {
                type: "text" as const,
                text: "マッチング中止のお知らせ",
                weight: "bold" as const,
                size: "lg" as const,
                wrap: true,
              },
              {
                type: "text" as const,
                text: `${withdrawnLabel}が退会したため、次のマッチングは中止となりました。`,
                wrap: true,
                margin: "md" as const,
              },
              {
                type: "text" as const,
                text: `案件：${notification.requestTitle || "案件名なし"}`,
                wrap: true,
                margin: "md" as const,
              },
              {
                type: "text" as const,
                text: `施設：${notification.facilityName || "施設名なし"}`,
                wrap: true,
                margin: "sm" as const,
              },
              {
                type: "text" as const,
                text: `演奏者：${notification.performerName || "演奏者"}`,
                wrap: true,
                margin: "sm" as const,
              },
              {
                type: "text" as const,
                text: "詳細はマッチング画面でご確認ください。",
                wrap: true,
                margin: "md" as const,
              },
            ],
          },
          footer: {
            type: "box" as const,
            layout: "vertical" as const,
            contents: [
              {
                type: "button" as const,
                style: "primary" as const,
                action: {
                  type: "uri" as const,
                  label: "マッチングを確認",
                  uri: matchUrl,
                },
              },
            ],
          },
        },
      };

      const sent = await sendWithdrawalNotification(
        notification.lineUserId,
        message
      );

      if (sent) {
        notificationSent++;
      } else {
        notificationFailed++;
      }
    }

    // 施設退会時：未成立ダイレクトオファーを受けた演奏者への通知
    for (const notification of pendingDirectNotifications) {
      if (
        !notification.lineUserId ||
        notification.lineUserId.startsWith("withdrawn:")
      ) {
        continue;
      }

      const message = {
        type: "flex" as const,
        altText: "ダイレクトオファー取消のお知らせ",
        contents: {
          type: "bubble" as const,
          body: {
            type: "box" as const,
            layout: "vertical" as const,
            contents: [
              {
                type: "text" as const,
                text: "ダイレクトオファー取消のお知らせ",
                weight: "bold" as const,
                size: "lg" as const,
                wrap: true,
              },
              {
                type: "text" as const,
                text: "送信元の施設が退会したため、次のダイレクトオファーは取り消されました。",
                wrap: true,
                margin: "md" as const,
              },
              {
                type: "text" as const,
                text: `案件：${notification.requestTitle || "案件名なし"}`,
                wrap: true,
                margin: "md" as const,
              },
              {
                type: "text" as const,
                text: `施設：${notification.facilityName || "施設名なし"}`,
                wrap: true,
                margin: "sm" as const,
              },
              {
                type: "text" as const,
                text: "この直接依頼は無効になっています。新しいオファーをお待ちください。",
                wrap: true,
                margin: "md" as const,
              },
            ],
          },
        },
      };

      const sent = await sendWithdrawalNotification(
        notification.lineUserId,
        message
      );

      if (sent) {
        notificationSent++;
      } else {
        notificationFailed++;
      }
    }

    // 演奏者退会時：ダイレクトオファー送信元の施設へ返金通知
    for (const notification of pendingDirectRefundNotifications) {
      if (
        !notification.lineUserId ||
        notification.lineUserId.startsWith("withdrawn:")
      ) {
        continue;
      }

      const refundAmount = Number(notification.refundAmount);

      if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0) {
        console.error(
          "退会時のダイレクトオファー返金通知額が不正です:",
          notification.applicationId
        );
        notificationFailed++;
        continue;
      }

      const message = {
        type: "flex" as const,
        altText: "ダイレクトオファー取消・返金のお知らせ",
        contents: {
          type: "bubble" as const,
          body: {
            type: "box" as const,
            layout: "vertical" as const,
            contents: [
              {
                type: "text" as const,
                text: "ダイレクトオファー取消・返金のお知らせ",
                weight: "bold" as const,
                size: "lg" as const,
                wrap: true,
              },
              {
                type: "text" as const,
                text: "演奏者が退会したため、ダイレクトオファーは取り消されました。",
                wrap: true,
                margin: "md" as const,
              },
              {
                type: "text" as const,
                text: `案件：${notification.requestTitle || "案件名なし"}`,
                wrap: true,
                margin: "md" as const,
              },
              {
                type: "text" as const,
                text: `演奏者：${notification.performerName || "演奏者"}`,
                wrap: true,
                margin: "sm" as const,
              },
              {
                type: "text" as const,
                text: `手数料${refundAmount}コインを返金しました。`,
                weight: "bold" as const,
                wrap: true,
                margin: "md" as const,
              },
            ],
          },
        },
      };

      const sent = await sendWithdrawalNotification(
        notification.lineUserId,
        message
      );

      if (sent) {
        notificationSent++;
      } else {
        notificationFailed++;
      }
    }

    return NextResponse.json({
      success: true,
      cancelledMatchCount: data.cancelledMatchCount ?? 0,
      notificationSent,
      notificationFailed,
    });
  } catch (error) {
    console.error("退会APIエラー:", error);

    return NextResponse.json(
      { error: "退会処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
