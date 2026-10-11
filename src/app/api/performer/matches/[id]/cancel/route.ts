import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    const { id: matchId } =
      await context.params;

    if (!matchId) {
      return NextResponse.json(
        {
          error:
            "マッチングIDが指定されていません",
        },
        { status: 400 }
      );
    }

    // LINEユーザーを取得
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select(
          "id, line_user_id, display_name"
        )
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        {
          error: "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 演奏者プロフィールを取得
    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select("id, name")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error(
        "演奏者取得エラー:",
        performerError
      );

      return NextResponse.json(
        {
          error:
            "演奏者プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 自分のマッチングか確認
    // 通知に必要な案件・施設情報もここで取得
    const { data: match, error: matchError } =
      await supabase
        .from("matches")
        .select(
          `
          id,
          request_id,
          performer_id,
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
          `
        )
        .eq("id", matchId)
        .eq("performer_id", performer.id)
        .single();

    if (matchError || !match) {
      console.error(
        "マッチング取得エラー:",
        matchError
      );

      return NextResponse.json(
        {
          error:
            "マッチング情報が見つからないか、キャンセルする権限がありません",
        },
        { status: 404 }
      );
    }

    // すでにキャンセル済み
    if (
      match.status === "cancelled" ||
      match.performance_status ===
        "cancelled"
    ) {
      return NextResponse.json(
        {
          error:
            "このマッチングはすでにキャンセルされています",
        },
        { status: 400 }
      );
    }

    // すでに演奏完了している場合はキャンセル不可
    if (
      match.performance_status ===
      "completed"
    ) {
      return NextResponse.json(
        {
          error:
            "演奏完了後のマッチングはキャンセルできません",
        },
        { status: 400 }
      );
    }

    // アクティブなマッチング以外はキャンセル不可
    if (match.status !== "active") {
      return NextResponse.json(
        {
          error:
            "このマッチングは現在キャンセルできません",
        },
        { status: 400 }
      );
    }

    // 案件情報を取得
    const performanceRequest =
      Array.isArray(
        match.performance_requests
      )
        ? match.performance_requests[0]
        : match.performance_requests;

    if (!performanceRequest) {
      return NextResponse.json(
        {
          error:
            "案件情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設情報を取得
    const facility = Array.isArray(
      performanceRequest.facilities
    )
      ? performanceRequest.facilities[0]
      : performanceRequest.facilities;

    if (!facility) {
      console.error(
        "施設情報が見つかりません"
      );
    }

    // マッチングをキャンセル
    const {
      data: updatedMatch,
      error: updateError,
    } = await supabase
      .from("matches")
      .update({
        status: "cancelled",
        performance_status: "cancelled",
      })
      .eq("id", matchId)
      .eq("performer_id", performer.id)
      .select(
        `
        id,
        request_id,
        performer_id,
        matched_at,
        status,
        performance_status,
        completed_at
        `
      )
      .single();

    if (updateError) {
      console.error(
        "マッチングキャンセル更新エラー:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "マッチングのキャンセルに失敗しました",
        },
        { status: 500 }
      );
    }

    // キャンセルされた案件を再募集状態に戻す
    const {
      error: requestUpdateError,
    } = await supabase
      .from("performance_requests")
      .update({
        status: "open",
      })
      .eq("id", performanceRequest.id);

    if (requestUpdateError) {
      console.error(
        "案件再募集状態への更新エラー:",
        requestUpdateError
      );

      // マッチングのキャンセル自体は完了しているため、
      // ここではキャンセル処理を失敗扱いにせず、
      // エラーをログに残す。
    }

    let notificationSent = false;

    // 施設のLINEユーザーIDを取得
    const facilityUser = facility?.users
      ? Array.isArray(facility.users)
        ? facility.users[0]
        : facility.users
      : null;

    const facilityLineUserId =
      facilityUser?.line_user_id;

    // 施設へLINE通知
    // 通知に失敗してもキャンセル処理自体は成功とする
    if (
      facilityLineUserId &&
      process.env.LINE_CHANNEL_ACCESS_TOKEN
    ) {
      const miniAppBaseUrl =
        "https://miniapp.line.me/2011785379-l5XCTbIf";

      const matchUrl =
        `${miniAppBaseUrl}/facility/matches/${matchId}`;

      const lineResponse = await fetch(
        "https://api.line.me/v2/bot/message/push",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            to: facilityLineUserId,
            messages: [
              {
                type: "flex",
                altText:
                  "マッチングがキャンセルされました",
                contents: {
                  type: "bubble",
                  body: {
                    type: "box",
                    layout: "vertical",
                    spacing: "md",
                    contents: [
                      {
                        type: "text",
                        text:
                          "⚠️ マッチングキャンセル",
                        weight: "bold",
                        size: "xl",
                      },
                      {
                        type: "text",
                        text:
                          "演奏者が今回のマッチングをキャンセルしました。",
                        wrap: true,
                      },
                      {
                        type: "separator",
                        margin: "md",
                      },
                      {
                        type: "text",
                        text:
                          performanceRequest.title,
                        weight: "bold",
                        size: "lg",
                        wrap: true,
                      },
                      {
                        type: "text",
                        text:
                          `演奏者：${
                            performer.name ||
                            user.display_name ||
                            "演奏者"
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
                          label:
                            "マッチングを確認する",
                          uri: matchUrl,
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }),
        }
      );

      if (lineResponse.ok) {
        notificationSent = true;
      } else {
        const lineError =
          await lineResponse.text();

        console.error(
          "施設へのLINE通知エラー:",
          lineError
        );
      }
    } else {
      if (!facilityLineUserId) {
        console.error(
          "施設のLINEユーザーIDが取得できません"
        );
      }

      if (
        !process.env.LINE_CHANNEL_ACCESS_TOKEN
      ) {
        console.error(
          "LINE_CHANNEL_ACCESS_TOKENが設定されていません"
        );
      }
    }

    return NextResponse.json({
      success: true,
      message:
        "マッチングをキャンセルし、案件を再募集状態にしました",
      match: updatedMatch,
      notificationSent,
    });
  } catch (error) {
    console.error(
      "マッチングキャンセルAPIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "マッチングのキャンセル中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}