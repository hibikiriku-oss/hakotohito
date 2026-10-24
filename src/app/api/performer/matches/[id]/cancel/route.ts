import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLinePushMessage } from "@/lib/line";

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
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    const { id: matchId } = await context.params;

    if (!matchId) {
      return NextResponse.json(
        { error: "マッチングIDが指定されていません" },
        { status: 400 }
      );
    }

    // LINEユーザーを取得
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

    // 演奏者プロフィールを取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id, name")
        .eq("user_id", user.id)
        .single();

    if (performerError || !performer) {
      console.error("演奏者取得エラー:", performerError);

      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // 自分のマッチングか確認し、通知に必要な情報を取得
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        band_id,
        status,
        performance_status,
        performance_requests (
          id,
          title,
          performance_date,
          start_time,
          end_time,
          facility_id,
          facilities (
            id,
            name,
            user_id,
            users (
              id,
              line_user_id,
              display_name
            )
          )
        )
      `)
      .eq("id", matchId)
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

    // バンドマッチングは、現在のアクティブなリーダーだけが
    // キャンセルできる
    if (match.band_id) {
      const { data: membership, error: membershipError } = await supabase
        .from("band_members")
        .select("role")
        .eq("band_id", match.band_id)
        .eq("performer_id", performer.id)
        .eq("status", "active")
        .maybeSingle();

      if (membershipError) {
        console.error("バンドキャンセル権限の確認エラー:", membershipError);

        return NextResponse.json(
          { error: "操作権限を確認できませんでした" },
          { status: 500 }
        );
      }

      if (!membership || membership.role !== "leader") {
        return NextResponse.json(
          { error: "バンドのマッチングをキャンセルできるのはリーダーのみです" },
          { status: 403 }
        );
      }
    } else {
      // 個人マッチングは従来どおり本人のみ操作できる
      if (match.performer_id !== performer.id) {
        return NextResponse.json(
          { error: "マッチングが見つからないか、操作する権限がありません" },
          { status: 404 }
        );
      }
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

    const facility = Array.isArray(
      performanceRequest.facilities
    )
      ? performanceRequest.facilities[0]
      : performanceRequest.facilities;

    if (!facility) {
      console.error("施設情報が見つかりません");

      return NextResponse.json(
        { error: "施設情報が見つからないため、キャンセルできません" },
        { status: 404 }
      );
    }

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

    // 施設のLINEユーザーIDを取得
    const facilityUser = facility.users
      ? Array.isArray(facility.users)
        ? facility.users[0]
        : facility.users
      : null;

    const facilityLineUserId = facilityUser?.line_user_id;

    // 施設へLINE通知
    // 通知に失敗してもキャンセル処理自体は成功とする
    if (facilityLineUserId) {
      const miniAppBaseUrl =
        "https://miniapp.line.me/2011785379-l5XCTbIf";

      const matchUrl = `${miniAppBaseUrl}/facility/matches/${matchId}`;

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
                  text: "演奏者が今回のマッチングをキャンセルしました。",
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
                  text: `演奏者：${
                    performer.name || user.display_name || "演奏者"
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
          facilityLineUserId,
          messages
        );

        if (lineResult.success) {
          notificationSent = true;
        } else {
          console.error(
            "施設へのLINE通知エラー:",
            lineResult.error
          );
        }
      } catch (lineError) {
        console.error("施設へのLINE通知例外:", lineError);
      }
    } else {
      console.error("施設のLINEユーザーIDが取得できません");
    }

    return NextResponse.json({
      success: true,
      message:
        result.refundAmount === 100
          ? "マッチングをキャンセルし、案件を再募集状態に戻しました。直接依頼の手数料100コインを返金しました。"
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
    console.error("演奏者側マッチングキャンセルAPIエラー:", error);

    return NextResponse.json(
      { error: "マッチングのキャンセル中にエラーが発生しました" },
      { status: 500 }
    );
  }
}