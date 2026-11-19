import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { drainLineNotificationOutbox, enqueueLineNotification } from "@/lib/line-notification-outbox";
import { verifyLineIdToken } from "@/lib/line-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Vary: "Authorization",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_REQUEST_TYPES = [
  "live",
  "festival",
  "session",
  "rental",
];

function jsonResponse(
  body: unknown,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function logDatabaseError(
  label: string,
  error: { code?: string; name?: string } | null
) {
  console.error(label, {
    code: error?.code ?? null,
    name: error?.name ?? null,
  });
}

function getSafeMatchingError(message: unknown) {
  const rawMessage =
    typeof message === "string" ? message : "";

  if (/コイン不足|コインが不足|チャージが必要|insufficient|coin/i.test(rawMessage)) {
    return {
      error: "コイン不足のためマッチングできません",
      status: 400,
    };
  }

  if (/定員|募集人数|上限人数/.test(rawMessage)) {
    return {
      error: "この案件は募集人数に達しています。",
      status: 400,
    };
  }

  if (/この案件はこの施設のものではありません/.test(rawMessage)) {
    return {
      error: "この案件を操作する権限がありません。",
      status: 403,
    };
  }

  if (/pending|応募|採用|マッチング/.test(rawMessage)) {
    return {
      error: "この応募は採用できない状態です。画面を更新して確認してください。",
      status: 400,
    };
  }

  return {
    error: "マッチング処理に失敗しました。時間をおいて再度お試しください。",
    status: 500,
  };
}

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
    // 1. パラメータ取得・UUID検証
    // ----------------------------------------
    const {
      id: requestId,
      applicationId,
    } = await context.params;

    if (
      !UUID_REGEX.test(requestId) ||
      !UUID_REGEX.test(applicationId)
    ) {
      return jsonResponse(
        { error: "案件IDまたは応募IDが正しくありません。" },
        400
      );
    }

    // ----------------------------------------
    // 2. LINE本人確認
    // ----------------------------------------
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = match?.[1]?.trim();

    if (!idToken) {
      return jsonResponse(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        401
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return jsonResponse(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        401
      );
    }

    // ----------------------------------------
    // 3. Supabase環境変数確認
    // ----------------------------------------
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        "採用API: Supabase環境変数が未設定です"
      );

      return jsonResponse(
        { error: "サーバーの設定に問題があります。" },
        500
      );
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // ----------------------------------------
    // 4. LINEユーザー取得
    // ----------------------------------------
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id, account_status")
        .eq("line_user_id", verified.userId)
        .eq("account_status", "active")
        .single();

    if (userError || !user) {
      logDatabaseError(
        "採用API: ユーザー取得エラー",
        userError
      );

      return jsonResponse(
        { error: "ユーザーが見つかりません。" },
        404
      );
    }

    // ----------------------------------------
    // 5. 施設取得
    // ----------------------------------------
    const { data: facility, error: facilityError } =
      await supabase
        .from("facilities")
        .select("id")
        .eq("user_id", user.id)
        .single();

    if (facilityError || !facility) {
      logDatabaseError(
        "採用API: 施設取得エラー",
        facilityError
      );

      return jsonResponse(
        { error: "施設情報が見つかりません。" },
        404
      );
    }

    // ----------------------------------------
    // 6. 案件取得・所有権確認
    // ----------------------------------------
    const {
      data: performanceRequest,
      error: requestError,
    } = await supabase
      .from("performance_requests")
      .select("id, request_type, status")
      .eq("id", requestId)
      .eq("facility_id", facility.id)
      .single();

    if (requestError || !performanceRequest) {
      logDatabaseError(
        "採用API: 案件取得エラー",
        requestError
      );

      return jsonResponse(
        {
          error: "案件が見つからないか、この施設の案件ではありません。",
        },
        404
      );
    }

    // ----------------------------------------
    // 7. 案件種別に応じた状態確認
    // ----------------------------------------
    const isEventRequest = EVENT_REQUEST_TYPES.includes(
      performanceRequest.request_type
    );

    // 通常案件はmatchedなら追加採用不可。
    // イベント案件はDB関数側で定員を判定するため、
    // matched状態でも追加採用を許可する。
    if (
      performanceRequest.status === "matched" &&
      !isEventRequest
    ) {
      return jsonResponse(
        {
          error: "この案件はすでにマッチング済みです。",
        },
        400
      );
    }

    // ----------------------------------------
    // 8. 応募情報取得
    // ----------------------------------------
    const {
      data: application,
      error: applicationError,
    } = await supabase
      .from("applications")
      .select("id, performer_id, band_id, status, source")
      .eq("id", applicationId)
      .eq("request_id", requestId)
      .single();

    if (applicationError || !application) {
      logDatabaseError(
        "採用API: 応募情報取得エラー",
        applicationError
      );

      return jsonResponse(
        { error: "応募情報が見つかりません。" },
        404
      );
    }

    // バンド応募なのにバンドIDがない不整合データは採用しない
    if (
      application.source === "band_apply" &&
      !application.band_id
    ) {
      return jsonResponse(
        {
          error: "バンド情報に不整合があります。運営にお問い合わせください。",
        },
        400
      );
    }

    // ----------------------------------------
    // 9. 応募状態確認
    // ----------------------------------------
    if (application.status !== "pending") {
      return jsonResponse(
        {
          error: "この応募はすでに処理されています。画面を更新してください。",
        },
        400
      );
    }

    // ----------------------------------------
    // 10. DB関数で採用・コイン処理
    // ----------------------------------------
    const {
      data: matchingResult,
      error: matchingError,
    } = await supabase.rpc(
      "accept_application_with_coins",
      {
        p_request_id: requestId,
        p_application_id: applicationId,
        p_facility_user_id: user.id,
      }
    );

    if (matchingError) {
      logDatabaseError(
        "採用API: マッチングRPCエラー",
        matchingError
      );

      const rawMatchingError = matchingError.message || "";
      if (/コイン不足|コインが不足|insufficient/i.test(rawMatchingError)) {
        const facilityIsPayer = /施設のコイン残高が不足/.test(rawMatchingError);
        let otherPartyLineUserId: string | null = null;
        let noticeText = "";

        if (facilityIsPayer) {
          const { data: performerForNotice } = await supabase
            .from("performers")
            .select("users(line_user_id)")
            .eq("id", application.performer_id)
            .maybeSingle();
          const relatedUser = Array.isArray(performerForNotice?.users)
            ? performerForNotice.users[0]
            : performerForNotice?.users;
          otherPartyLineUserId = relatedUser?.line_user_id ?? null;
          noticeText = "施設のコイン不足のためマッチングは保留されています。施設側のコイン補充後に、施設から再度採用処理を行います。";
        } else {
          const { data: facilityUserForNotice } = await supabase
            .from("users")
            .select("line_user_id")
            .eq("id", user.id)
            .maybeSingle();
          otherPartyLineUserId = facilityUserForNotice?.line_user_id ?? null;
          noticeText = "演奏者のコイン不足のためマッチングは保留されています。演奏者がコインを補充した後、施設から再度採用処理を行います。";
        }

        if (typeof otherPartyLineUserId === "string" && otherPartyLineUserId) {
          await enqueueLineNotification(
            supabase,
            `matching_insufficient:${applicationId}:${facilityIsPayer ? "facility" : "performer"}`,
            otherPartyLineUserId,
            noticeText,
          );
        }
      }

      const safeError = getSafeMatchingError(
        matchingError.message
      );

      return jsonResponse(
        { error: safeError.error },
        safeError.status
      );
    }

    // Supabase RPCは通常配列で返るため1件目を取得
    const matching = Array.isArray(matchingResult)
      ? matchingResult[0]
      : matchingResult;

    // ----------------------------------------
    // 11. RPC結果確認
    // ----------------------------------------
    if (!matching?.success) {
      console.error(
        "採用API: マッチング失敗",
        {
          errorMessage: matching?.error_message ?? null,
        }
      );

      const safeError = getSafeMatchingError(
        matching?.error_message
      );

      return jsonResponse(
        { error: safeError.error },
        safeError.status
      );
    }

    const matchId = matching.match_id;

    if (
      typeof matchId !== "string" ||
      !UUID_REGEX.test(matchId)
    ) {
      console.error(
        "採用API: マッチングIDが不正です"
      );

      return jsonResponse(
        {
          error: "マッチング情報の取得に失敗しました。",
        },
        500
      );
    }

    // ----------------------------------------
    // 12. 採用後の施設残高取得
    // ----------------------------------------
    const {
      data: facilityBalance,
      error: balanceError,
    } = await supabase
      .from("users")
      .select("coin_balance")
      .eq("id", user.id)
      .single();

    if (balanceError || !facilityBalance) {
      logDatabaseError(
        "採用API: 施設残高取得エラー",
        balanceError
      );
    }

    const coinBalance =
      facilityBalance?.coin_balance ?? null;

    // 成立通知はmatches INSERTと同一トランザクションでOutboxへ登録済み。
    // ここで即時送信を試み、失敗分はcronが再送する。
    const notificationResult = await drainLineNotificationOutbox(supabase, 20);
    return jsonResponse({
      success: true,
      message: "マッチングが成立しました",
      matchId,
      coinBalance,
      notificationQueued: true,
      notificationDelivery: {
        sent: notificationResult.sent,
        retried: notificationResult.retried,
        failedToRecord: notificationResult.failedToRecord,
      },
    });
  } catch (error) {
    console.error(
      "採用API: 予期しないエラー",
      {
        name:
          error instanceof Error
            ? error.name
            : "UnknownError",
      }
    );

    return jsonResponse(
      {
        error: "マッチング処理に失敗しました。時間をおいて再度お試しください。",
      },
      500
    );
  }
}