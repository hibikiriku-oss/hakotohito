import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    const { data: performer, error: performerError } = await supabase
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

    // 施設から送られた依頼を取得
    const { data: application, error: applicationError } = await supabase
      .from("applications")
      .select(`
        id,
        request_id,
        performer_id,
        message,
        status,
        source,
        performance_requests (
          id,
          title,
          performance_date,
          start_time,
          end_time,
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

    // 案件がまだ募集中か確認
    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        {
          error: "この案件はすでに締め切られています",
        },
        { status: 409 }
      );
    }

    // 念のため既存のマッチングを確認
    const { data: existingMatch, error: existingMatchError } =
      await supabase
        .from("matches")
        .select("id")
        .eq("request_id", performanceRequest.id)
        .maybeSingle();

    if (existingMatchError) {
      console.error("既存マッチング確認エラー:", existingMatchError);

      return NextResponse.json(
        { error: "マッチング状態の確認に失敗しました" },
        { status: 500 }
      );
    }

    if (existingMatch) {
      return NextResponse.json(
        {
          error: "この案件はすでにマッチング成立しています",
        },
        { status: 409 }
      );
    }

    // 依頼を承諾
    const { data: acceptedApplication, error: acceptError } = await supabase
      .from("applications")
      .update({
        status: "accepted",
      })
      .eq("id", application.id)
      .eq("performer_id", performer.id)
      .eq("source", "facility_invite")
      .eq("status", "pending")
      .select()
      .single();

    if (acceptError || !acceptedApplication) {
      console.error("依頼承諾エラー:", acceptError);

      return NextResponse.json(
        { error: "依頼の承諾に失敗しました" },
        { status: 500 }
      );
    }

    // 同じ案件の他の応募・依頼を辞退扱いにする
    const { error: rejectOthersError } = await supabase
      .from("applications")
      .update({
        status: "rejected",
      })
      .eq("request_id", performanceRequest.id)
      .eq("status", "pending")
      .neq("id", application.id);

    if (rejectOthersError) {
      console.error(
        "他の応募・依頼の更新エラー:",
        rejectOthersError
      );

      // ここではマッチング成立を優先する
    }

    // マッチングを作成
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .insert({
        request_id: performanceRequest.id,
        performer_id: performer.id,
        status: "active",
      })
      .select()
      .single();

    if (matchError || !match) {
      console.error("マッチング作成エラー:", matchError);

      // マッチング作成に失敗した場合、承諾状態を戻す
      await supabase
        .from("applications")
        .update({
          status: "pending",
        })
        .eq("id", application.id);

      return NextResponse.json(
        { error: "マッチングの作成に失敗しました" },
        { status: 500 }
      );
    }

    // 案件をマッチング済みにする
    const { error: requestUpdateError } = await supabase
      .from("performance_requests")
      .update({
        status: "matched",
      })
      .eq("id", performanceRequest.id)
      .eq("status", "open");

    if (requestUpdateError) {
      console.error(
        "案件ステータス更新エラー:",
        requestUpdateError
      );
    }

    // 施設情報を取得
    const { data: facility, error: facilityError } = await supabase
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

    if (facilityLineUserId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      const miniAppBaseUrl =
        "https://miniapp.line.me/2011785379-l5XCTbIf";

      const matchUrl = `${miniAppBaseUrl}/facility/matches/${match.id}`;

      const lineResponse = await fetch(
        "https://api.line.me/v2/bot/message/push",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            to: facilityLineUserId,
            messages: [
              {
                type: "flex",
                altText: "演奏依頼が承諾され、マッチングが成立しました",
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
                        text: "演奏者があなたの依頼を承諾しました。",
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
            ],
          }),
        }
      );

      if (lineResponse.ok) {
        notificationSent = true;
      } else {
        const lineError = await lineResponse.text();
        console.error("施設へのLINE通知エラー:", lineError);
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