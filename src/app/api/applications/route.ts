
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLinePushMessage } from "@/lib/line";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// 全レスポンスにキャッシュ禁止ヘッダーを設定
function jsonResponse(
  body: unknown,
  init: ResponseInit = {}
): NextResponse {
  const headers = new Headers(init.headers);

  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Authorization");

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

// 日本時間の今日を YYYY-MM-DD 形式で取得
function getJapanToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

// LINE IDトークンを取得
function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  return token || null;
}

// DB関数のエラーを利用者向けの安全なメッセージに変換
function getSafeApplicationError(errorMessage: string): {
  message: string;
  status: number;
} {
  if (errorMessage === "IDEMPOTENCY_CONFLICT") {
    return { message: "同じ応募操作IDに異なる内容が指定されました。画面を再読み込みして再度お試しください。", status: 409 };
  }

  if (errorMessage.includes("すでに応募")) {
    return {
      message: "この案件にはすでに応募しています。",
      status: 409,
    };
  }

  if (errorMessage.includes("すでに採用")) {
    return {
      message: "この案件ではすでに採用されています。",
      status: 409,
    };
  }

  if (errorMessage.includes("再応募できない")) {
    return {
      message: "この案件には再応募できません。",
      status: 409,
    };
  }

  if (errorMessage.includes("応募期限")) {
    return {
      message: "応募期限を過ぎているため、この案件には応募できません。",
      status: 400,
    };
  }

  if (
    errorMessage.includes("対象レベル") ||
    errorMessage.includes("募集対象")
  ) {
    return {
      message: "この案件の募集対象とプロフィールの演奏者レベルが一致しません。",
      status: 403,
    };
  }

  if (errorMessage.includes("権限")) {
    return {
      message: "この操作を行う権限がありません。",
      status: 403,
    };
  }

  if (errorMessage.includes("見つかりません")) {
    return {
      message: "対象の情報が見つかりません。",
      status: 404,
    };
  }

  if (
    errorMessage.includes("コイン") ||
    errorMessage.includes("残高")
  ) {
    return {
      message: "コイン残高が不足しているか、利用できない状態です。",
      status: 400,
    };
  }

  if (
    errorMessage.includes("現在応募できません") ||
    errorMessage.includes("募集を終了")
  ) {
    return {
      message: "この案件は現在応募できません。",
      status: 400,
    };
  }

  return {
    message: "応募処理を完了できませんでした。内容を確認して再度お試しください。",
    status: 400,
  };
}

// =====================================================
// GET：応募状態取得
// =====================================================

export async function GET(request: NextRequest) {
  try {
    const requestId = request.nextUrl.searchParams.get("requestId");

    if (!requestId) {
      return jsonResponse(
        { error: "案件IDがありません" },
        { status: 400 }
      );
    }

    if (!UUID_PATTERN.test(requestId)) {
      return jsonResponse(
        { error: "案件IDの形式が正しくありません" },
        { status: 400 }
      );
    }

    // LINE本人確認
    const idToken = getBearerToken(request);

    if (!idToken) {
      return jsonResponse(
        { error: "LINEの本人確認情報がありません" },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return jsonResponse(
        { error: "LINEの本人確認に失敗しました" },
        { status: 401 }
      );
    }

    // LINEユーザー取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .single();

    if (userError || !user) {
      return jsonResponse(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者情報取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .single();

    if (performerError || !performer) {
      return jsonResponse(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // 個人名義の応募状態を取得（バンド応募は除外）
    const { data: application, error: applicationError } =
      await supabase
        .from("applications")
        .select("id, status")
        .eq("request_id", requestId)
        .eq("performer_id", performer.id)
        .is("band_id", null)
        .maybeSingle();

    if (applicationError) {
      console.error("応募状態取得エラー:", applicationError);

      return jsonResponse(
        { error: "応募状態の取得に失敗しました" },
        { status: 500 }
      );
    }

    return jsonResponse({
      success: true,
      application: application
        ? {
            id: application.id,
            status: application.status,
          }
        : null,
    });
  } catch (error) {
    console.error("応募状態取得APIエラー:", error);

    return jsonResponse(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

// =====================================================
// POST：応募登録・コイン消費
// =====================================================

export async function POST(request: NextRequest) {
  try {
    // JSON解析と入力形式確認
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "リクエストの形式が正しくありません" },
        { status: 400 }
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return jsonResponse(
        { error: "入力内容が正しくありません" },
        { status: 400 }
      );
    }

    const { requestId, message, operationId } = body as {
      requestId?: unknown;
      message?: unknown;
      operationId?: unknown;
    };

    if (!requestId) {
      return jsonResponse(
        { error: "案件IDがありません" },
        { status: 400 }
      );
    }

    if (
      typeof requestId !== "string" ||
      !UUID_PATTERN.test(requestId) ||
      typeof operationId !== "string" ||
      !UUID_PATTERN.test(operationId) ||
      (message !== undefined &&
        message !== null &&
        typeof message !== "string") ||
      (typeof message === "string" && message.length > 2000)
    ) {
      return jsonResponse(
        {
          error:
            "入力内容を確認してください（メッセージは2000文字以内です）",
        },
        { status: 400 }
      );
    }

    const applicationMessage =
      typeof message === "string" ? message : "";

    // ================================================
    // LINE本人確認
    // ================================================

    const idToken = getBearerToken(request);

    if (!idToken) {
      return jsonResponse(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return jsonResponse(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    // ================================================
    // LINEユーザー取得
    // ================================================

    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return jsonResponse(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // ================================================
    // 演奏者情報取得
    // ================================================

    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select("id, name, status_level")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error("演奏者取得エラー:", performerError);

      return jsonResponse(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // ================================================
    // 案件取得
    // ================================================

    const {
      data: performanceRequest,
      error: requestError,
    } = await supabase
      .from("performance_requests")
      .select(
        "id, status, title, performance_date, start_time, end_time, area, facility_id, target_levels, application_deadline"
      )
      .eq("id", requestId)
      .single();

    if (requestError || !performanceRequest) {
      console.error("案件取得エラー:", requestError);

      return jsonResponse(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    // ================================================
    // 応募期限確認
    // ================================================

    // 締切日当日は応募可能。
    // 日本時間で締切日の翌日になった時点で応募不可。
    const today = getJapanToday();

    const applicationDeadline = String(
      performanceRequest.application_deadline || ""
    ).slice(0, 10);

    if (
      !applicationDeadline ||
      today > applicationDeadline
    ) {
      return jsonResponse(
        {
          error:
            "応募期限を過ぎているため、この案件には応募できません",
        },
        { status: 400 }
      );
    }

    // ================================================
    // 募集中の案件か確認
    // ================================================

    if (performanceRequest.status !== "open") {
      return jsonResponse(
        { error: "この案件は現在応募できません" },
        { status: 400 }
      );
    }

    // ================================================
    // 募集対象レベルの確認
    // ================================================

    // target_levels が NULL または空配列なら制限なし。
    const targetLevels = performanceRequest.target_levels;

    if (
      Array.isArray(targetLevels) &&
      targetLevels.length > 0 &&
      (
        !performer.status_level ||
        !targetLevels.includes(performer.status_level)
      )
    ) {
      const levelNames: Record<string, string> = {
        beginner: "初心者",
        amateur: "アマチュア",
        pro: "プロ",
      };

      const targetLevelNames = targetLevels
        .map((level: string) => levelNames[level] ?? level)
        .join("・");

      return jsonResponse(
        {
          error:
            `この案件の募集対象は「${targetLevelNames}」です。` +
            "登録プロフィールの演奏者レベルが対象外のため応募できません。",
        },
        { status: 403 }
      );
    }

    // ================================================
    // 応募登録・コイン消費をDBで一括実行
    // ================================================

    // operationIdは画面が生成し、通信再送時も同じ値を使う。
    const {
      data: applicationResultData,
      error: applicationResultError,
    } = await supabase.rpc("submit_personal_application_idempotent", {
      p_operation_id: operationId,
      p_user_id: user.id,
      p_request_id: requestId,
      p_performer_id: performer.id,
      p_message: applicationMessage,
    });

    if (applicationResultError) {
      console.error(
        "応募一括処理RPCエラー:",
        applicationResultError
      );

      return jsonResponse(
        {
          error:
            "応募処理に失敗しました。時間をおいて再度お試しください。",
        },
        { status: 500 }
      );
    }

    const applicationResult = Array.isArray(applicationResultData)
      ? applicationResultData[0]
      : applicationResultData;

    if (!applicationResult?.success) {
      const internalErrorMessage =
        typeof applicationResult?.error_message === "string"
          ? applicationResult.error_message
          : "";

      // 詳細なDBエラーはサーバーログだけに記録する
      console.error("応募一括処理が失敗しました");

      const safeError =
        getSafeApplicationError(internalErrorMessage);

      return jsonResponse(
        { error: safeError.message },
        { status: safeError.status }
      );
    }

    // ================================================
    // 登録された応募情報を取得
    // ================================================

    const {
      data: savedApplication,
      error: savedApplicationError,
    } = await supabase
      .from("applications")
      .select(
        "id, request_id, performer_id, message, status, source, band_id, created_at"
      )
      .eq("id", applicationResult.application_id)
      .eq("performer_id", performer.id)
      .single();

    if (savedApplicationError || !savedApplication) {
      console.error(
        "応募データ取得エラー:",
        savedApplicationError
      );
    }

    // 応募データの取得に失敗しても、
    // DB側の応募・コイン処理はすでに完了している
    const application = savedApplication ?? {
      id: applicationResult.application_id,
      request_id: requestId,
      performer_id: performer.id,
      message: applicationMessage || null,
      status: "pending",
      source: "performer_apply",
      band_id: null,
    };

    // ================================================
    // 施設へのLINE通知
    // ================================================

    let notificationSent = false;

    try {
      if (applicationResult.is_replay === true) {
        notificationSent = false;
      } else {
      const {
        data: facility,
        error: facilityError,
      } = await supabase
        .from("facilities")
        .select("id, user_id, name")
        .eq("id", performanceRequest.facility_id)
        .single();

      if (facilityError || !facility) {
        console.error("施設取得エラー:", facilityError);
      } else {
        const {
          data: facilityUser,
          error: facilityUserError,
        } = await supabase
          .from("users")
          .select("line_user_id, display_name")
          .eq("id", facility.user_id)
          .single();

        if (facilityUserError || !facilityUser) {
          console.error(
            "施設LINEユーザー取得エラー:",
            facilityUserError
          );
        } else {
          const performerName = performer.name || "演奏者";

          const facilityName =
            facility.name ||
            facilityUser.display_name ||
            "施設";

          const detailUrl =
            "https://miniapp.line.me/2011785379-l5XCTbIf/facility/requests/" +
            requestId +
            "/applications";

          const messages = [
            {
              type: "flex",
              altText: "🎵 新しい応募があります！",
              contents: {
                type: "bubble",
                body: {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "🎵 新しい応募があります！",
                      weight: "bold",
                      size: "xl",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text:
                        facilityName +
                        "さんの案件に、" +
                        performerName +
                        "さんから応募がありました。",
                      margin: "md",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text: "案件：" + performanceRequest.title,
                      margin: "md",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text:
                        "演奏日時：" +
                        performanceRequest.performance_date +
                        "\n" +
                        "時間：" +
                        performanceRequest.start_time +
                        " ～ " +
                        performanceRequest.end_time +
                        "\n" +
                        "場所：" +
                        (performanceRequest.area || "未設定"),
                      margin: "md",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text: applicationMessage
                        ? "応募メッセージ：\n" + applicationMessage
                        : "応募メッセージ：なし",
                      margin: "md",
                      wrap: true,
                    },
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
                        label: "応募者を確認する",
                        uri: detailUrl,
                      },
                    },
                  ],
                },
              },
            },
          ];

          const lineResult = await sendLinePushMessage(
            facilityUser.line_user_id,
            messages
          );

          if (lineResult.success) {
            notificationSent = true;
            console.log("施設へのLINE通知送信成功");
          } else {
            console.error(
              "施設へのLINE通知送信失敗:",
              lineResult.error
            );
          }
        }
      }
      }
    } catch (notificationError) {
      console.error(
        "施設へのLINE通知処理エラー:",
        notificationError
      );
    }

    return jsonResponse({
      success: true,
      application,
      coinBalance: applicationResult.balance_after,
      notificationSent,
    });
  } catch (error) {
    console.error("応募APIエラー:", error);

    return jsonResponse(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
