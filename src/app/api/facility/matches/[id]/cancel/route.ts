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
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

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

    if (!matchId) {
      return NextResponse.json(
        { error: "マッチングIDが指定されていません" },
        { status: 400 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, line_user_id, display_name")
      .eq("line_user_id", lineUserId)
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

    // 自分の施設のマッチングか確認し、通知に必要な情報を取得
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        status,
        performance_status,
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

    if (
      match.status === "cancelled" ||
      match.performance_status === "cancelled"
    ) {
      return NextResponse.json(
        { error: "このマッチングはすでにキャンセルされています" },
        { status: 400 }
      );
    }

    if (match.performance_status === "completed") {
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

    // DB関数でキャンセル・案件再募集・直接依頼の返金をまとめて処理
    const { data: cancelResult, error: cancelError } =
      await supabase.rpc(
        "cancel_match_with_direct_invite_refund",
        {
          p_match_id: matchId,
          p_facility_id: facility.id,
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
      return NextResponse.json(
        {
          error:
            result?.errorMessage ||
            "マッチングをキャンセルできませんでした",
        },
        { status: 400 }
      );
    }

    let notificationSent = false;

    // 演奏者へLINE通知。通知に失敗してもキャンセルは取り消さない
    if (performerLineUserId) {
      const miniAppBaseUrl =
        "https://miniapp.line.me/2011785379-l5XCTbIf";

      const matchUrl =
        `${miniAppBaseUrl}/performer/matches/${matchId}`;

      const messages = [
        {
          type: "flex",
          altText: "マッチングがキャンセルされました",
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                {
                  type: "text",
                  text: "⚠️ マッチングキャンセル",
                  weight: "bold",
                  size: "xl",
                },
                {
                  type: "text",
                  text: "施設が今回のマッチングをキャンセルしました。",
                  wrap: true,
                },
                {
                  type: "separator",
                  margin: "md",
                },
                {
                  type: "text",
                  text: performanceRequest.title,
                  weight: "bold",
                  size: "lg",
                  wrap: true,
                },
                {
                  type: "text",
                  text: `施設：${
                    facility.name || user.display_name || "施設"
                  }`,
                  wrap: true,
                },
              ],
            },
            footer: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              contents: [
                {
                  type: "button",
                  style: "primary",
                  action: {
                    type: "uri",
                    label: "マッチングを確認する",
                    uri: matchUrl,
                  },
                },
              ],
            },
          },
        },
      ];

      try {
        const lineResult = await sendLinePushMessage(
          performerLineUserId,
          messages
        );

        if (lineResult.success) {
          notificationSent = true;
        } else {
          console.error(
            "演奏者へのLINE通知エラー:",
            lineResult.error
          );
        }
      } catch (lineError) {
        console.error("演奏者へのLINE通知例外:", lineError);
      }
    } else {
      console.error(
        "演奏者のLINEユーザーIDが取得できません"
      );
    }

    return NextResponse.json({
      success: true,
      message:
        result.refundAmount === 100
          ? "マッチングをキャンセルし、案件を再募集状態に戻しました。直接依頼の手数料を返金しました。"
          : "マッチングをキャンセルし、案件を再募集状態に戻しました。",
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