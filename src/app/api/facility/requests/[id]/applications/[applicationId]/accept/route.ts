import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// LINE Messaging API
const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN!;

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
    // ----------------------------------------
    // 1. パラメータ取得
    // ----------------------------------------
    const { id: requestId, applicationId } = await context.params;

    // ----------------------------------------
    // 2. LINEユーザーID取得
    // ----------------------------------------
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザーIDがありません",
        },
        { status: 401 }
      );
    }

    // ----------------------------------------
    // 3. ユーザー取得
    // ----------------------------------------
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        {
          error: "ユーザーが見つかりません",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // 4. 施設取得
    // ----------------------------------------
    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      console.error("施設取得エラー:", facilityError);

      return NextResponse.json(
        {
          error: "施設情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // 5. 案件取得
    // ----------------------------------------
    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select("*")
        .eq("id", requestId)
        .eq("facility_id", facility.id)
        .single();

    if (requestError || !performanceRequest) {
      console.error("案件取得エラー:", requestError);

      return NextResponse.json(
        {
          error: "案件が見つからないか、この施設の案件ではありません",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // 6. 案件がすでにマッチング済みか確認
    // ----------------------------------------
    if (performanceRequest.status === "matched") {
      return NextResponse.json(
        {
          error: "この案件はすでにマッチング済みです",
        },
        { status: 400 }
      );
    }

    // ----------------------------------------
    // 7. 応募情報取得
    // ----------------------------------------
    const { data: application, error: applicationError } =
      await supabase
        .from("applications")
        .select("*")
        .eq("id", applicationId)
        .eq("request_id", requestId)
        .single();

    if (applicationError || !application) {
      console.error("応募情報取得エラー:", applicationError);

      return NextResponse.json(
        {
          error: "応募情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // 8. 応募がpendingか確認
    // ----------------------------------------
    if (application.status !== "pending") {
      return NextResponse.json(
        {
          error: "この応募はすでに処理されています",
        },
        { status: 400 }
      );
    }

    // =====================================================
    // 9. マッチング成立 + 100コイン消費
    //
    // DB RPC:
    // accept_application_with_coins
    //
    // このRPC内で以下を一括処理する
    // ・matches作成
    // ・採用応募をaccepted
    // ・他の応募をrejected
    // ・案件をmatched
    // ・施設の100コイン消費
    //
    // コイン不足の場合はトランザクション全体を
    // ロールバックする
    // =====================================================
    const { data: matchingResult, error: matchingError } =
      await supabase.rpc("accept_application_with_coins", {
        p_request_id: requestId,
        p_application_id: applicationId,
        p_facility_user_id: user.id,
      });

    if (matchingError) {
      console.error(
        "マッチングRPCエラー:",
        matchingError
      );

      return NextResponse.json(
        {
          error:
            matchingError.message ||
            "マッチング処理に失敗しました",
        },
        { status: 500 }
      );
    }

    // Supabase RPCは通常配列で返るため1件目を取得
    const matching = Array.isArray(matchingResult)
      ? matchingResult[0]
      : matchingResult;

    // ----------------------------------------
    // 10. RPC結果確認
    // ----------------------------------------
    if (!matching?.success) {
      console.error(
        "マッチング失敗:",
        matching?.error_message
      );

      return NextResponse.json(
        {
          error:
            matching?.error_message ||
            "マッチングに失敗しました",
        },
        { status: 400 }
      );
    }

    // ----------------------------------------
    // 11. マッチングID・残高取得
    // ----------------------------------------
    const matchId = matching.match_id;
    const coinBalance = matching.balance_after;

    if (!matchId) {
      console.error(
        "マッチングIDが取得できません:",
        matching
      );

      return NextResponse.json(
        {
          error: "マッチングIDの取得に失敗しました",
        },
        { status: 500 }
      );
    }

    // =====================================================
    // 12. 演奏者情報取得
    // =====================================================
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select(
          `
          *,
          users (
            line_user_id,
            display_name,
            picture_url
          )
        `
        )
        .eq("id", application.performer_id)
        .single();

    if (performerError || !performer) {
      console.error(
        "演奏者取得エラー:",
        performerError
      );

      // マッチング自体は成立しているため、
      // ここでは処理をロールバックしない
      return NextResponse.json({
        success: true,
        message:
          "マッチングが成立しましたが、演奏者への通知に必要な情報を取得できませんでした",
        matchId,
        coinBalance,
        notificationSent: false,
      });
    }

    // ----------------------------------------
    // 演奏者のLINEユーザーID
    // ----------------------------------------
    const performerLineUserId =
      performer.users?.line_user_id;

    if (!performerLineUserId) {
      console.warn(
        "演奏者のLINEユーザーIDがありません"
      );

      return NextResponse.json({
        success: true,
        message:
          "マッチングが成立しましたが、演奏者のLINEユーザーIDがありません",
        matchId,
        coinBalance,
        notificationSent: false,
      });
    }

    // =====================================================
    // 13. 演奏者へLINE通知
    // =====================================================

    const detailUrl =
      "https://miniapp.line.me/2011785379-l5XCTbIf/performer/matches/" +
      matchId;

    const flexMessage = {
      type: "flex",
      altText: "マッチングが成立しました！",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: "🎉 マッチング成立！",
              weight: "bold",
              size: "xl",
            },
            {
              type: "text",
              text: "応募した演奏案件が採用されました。",
              margin: "md",
              wrap: true,
            },
            {
              type: "text",
              text: performanceRequest.title,
              weight: "bold",
              size: "lg",
              margin: "md",
              wrap: true,
            },
            {
              type: "text",
              text: `演奏日：${performanceRequest.performance_date}`,
              margin: "md",
              wrap: true,
            },
            {
              type: "text",
              text: `時間：${performanceRequest.start_time}〜${performanceRequest.end_time}`,
              margin: "sm",
              wrap: true,
            },
            {
              type: "text",
              text: `報酬：${performanceRequest.reward?.toLocaleString()}円`,
              margin: "sm",
              wrap: true,
            },
            {
              type: "button",
              action: {
                type: "uri",
                label: "マッチング詳細を見る",
                uri: detailUrl,
              },
              style: "primary",
              margin: "lg",
            },
          ],
        },
      },
    };

    let notificationSent = false;

    try {
      const lineResponse = await fetch(
        "https://api.line.me/v2/bot/message/push",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            to: performerLineUserId,
            messages: [flexMessage],
          }),
        }
      );

      if (!lineResponse.ok) {
        const lineError = await lineResponse.text();

        console.error(
          "LINE通知エラー:",
          lineResponse.status,
          lineError
        );
      } else {
        notificationSent = true;
      }
    } catch (lineError) {
      console.error(
        "LINE通知例外:",
        lineError
      );
    }

    // =====================================================
    // 14. 成功レスポンス
    // =====================================================
    return NextResponse.json({
      success: true,
      message: "マッチングが成立しました",
      matchId,
      coinBalance,
      notificationSent,
    });
  } catch (error) {
    console.error(
      "マッチング処理で予期しないエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "マッチング処理に失敗しました",
      },
      { status: 500 }
    );
  }
}