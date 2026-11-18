import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { drainLineNotificationOutbox, enqueueLineNotification } from "@/lib/line-notification-outbox";
import { verifyLineIdToken } from "@/lib/line-auth";

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

    // LINE IDトークンを検証
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
            status,
            facilities (
              id,
              user_id,
              users (
                id,
                line_user_id,
                account_status
              )
            )
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

      const facilityRelation = Array.isArray(performanceRequest.facilities)
        ? performanceRequest.facilities[0]
        : performanceRequest.facilities;
      const facilityUserRelation = Array.isArray(facilityRelation?.users)
        ? facilityRelation.users[0]
        : facilityRelation?.users;
      const facilityLineUserId = facilityUserRelation?.line_user_id;

      // The facility is the payer for a direct invitation. Notify that
      // account, not the performer who is currently attempting acceptance.
      if (
        isInsufficientCoins &&
        facilityUserRelation?.account_status === "active" &&
        typeof facilityLineUserId === "string" &&
        facilityLineUserId &&
        !facilityLineUserId.startsWith("withdrawn:")
      ) {
        await enqueueLineNotification(
          supabase,
          `direct_invite_insufficient:${application.id}`,
          facilityLineUserId,
          "施設のコイン残高不足により、演奏者からの直接依頼承諾をマッチング成立できませんでした。コイン補充後、演奏者に再度承諾を依頼してください。",
        );
      }

      return NextResponse.json(
        {
          error: isInsufficientCoins
            ? "コイン不足のためマッチングできません"
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
      .select("id")
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
        notificationQueued: true,
      });
    }

    // 成立通知はmatches INSERTと同一トランザクションでOutboxへ登録済み。
    // ここで即時送信を試み、失敗分はcronが再送する。
    const notificationResult = await drainLineNotificationOutbox(supabase, 20);
    return NextResponse.json({
      success: true,
      message: "依頼を承諾し、マッチングが成立しました",
      match,
      notificationQueued: true,
      notificationDelivery: {
        sent: notificationResult.sent,
        retried: notificationResult.retried,
        failedToRecord: notificationResult.failedToRecord,
      },
    });
  } catch (error) {
    console.error("依頼承諾APIエラー:", error);

    return NextResponse.json(
      { error: "依頼の承諾中にエラーが発生しました" },
      { status: 500 }
    );
  }
}