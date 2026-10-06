import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { requestId, message } = body;

    if (!requestId) {
      return NextResponse.json(
        { error: "案件IDがありません" },
        { status: 400 }
      );
    }

    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    // LINEユーザーからusersを取得
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者情報を取得
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

    // 案件が存在するか確認
    const {
      data: performanceRequest,
      error: requestError,
    } = await supabase
      .from("performance_requests")
      .select(
        "id, status, title, performance_date, start_time, end_time, area, facility_id"
      )
      .eq("id", requestId)
      .single();

    if (
      requestError ||
      !performanceRequest
    ) {
      console.error(
        "案件取得エラー:",
        requestError
      );

      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    // 募集中の案件だけ応募可能
    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        {
          error:
            "この案件は現在応募できません",
        },
        { status: 400 }
      );
    }

    // 応募登録
    const {
      data,
      error,
    } = await supabase
      .from("applications")
      .insert({
        request_id: requestId,
        performer_id: performer.id,
        message: message || null,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      // unique(request_id, performer_id) による重複応募
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "この案件にはすでに応募しています",
          },
          { status: 409 }
        );
      }

      console.error(
        "応募登録エラー:",
        error
      );

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // ==============================
    // 施設へのLINE通知
    // ==============================

    let notificationSent = false;

    try {
      // 案件を登録した施設を取得
      const {
        data: facility,
        error: facilityError,
      } = await supabase
        .from("facilities")
        .select("id, user_id, name")
        .eq(
          "id",
          performanceRequest.facility_id
        )
        .single();

      if (
        facilityError ||
        !facility
      ) {
        console.error(
          "施設取得エラー:",
          facilityError
        );
      } else {
        // 施設のLINEユーザーIDを取得
        const {
          data: facilityUser,
          error:
            facilityUserError,
        } = await supabase
          .from("users")
          .select(
            "line_user_id, display_name"
          )
          .eq(
            "id",
            facility.user_id
          )
          .single();

        if (
          facilityUserError ||
          !facilityUser
        ) {
          console.error(
            "施設LINEユーザー取得エラー:",
            facilityUserError
          );
        } else {
          const channelAccessToken =
            process.env
              .LINE_CHANNEL_ACCESS_TOKEN;

          if (!channelAccessToken) {
            console.error(
              "LINE_CHANNEL_ACCESS_TOKENが設定されていません"
            );
          } else {
            const performerName =
              performer.name ||
              "演奏者";

            const facilityName =
              facility.name ||
              facilityUser.display_name ||
              "施設";

            // LINE MINI Appの案件詳細ページURL
            const detailUrl =
              "https://miniapp.line.me/2011785379-l5XCTbIf/facility/requests/" +
              requestId;

            // LINE Flex Message
            const messages = [
              {
                type: "flex",
                altText:
                  "🎵 新しい応募があります！",
                contents: {
                  type: "bubble",
                  body: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "text",
                        text:
                          "🎵 新しい応募があります！",
                        weight: "bold",
                        size: "xl",
                        wrap: true,
                      },
                      {
                        type: "text",
                        text:
                          facilityName +
                          "さんの案件に、" +
                          performerName +
                          "さんから応募がありました。",
                        margin: "md",
                        wrap: true,
                      },
                      {
                        type: "text",
                        text:
                          "案件：" +
                          performanceRequest.title,
                        margin: "md",
                        wrap: true,
                      },
                      {
                        type: "text",
                        text:
                          "演奏日時：" +
                          performanceRequest.performance_date +
                          "\n" +
                          "時間：" +
                          performanceRequest.start_time +
                          " ～ " +
                          performanceRequest.end_time +
                          "\n" +
                          "場所：" +
                          (performanceRequest.area ||
                            "未設定"),
                        margin: "md",
                        wrap: true,
                      },
                      {
                        type: "text",
                        text:
                          message
                            ? "応募メッセージ：\n" +
                              message
                            : "応募メッセージ：なし",
                        margin: "md",
                        wrap: true,
                      },
                    ],
                  },
                  footer: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "button",
                        style: "primary",
                        action: {
                          type: "uri",
                          label:
                            "応募者を確認する",
                          uri: detailUrl,
                        },
                      },
                    ],
                  },
                },
              },
            ];

            const lineResponse =
              await fetch(
                "https://api.line.me/v2/bot/message/push",
                {
                  method: "POST",
                  headers: {
                    "Content-Type":
                      "application/json",
                    Authorization:
                      "Bearer " +
                      channelAccessToken,
                  },
                  body: JSON.stringify({
                    to: facilityUser.line_user_id,
                    messages,
                  }),
                }
              );

            if (
              lineResponse.ok
            ) {
              notificationSent = true;

              console.log(
                "施設へのLINE通知送信成功"
              );
            } else {
              const lineError =
                await lineResponse.text();

              console.error(
                "施設へのLINE通知送信エラー:",
                lineResponse.status,
                lineError
              );
            }
          }
        }
      }
    } catch (notificationError) {
      console.error(
        "施設へのLINE通知処理エラー:",
        notificationError
      );
    }

    return NextResponse.json({
      success: true,
      application: data,
      notificationSent,
    });
  } catch (error) {
    console.error(
      "応募APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}