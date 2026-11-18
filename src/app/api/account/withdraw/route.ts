import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";

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
      "withdraw_user_account_with_notification_outbox",
      { p_line_user_id: verified.userId }
    );

    if (error) {
      console.error("退会処理エラー:", error);
      return NextResponse.json(
        {
          error:
            "退会処理を完了できませんでした。進行中の取引がないことを確認し、時間をおいて再度お試しください。",
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

    // 退会・返金と通知Outbox登録はwrapper RPC内で同一transactionに確定済み。
    const delivery = await drainLineNotificationOutbox(supabase, 100);

    return NextResponse.json({
      success: true,
      cancelledMatchCount: data.cancelledMatchCount ?? 0,
      notificationSent: delivery.sent,
      notificationFailed: delivery.retried + delivery.failedToRecord,
    });
  } catch (error) {
    console.error("退会APIエラー:", error);
    return NextResponse.json(
      { error: "退会処理中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
