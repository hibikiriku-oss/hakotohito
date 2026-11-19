import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";
import { verifyLineIdToken } from "@/lib/line-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const authorization = request.headers.get("authorization");
    const idToken =
      authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";

    if (!idToken) {
      return NextResponse.json(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const lineUserId = verified.userId;

    const { id: requestId } = await context.params;

    if (!requestId || !UUID_PATTERN.test(requestId)) {
      return NextResponse.json(
        { error: "案件IDが正しくありません" },
        { status: 400 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, account_status, line_user_id, display_name")
      .eq("line_user_id", lineUserId)
      .eq("account_status", "active")
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("id, name")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      return NextResponse.json(
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select("id, title, request_type, status, facility_id")
        .eq("id", requestId)
        .eq("facility_id", facility.id)
        .single();

    if (requestError || !performanceRequest) {
      return NextResponse.json(
        { error: "案件が見つからないか、キャンセルする権限がありません" },
        { status: 404 }
      );
    }

    if (
      !["live", "festival", "session", "rental"].includes(
        performanceRequest.request_type
      )
    ) {
      return NextResponse.json(
        { error: "イベント・レンタル案件のみ全体キャンセルできます" },
        { status: 400 }
      );
    }

    const { data: cancelResult, error: cancelError } =
      await supabase.rpc("cancel_event_request_with_notification_outbox", {
        p_request_id: requestId,
        p_facility_id: facility.id,
        p_actor_user_id: user.id,
      });

    if (cancelError) {
      console.error("イベント全体キャンセルRPCエラー:", cancelError);

      return NextResponse.json(
        { error: "キャンセル処理に失敗しました" },
        { status: 500 }
      );
    }

    const result = cancelResult as {
      success?: boolean;
      errorMessage?: string | null;
      cancelledMatches?: number;
      cancelledMatchIds?: string[];
      refundAmount?: number;
      initialFeeRefund?: number;
      directInviteRefund?: number;
      balanceAfter?: number | null;
      pendingDirectInviteNotifications?: Array<{
        lineUserId: string;
        requestTitle?: string | null;
        performerName?: string | null;
        refundAmount?: number;
      }>;
    } | null;

    if (!result?.success) {
      return NextResponse.json(
        {
          error:
            result?.errorMessage ||
            "イベント全体をキャンセルできませんでした",
        },
        { status: 400 }
      );
    }

    // 全体キャンセル・返金と通知Outbox登録はwrapper RPC内で同一transactionに確定済み。
    const notificationDelivery = await drainLineNotificationOutbox(supabase, 100);
    const notificationSent = notificationDelivery.sent;

    return NextResponse.json({
      success: true,
      message: "イベント全体をキャンセルし、対象の返金処理を行いました。",
      requestId,
      status: "closed",
      cancelledMatches: result.cancelledMatches ?? 0,
      refundAmount: result.refundAmount ?? 0,
      initialFeeRefund: result.initialFeeRefund ?? 0,
      directInviteRefund: result.directInviteRefund ?? 0,
      balanceAfter: result.balanceAfter ?? null,
      notificationSent,
    });
  } catch (error) {
    console.error("イベント全体キャンセルAPIエラー:", error);

    return NextResponse.json(
      { error: "イベント全体のキャンセル中にエラーが発生しました" },
      { status: 500 }
    );
  }
}