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

    // 辞退対象の直接依頼を取得
    const { data: application, error: applicationError } =
      await supabase
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
        { error: "辞退できる依頼が見つかりません" },
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

    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        { error: "この案件はすでに締め切られています" },
        { status: 409 }
      );
    }

    // 辞退と施設への100コイン返金をDB関数で実行
    const { data: refundResult, error: refundError } =
      await supabase.rpc(
        "reject_direct_invitation_with_refund",
        {
          p_application_id: application.id,
          p_performer_id: performer.id,
        }
      );

    if (refundError) {
      console.error("依頼辞退・返金処理エラー:", refundError);

      return NextResponse.json(
        { error: "依頼の辞退・返金処理に失敗しました" },
        { status: 500 }
      );
    }

    const result = Array.isArray(refundResult)
      ? refundResult[0]
      : refundResult;

    if (!result?.success) {
      return NextResponse.json(
        {
          error: result?.error_message || "依頼を辞退できませんでした",
        },
        { status: 409 }
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

    const facilityUser = facility?.users
      ? Array.isArray(facility.users)
        ? facility.users[0]
        : facility.users
      : null;

    const facilityLineUserId = facilityUser?.line_user_id;

    if (facilityLineUserId) {
      const miniAppBaseUrl =
        "https://miniapp.line.me/2011785379-l5XCTbIf";

      const requestUrl =
        `${miniAppBaseUrl}/facility/requests/${performanceRequest.id}`;

      const messages = [
        {
          type: "flex",
          altText: "演奏者がオファーを辞退しました",
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                {
                  type: "text",
                  text: "オファーについて",
                  weight: "bold",
                  size: "xl",
                },
                {
                  type: "text",
                  text: "演奏者が今回の依頼を辞退しました。消費した直接依頼手数料は返金されました。",
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
                    label: "案件を確認する",
                    uri: requestUrl,
                  },
                },
              ],
            },
          },
        },
      ];

      const lineResult = await sendLinePushMessage(
        facilityLineUserId,
        messages
      );

      if (lineResult.success) {
        notificationSent = true;
      } else {
        console.error("施設へのLINE通知エラー:", lineResult.error);
      }
    }

    return NextResponse.json({
      success: true,
      message: "依頼を辞退しました。施設に直接依頼手数料を返金しました。",
      application: {
        ...application,
        status: "rejected",
      },
      balanceAfter: result.balance_after,
      notificationSent,
    });
  } catch (error) {
    console.error("依頼辞退APIエラー:", error);

    return NextResponse.json(
      { error: "依頼の辞退中にエラーが発生しました" },
      { status: 500 }
    );
  }
}