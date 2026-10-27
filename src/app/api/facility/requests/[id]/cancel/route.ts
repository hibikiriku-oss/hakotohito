import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLinePushMessage } from "@/lib/line";
import { verifyLineIdToken } from "@/lib/line-auth";

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
const idToken = authorization?.startsWith("Bearer ")
  ? authorization.slice("Bearer ".length)
  : "";

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

    if (!requestId) {
      return NextResponse.json(
        { error: "案件IDが指定されていません" },
        { status: 400 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, line_user_id, display_name")
      .eq("line_user_id", lineUserId)
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

    // キャンセル前に、今回の全体キャンセルで通知する演奏者を取得
    const { data: matches, error: matchesError } = await supabase
      .from("matches")
      .select(`
        performer_id,
        performers (
          users (
            line_user_id
          )
        )
      `)
      .eq("request_id", requestId)
      .eq("status", "active")
      .neq("performance_status", "cancelled");

    if (matchesError) {
      console.error("通知対象取得エラー:", matchesError);

      return NextResponse.json(
        { error: "通知対象の取得に失敗したため、キャンセル処理を中止しました" },
        { status: 500 }
      );
    }

    const { data: cancelResult, error: cancelError } =
      await supabase.rpc("cancel_event_request_with_refund", {
        p_request_id: requestId,
        p_facility_id: facility.id,
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
      refundAmount?: number;
      initialFeeRefund?: number;
      directInviteRefund?: number;
      balanceAfter?: number | null;
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

    const notifiedLineUserIds = new Set<string>();
    let notificationSent = 0;

    for (const match of matches ?? []) {
      const performer = Array.isArray(match.performers)
        ? match.performers[0]
        : match.performers;

      const performerUsers = performer?.users;
      const performerUser = Array.isArray(performerUsers)
        ? performerUsers[0]
        : performerUsers;

      const performerLineUserId = performerUser?.line_user_id;

      if (
        !performerLineUserId ||
        notifiedLineUserIds.has(performerLineUserId)
      ) {
        continue;
      }

      notifiedLineUserIds.add(performerLineUserId);

      try {
        const lineResult = await sendLinePushMessage(
          performerLineUserId,
          [
            {
              type: "text",
              text:
                `「${performanceRequest.title}」は施設によってイベント全体がキャンセルされました。` +
                "詳細については施設へご確認ください。",
            },
          ]
        );

        if (lineResult.success) {
          notificationSent++;
        } else {
          console.error(
            "イベントキャンセルLINE通知エラー:",
            lineResult.error
          );
        }
      } catch (lineError) {
        console.error("イベントキャンセルLINE通知例外:", lineError);
      }
    }

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