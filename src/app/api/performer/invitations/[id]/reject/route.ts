import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id || !UUID_PATTERN.test(id)) {
      return NextResponse.json(
        { error: "有効な依頼IDを指定してください" },
        { status: 400 }
      );
    }

    // LINE IDトークンを検証
    const authorization = request.headers.get("authorization");
    const idToken =
      authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";

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

    // LINEユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, line_user_id, display_name, picture_url, user_type")
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

    // 辞退と施設への手数料返金をDB関数で実行
    const { data: refundResult, error: refundError } =
      await supabase.rpc(
        "reject_direct_invitation_with_notification_outbox",
        {
          p_application_id: application.id,
          p_performer_id: performer.id,
          p_actor_user_id: user.id,
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

    // 旧方式で実際に返金された履歴がある場合だけ、返金済みと案内する。
    const { data: refundTransaction } = await supabase
      .from("coin_transactions")
      .select("id")
      .eq("idempotency_key", `direct_invite_refund:${application.id}`)
      .maybeSingle();
    const wasRefunded = Boolean(refundTransaction?.id);
    const facilityNoticeText = wasRefunded
      ? "演奏者が今回の依頼を辞退しました。旧方式で徴収されていた直接依頼手数料は返金されました。"
      : "演奏者が今回の依頼を辞退しました。今回の依頼ではマッチング成立前の手数料徴収はありません。";

    // 辞退・返金と通知Outbox登録はapplications更新トリガーで同一transaction内に確定済み。
    const notificationDelivery = await drainLineNotificationOutbox(supabase, 20);
    const notificationSent = notificationDelivery.sent > 0;

    return NextResponse.json({
      success: true,
      message: wasRefunded
        ? "依頼を辞退しました。旧方式で徴収されていた直接依頼手数料を施設に返金しました。"
        : "依頼を辞退しました。マッチング成立前の手数料徴収はありません。",
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