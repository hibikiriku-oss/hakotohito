import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const authorization = request.headers.get("authorization");
    const idToken =
      authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";

    if (!idToken) {
      return NextResponse.json(
        { error: "LINEの本人確認情報がありません。再ログインしてください。" },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
        { status: 401 }
      );
    }

    const lineUserId = verified.userId;
    const { id: matchId } = await context.params;

    if (!UUID_PATTERN.test(matchId)) {
      return NextResponse.json(
        { error: "マッチングIDが不正です" },
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
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    const { data: facility, error: facilityError } =
      await supabase
        .from("facilities")
        .select("id, name")
        .eq("user_id", user.id)
        .single();

    if (facilityError || !facility) {
      console.error("施設取得エラー:", facilityError);

      return NextResponse.json(
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        status,
        performance_status,
        completed_at,
        completion_disputed_at,
        performance_requests!inner (
          id,
          title,
          performance_date,
          start_time,
          end_time,
          facility_id
        ),
        performers (
          id,
          name,
          user_id,
          users (
            id,
            line_user_id,
            display_name
          )
        )
      `)
      .eq("id", matchId)
      .eq("performance_requests.facility_id", facility.id)
      .single();

    if (matchError || !match) {
      console.error("マッチング取得エラー:", matchError);

      return NextResponse.json(
        {
          error:
            "マッチング情報が見つからないか、キャンセルする権限がありません",
        },
        { status: 404 }
      );
    }

    if (match.completion_disputed_at) {
      return NextResponse.json(
        {
          error:
            "異議申し立ての対応が完了するまでキャンセルできません",
        },
        { status: 409 }
      );
    }

    if (
      match.status === "cancelled" ||
      match.performance_status === "cancelled"
    ) {
      return NextResponse.json(
        { error: "このマッチングはすでにキャンセルされています" },
        { status: 400 }
      );
    }

    if (match.performance_status === "completed" || match.completed_at) {
      return NextResponse.json(
        { error: "演奏完了後のマッチングはキャンセルできません" },
        { status: 400 }
      );
    }

    if (match.status !== "active") {
      return NextResponse.json(
        { error: "このマッチングは現在キャンセルできません" },
        { status: 400 }
      );
    }

    const performanceRequest = Array.isArray(
      match.performance_requests
    )
      ? match.performance_requests[0]
      : match.performance_requests;

    if (!performanceRequest) {
      return NextResponse.json(
        { error: "案件情報が見つかりません" },
        { status: 404 }
      );
    }

    const performer = Array.isArray(match.performers)
      ? match.performers[0]
      : match.performers;

    if (!performer) {
      return NextResponse.json(
        { error: "演奏者情報が見つかりません" },
        { status: 404 }
      );
    }

    const performerUser = performer.users
      ? Array.isArray(performer.users)
        ? performer.users[0]
        : performer.users
      : null;

    const performerLineUserId = performerUser?.line_user_id;

    const { data: cancelResult, error: cancelError } =
      await supabase.rpc(
        "cancel_match_with_notification_outbox",
        {
          p_match_id: matchId,
          p_facility_id: facility.id,
          p_actor_user_id: user.id,
          p_actor_role: "facility",
        }
      );

    if (cancelError) {
      console.error("キャンセル処理RPCエラー:", cancelError);

      return NextResponse.json(
        { error: "キャンセル処理に失敗しました" },
        { status: 500 }
      );
    }

    const result = cancelResult as {
      success?: boolean;
      errorMessage?: string | null;
      refundAmount?: number;
      balanceAfter?: number | null;
      matchId?: string;
    } | null;

    if (!result?.success) {
      const errorMessage =
        result?.errorMessage ||
        "マッチングをキャンセルできませんでした";

      const status = errorMessage.includes("異議申し立て")
        ? 409
        : 400;

      return NextResponse.json(
        { error: errorMessage },
        { status }
      );
    }

    // Cancellation and Outbox insertion have already committed atomically in the RPC.
    const notificationDelivery = await drainLineNotificationOutbox(supabase, 20);
    const notificationSent = notificationDelivery.sent > 0;

    return NextResponse.json({
      success: true,
      message:
        (result.refundAmount ?? 0) > 0
          ? `マッチングをキャンセルし、案件を再募集状態に戻しました。手数料を${result.refundAmount}コイン返金しました。`
          : "マッチングをキャンセルし、案件を再募集状態に戻しました。返金対象の手数料はありません。",
      match: {
        id: matchId,
        status: "cancelled",
        performance_status: "cancelled",
      },
      refundAmount: result.refundAmount ?? 0,
      balanceAfter: result.balanceAfter ?? null,
      notificationSent,
    });
  } catch (error) {
    console.error("施設側マッチングキャンセルAPIエラー:", error);

    return NextResponse.json(
      {
        error: "マッチングのキャンセル中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}