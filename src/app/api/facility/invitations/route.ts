import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    const body = await request.json();

    // フロント側から送信されるキー名に合わせる
    const requestId = body.request_id;
    const performerId = body.performer_id;
    const message = body.message || "";

    if (!requestId || !performerId) {
      return NextResponse.json(
        {
          error: "案件と演奏者を指定してください",
        },
        { status: 400 }
      );
    }

    // --------------------------------
    // 施設ユーザーを取得
    // --------------------------------

    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id, display_name")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        {
          error: "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // --------------------------------
    // 施設プロフィールを取得
    // --------------------------------

    const {
      data: facility,
      error: facilityError,
    } = await supabase
      .from("facilities")
      .select("id, name")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      console.error("施設取得エラー:", facilityError);

      return NextResponse.json(
        {
          error: "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // --------------------------------
    // 案件を取得
    // --------------------------------

    const {
      data: performanceRequest,
      error: requestError,
    } = await supabase
      .from("performance_requests")
      .select(
        "id, facility_id, title, description, performance_date, start_time, end_time, area, status"
      )
      .eq("id", requestId)
      .eq("facility_id", facility.id)
      .single();

    if (requestError || !performanceRequest) {
      console.error(
        "案件取得エラー:",
        requestError
      );

      return NextResponse.json(
        {
          error: "指定された案件が見つかりません",
        },
        { status: 404 }
      );
    }

    // --------------------------------
    // 案件が募集中か確認
    // --------------------------------

    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        {
          error: "この案件は現在募集中ではありません",
        },
        { status: 400 }
      );
    }

    // --------------------------------
    // 演奏者を取得
    // --------------------------------

    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select(
        "id, user_id, name, instruments, genres, area, bio"
      )
      .eq("id", performerId)
      .single();

    if (performerError || !performer) {
      console.error(
        "演奏者取得エラー:",
        performerError
      );

      return NextResponse.json(
        {
          error: "指定された演奏者が見つかりません",
        },
        { status: 404 }
      );
    }

    // --------------------------------
    // 演奏者のLINE情報を取得
    // --------------------------------

    const {
      data: performerUser,
      error: performerUserError,
    } = await supabase
      .from("users")
      .select("id, line_user_id, display_name")
      .eq("id", performer.user_id)
      .single();

    if (
      performerUserError ||
      !performerUser
    ) {
      console.error(
        "演奏者ユーザー取得エラー:",
        performerUserError
      );

      return NextResponse.json(
        {
          error: "演奏者のLINE情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // --------------------------------
    // 既存の応募・依頼を確認
    // --------------------------------

    const {
      data: existingApplication,
      error: existingError,
    } = await supabase
      .from("applications")
      .select("id, status, source")
      .eq("request_id", requestId)
      .eq("performer_id", performer.id)
      .maybeSingle();

    if (existingError) {
      console.error(
        "既存応募確認エラー:",
        existingError
      );

      return NextResponse.json(
        {
          error: "既存の応募情報を確認できませんでした",
        },
        { status: 500 }
      );
    }

    if (existingApplication) {
      return NextResponse.json(
        {
          error:
            "この演奏者にはすでに応募または依頼済みです",
        },
        { status: 400 }
      );
    }

    // --------------------------------
    // 施設からの依頼を登録
    // --------------------------------

    const {
      data: application,
      error: applicationError,
    } = await supabase
      .from("applications")
      .insert({
        request_id: requestId,
        performer_id: performer.id,
        message,
        status: "pending",
        source: "facility_invite",
      })
      .select()
      .single();

    if (applicationError) {
      console.error(
        "依頼登録エラー:",
        applicationError
      );

      return NextResponse.json(
        {
          error: "依頼の登録に失敗しました",
        },
        { status: 500 }
      );
    }

    // --------------------------------
    // LINE通知
    // --------------------------------

    let notificationSent = false;

    try {
      const channelAccessToken =
        process.env.LINE_CHANNEL_ACCESS_TOKEN;

      if (!channelAccessToken) {
        console.error(
          "LINE_CHANNEL_ACCESS_TOKENが設定されていません"
        );
      } else {
        const performerName =
          performer.name ||
          performerUser.display_name ||
          "演奏者";

        const facilityName =
          facility.name ||
          user.display_name ||
          "施設";

        const detailUrl =
          "https://miniapp.line.me/2011785379-l5XCTbIf/performer/invitations";

        const messages = [
          {
            type: "flex",
            altText: "施設から演奏依頼が届きました",
            contents: {
              type: "bubble",
              body: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "text",
                    text: "🎵 演奏依頼が届きました",
                    weight: "bold",
                    size: "xl",
                    wrap: true,
                  },
                  {
                    type: "text",
                    text:
                      facilityName +
                      "から演奏依頼が届いています。",
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
                      "演奏日：" +
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
                  ...(message
                    ? [
                        {
                          type: "text",
                          text:
                            "施設からのメッセージ\n" +
                            message,
                          margin: "md",
                          wrap: true,
                        },
                      ]
                    : []),
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
                      label: "依頼を確認する",
                      uri: detailUrl,
                    },
                  },
                ],
              },
            },
          },
        ];

        const lineResponse = await fetch(
          "https://api.line.me/v2/bot/message/push",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization:
                "Bearer " + channelAccessToken,
            },
            body: JSON.stringify({
              to: performerUser.line_user_id,
              messages,
            }),
          }
        );

        if (lineResponse.ok) {
          notificationSent = true;

          console.log(
            "演奏者へのLINE通知に成功しました"
          );
        } else {
          const lineError =
            await lineResponse.text();

          console.error(
            "LINE通知エラー:",
            lineResponse.status,
            lineError
          );
        }
      }
    } catch (notificationError) {
      console.error(
        "LINE通知処理エラー:",
        notificationError
      );
    }

    // --------------------------------
    // 完了
    // --------------------------------

    return NextResponse.json({
      success: true,
      message: "演奏依頼を送信しました",
      application,
      notificationSent,
    });
  } catch (error) {
    console.error(
      "施設依頼APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}