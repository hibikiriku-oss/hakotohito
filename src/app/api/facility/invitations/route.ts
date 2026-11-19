import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
        const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!idToken) {
      return NextResponse.json(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const lineUserId = verified.userId;

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
      .eq("account_status", "active")
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
    // 直接依頼を登録し、設定された料金分の残高を確認する。
    // 実際の徴収は承諾・マッチング成立と同じDBトランザクションで行う。
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

    // 通知はapplication_attemptsのDBトリガーで同一トランザクション内にOutbox登録済み。
    // ここでは即時配信を試みるだけで、失敗分はOutboxの再試行対象として残す。
    const delivery = await drainLineNotificationOutbox(supabase, 20);
    const notificationSent = delivery.sent > 0;

    // --------------------------------
    // 完了
    // --------------------------------

    return NextResponse.json({
      success: true,
      message: "オファーを送信しました",
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