import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLinePushMessage } from "@/lib/line";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    const body = await request.json();

    const requestId = body.request_id;
    const performerId = body.performer_id;
    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    if (!requestId || !performerId) {
      return NextResponse.json(
        { error: "案件と演奏者を指定してください" },
        { status: 400 }
      );
    }

    // --------------------------------
    // 施設ユーザーを取得
    // --------------------------------

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, display_name")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // --------------------------------
    // 施設プロフィールを取得
    // --------------------------------

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

    // --------------------------------
    // 案件を取得
    // --------------------------------

    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select(
          "id, facility_id, title, description, performance_date, start_time, end_time, area, status"
        )
        .eq("id", requestId)
        .eq("facility_id", facility.id)
        .single();

    if (requestError || !performanceRequest) {
      console.error("案件取得エラー:", requestError);

      return NextResponse.json(
        { error: "指定された案件が見つかりません" },
        { status: 404 }
      );
    }

    // --------------------------------
    // 案件が募集中か確認
    // --------------------------------

    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        { error: "この案件は現在募集中ではありません" },
        { status: 400 }
      );
    }

    // --------------------------------
    // 演奏者を取得
    // --------------------------------

    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select(
          "id, user_id, name, instruments, genres, area, bio"
        )
        .eq("id", performerId)
        .single();

    if (performerError || !performer) {
      console.error("演奏者取得エラー:", performerError);

      return NextResponse.json(
        { error: "指定された演奏者が見つかりません" },
        { status: 404 }
      );
    }

    // --------------------------------
    // 演奏者のLINE情報を取得
    // --------------------------------

    const { data: performerUser, error: performerUserError } =
      await supabase
        .from("users")
        .select("id, line_user_id, display_name")
        .eq("id", performer.user_id)
        .single();

    if (performerUserError || !performerUser) {
      console.error(
        "演奏者ユーザー取得エラー:",
        performerUserError
      );

      return NextResponse.json(
        { error: "演奏者のLINE情報が見つかりません" },
        { status: 404 }
      );
    }

    // --------------------------------
    // 直接依頼の登録と100コイン消費
    // データベース関数でまとめて処理
    // --------------------------------

    const {
      data: invitationResult,
      error: invitationError,
    } = await supabase.rpc(
      "create_facility_invitation_with_coins",
      {
        p_facility_user_id: user.id,
        p_request_id: requestId,
        p_performer_id: performer.id,
        p_message: message || null,
      }
    );

    if (invitationError) {
      console.error(
        "直接依頼・コイン処理エラー:",
        invitationError
      );

      return NextResponse.json(
        { error: "直接依頼の登録に失敗しました" },
        { status: 500 }
      );
    }

    const result = Array.isArray(invitationResult)
      ? invitationResult[0]
      : invitationResult;

    if (!result?.success) {
      return NextResponse.json(
        {
          error:
            result?.error_message ||
            "直接依頼を登録できませんでした",
          balance: result?.balance_after ?? null,
        },
        { status: 400 }
      );
    }

    const application = {
      id: result.application_id,
      request_id: requestId,
      performer_id: performer.id,
      message: message || null,
      status: "pending",
      source: "facility_invite",
    };

    // --------------------------------
    // LINE通知
    // --------------------------------

    let notificationSent = false;

    try {
      const facilityName =
        facility.name || user.display_name || "施設";

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
                  text: `${facilityName}から演奏依頼が届いています。`,
                  margin: "md",
                  wrap: true,
                },
                {
                  type: "text",
                  text: `案件：${performanceRequest.title}`,
                  margin: "md",
                  wrap: true,
                },
                {
                  type: "text",
                  text:
                    `演奏日：${performanceRequest.performance_date}\n` +
                    `時間：${performanceRequest.start_time} ～ ${performanceRequest.end_time}\n` +
                    `場所：${performanceRequest.area || "未設定"}`,
                  margin: "md",
                  wrap: true,
                },
                ...(message
                  ? [
                      {
                        type: "text",
                        text: `施設からのメッセージ\n${message}`,
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

      const lineResult = await sendLinePushMessage(
        performerUser.line_user_id,
        messages
      );

      if (lineResult.success) {
        notificationSent = true;
        console.log("演奏者へのLINE通知に成功しました");
      } else {
        console.error(
          "演奏者へのLINE通知失敗:",
          lineResult.error
        );
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
      balance: result.balance_after,
    });
  } catch (error) {
    console.error("施設依頼APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}