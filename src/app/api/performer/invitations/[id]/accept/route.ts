import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLinePushMessage } from "@/lib/line";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "依頼IDが指定されていません" },
        { status: 400 }
      );
    }

    // LINEユーザーIDを取得
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザーIDが取得できません" },
        { status: 401 }
      );
    }

    // LINEユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, line_user_id, display_name, picture_url, user_type")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者情報を取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id, user_id, name")
        .eq("user_id", user.id)
        .single();

    if (performerError || !performer) {
      console.error("演奏者取得エラー:", performerError);

      return NextResponse.json(
        { error: "演奏者情報が見つかりません" },
        { status: 404 }
      );
    }

    // 承諾対象の直接依頼を確認
    const { data: application, error: applicationError } =
      await supabase
        .from("applications")
        .select(`
          id,
          request_id,
          performer_id,
          source,
          status,
          performance_requests (
            id,
            title,
            facility_id,
            status
          )
        `)
        .eq("id", id)
        .eq("performer_id", performer.id)
        .eq("source", "facility_invite")
        .eq("status", "pending")
        .single();

    if (applicationError || !application) {
      console.error("依頼取得エラー:", applicationError);

      return NextResponse.json(
        { error: "承諾できる依頼が見つかりません" },
        { status: 404 }
      );
    }

    const performanceRequest = Array.isArray(
      application.performance_requests
    )
      ? application.performance_requests[0]
      : application.performance_requests;

    if (!performanceRequest) {
      return NextResponse.json(
        { error: "案件情報が見つかりません" },
        { status: 404 }
      );
    }

    // DB関数で承諾・マッチング作成・案件更新を一括実行
    const { data: result, error: rpcError } = await supabase
      .rpc("accept_direct_invitation_atomic", {
        p_application_id: application.id,
        p_performer_id: performer.id,
      });


    if (rpcError) {
      console.error("直接依頼の承諾処理エラー:", rpcError);

      const errorMessage = rpcError.message || "";
      const isInsufficientCoins =
        /コイン不足|コインが不足|チャージが必要|insufficient|coin/i.test(
          errorMessage
        );

      return NextResponse.json(
        {
          error: isInsufficientCoins
            ? "施設側のコインが不足しています。チャージしてから再度お試しください。"
            : "依頼の承諾処理に失敗しました。時間をおいて再度お試しください。",
        },
        {
          status: isInsufficientCoins ? 400 : 500,
        }
      );
    }


    const rpcResult = Array.isArray(result) ? result[0] : result;

    if (!rpcResult?.success || !rpcResult.match_id) {
      const errorMessage =
        rpcResult?.error_message ||
        "この依頼を承諾できませんでした";

      return NextResponse.json(
        { error: errorMessage },
        { status: 409 }
      );
    }

    // 作成されたマッチング情報を取得
    const { data: match, error: matchFetchError } = await supabase
      .from("matches")
      .select("*")
      .eq("id", rpcResult.match_id)
      .single();

    if (matchFetchError || !match) {
      console.error(
        "マッチング情報取得エラー:",
        matchFetchError
      );

      // DB処理自体は成功済みなので、ここで承諾を取り消さない
      return NextResponse.json({
        success: true,
        message: "マッチングは成立しました",
        match: { id: rpcResult.match_id },
        notificationSent: false,
      });
    }

    // 施設情報を取得
    const { data: facility, error: facilityError } =
      await supabase
        .from("facilities")
        .select(`
          id,
          user_id,
          name,
          users (
            id,
            line_user_id,
            display_name
          )
        `)
        .eq("id", performanceRequest.facility_id)
        .single();

    if (facilityError) {
      console.error("施設情報取得エラー:", facilityError);
    }

    let notificationSent = false;

    // 施設へLINE通知
    const facilityUser = facility?.users
      ? Array.isArray(facility.users)
        ? facility.users[0]
        : facility.users
      : null;

    const facilityLineUserId = facilityUser?.line_user_id;

    if (facilityLineUserId) {
      const miniAppBaseUrl =
        "https://miniapp.line.me/2011785379-l5XCTbIf";

      const matchUrl =
        `${miniAppBaseUrl}/facility/matches/${match.id}`;

      const messages = [
        {
          type: "flex",
          altText:
            "演奏依頼が承諾され、マッチングが成立しました",
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                {
                  type: "text",
                  text: "🎉 マッチング成立",
                  weight: "bold",
                  size: "xl",
                },
                {
                  type: "text",
                  text:
                    "演奏者があなたの依頼を承諾しました。",
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
      } catch (notificationError) {
        console.error(
          "施設へのLINE通知送信エラー:",
          notificationError
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "依頼を承諾し、マッチングが成立しました",
      match,
      notificationSent,
    });
  } catch (error) {
    console.error("依頼承諾APIエラー:", error);

    return NextResponse.json(
      { error: "依頼の承諾中にエラーが発生しました" },
      { status: 500 }
    );
  }
}