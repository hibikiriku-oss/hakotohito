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
      applicationId: string;
    }>;
  }
) {
  try {
    const { id: requestId, applicationId } =
      await context.params;

    // LINEユーザーID取得
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error:
            "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    // ユーザー取得
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
        {
          error:
            "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設取得
    const {
      data: facility,
      error: facilityError,
    } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      console.error(
        "施設取得エラー:",
        facilityError
      );

      return NextResponse.json(
        {
          error:
            "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 案件がこの施設のものか確認
    const {
      data: performanceRequest,
      error: requestError,
    } = await supabase
      .from("performance_requests")
      .select(
        "id, status, title, performance_date, start_time, end_time, area"
      )
      .eq("id", requestId)
      .eq("facility_id", facility.id)
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
        {
          error: "案件が見つかりません",
        },
        { status: 404 }
      );
    }

    // すでにマッチング済みか確認
    if (
      performanceRequest.status ===
      "matched"
    ) {
      return NextResponse.json(
        {
          error:
            "この案件はすでにマッチング済みです",
        },
        { status: 400 }
      );
    }

    // 応募情報を取得
    const {
      data: application,
      error: applicationError,
    } = await supabase
      .from("applications")
      .select(
        "id, request_id, performer_id, status"
      )
      .eq("id", applicationId)
      .eq("request_id", requestId)
      .single();

    if (
      applicationError ||
      !application
    ) {
      console.error(
        "応募情報取得エラー:",
        applicationError
      );

      return NextResponse.json(
        {
          error:
            "応募情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // すでに処理済みか確認
    if (
      application.status !== "pending"
    ) {
      return NextResponse.json(
        {
          error:
            "この応募はすでに処理されています",
        },
        { status: 400 }
      );
    }

    // 採用
    const {
      error: acceptError,
    } = await supabase
      .from("applications")
      .update({
        status: "accepted",
      })
      .eq("id", applicationId);

    if (acceptError) {
      console.error(
        "応募ステータス更新エラー:",
        acceptError
      );

      return NextResponse.json(
        {
          error:
            "応募の採用に失敗しました",
        },
        { status: 500 }
      );
    }

    // 他の応募者を不採用にする
    const {
      error: rejectError,
    } = await supabase
      .from("applications")
      .update({
        status: "rejected",
      })
      .eq("request_id", requestId)
      .eq("status", "pending")
      .neq("id", applicationId);

    if (rejectError) {
      console.error(
        "他の応募者の更新エラー:",
        rejectError
      );

      return NextResponse.json(
        {
          error:
            "他の応募者の処理に失敗しました",
        },
        { status: 500 }
      );
    }

    // マッチング登録
    const {
      data: match,
      error: matchError,
    } = await supabase
      .from("matches")
      .insert({
        request_id: requestId,
        performer_id:
          application.performer_id,
        status: "active",
      })
      .select()
      .single();

    if (matchError) {
      console.error(
        "マッチング登録エラー:",
        matchError
      );

      return NextResponse.json(
        {
          error:
            "マッチング登録に失敗しました",
        },
        { status: 500 }
      );
    }

    // 案件をマッチング済みにする
    const {
      error: updateRequestError,
    } = await supabase
      .from("performance_requests")
      .update({
        status: "matched",
      })
      .eq("id", requestId);

    if (updateRequestError) {
      console.error(
        "案件ステータス更新エラー:",
        updateRequestError
      );

      return NextResponse.json(
        {
          error:
            "案件ステータスの更新に失敗しました",
        },
        { status: 500 }
      );
    }

    // ==============================
    // LINE通知
    // ==============================

    let notificationSent = false;

    try {
      // 演奏者プロフィールからuser_idを取得
      const {
        data: performer,
        error: performerError,
      } = await supabase
        .from("performers")
        .select("id, user_id, name")
        .eq(
          "id",
          application.performer_id
        )
        .single();

      if (
        performerError ||
        !performer
      ) {
        console.error(
          "演奏者取得エラー:",
          performerError
        );
      } else {
        // 演奏者のLINEユーザーIDを取得
        const {
          data: performerUser,
          error:
            performerUserError,
        } = await supabase
          .from("users")
          .select(
            "line_user_id, display_name"
          )
          .eq(
            "id",
            performer.user_id
          )
          .single();

        if (
          performerUserError ||
          !performerUser
        ) {
          console.error(
            "演奏者LINEユーザー取得エラー:",
            performerUserError
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
              performerUser.display_name ||
              "演奏者";

            const message =
              "🎉 マッチングが成立しました！\n\n" +
              "演奏案件「" +
              performanceRequest.title +
              "」について、施設から演奏依頼が承認されました。\n\n" +
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
                "未設定") +
              "\n\n" +
              performerName +
              "さん、マッチング詳細を確認してください。";

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
                    to: performerUser.line_user_id,
                    messages: [
                      {
                        type: "text",
                        text: message,
                      },
                    ],
                  }),
                }
              );

            if (
              lineResponse.ok
            ) {
              notificationSent = true;

              console.log(
                "LINE通知送信成功"
              );
            } else {
              const lineError =
                await lineResponse.text();

              console.error(
                "LINE通知送信エラー:",
                lineResponse.status,
                lineError
              );
            }
          }
        }
      }
    } catch (notificationError) {
      console.error(
        "LINE通知処理エラー:",
        notificationError
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "マッチングが成立しました",
      match,
      notificationSent,
    });
  } catch (error) {
    console.error(
      "採用APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "サーバーエラー",
      },
      { status: 500 }
    );
  }
}