import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLinePushMessage } from "@/lib/line";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

export async function GET(request: NextRequest) {
  try {
    const requestId = request.nextUrl.searchParams.get("requestId");

    if (!requestId) {
      return NextResponse.json(
        { error: "案件IDがありません" },
        { status: 400 }
      );
    }

    // LINE本人確認
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = match?.[1]?.trim();

    if (!idToken) {
      return NextResponse.json(
        { error: "LINEの本人確認情報がありません" },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
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
      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者情報取得
    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      return NextResponse.json(
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

      return NextResponse.json(
        { error: "応募状態の取得に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
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

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { requestId, message } = body;

    const applicationMessage =
      typeof message === "string" ? message : "";

    if (!requestId) {
      return NextResponse.json(
        { error: "案件IDがありません" },
        { status: 400 }
      );
    }

    // ==============================
    // LINE本人確認
    // ==============================

    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = match?.[1]?.trim();

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

    // ==============================
    // LINEユーザー取得
    // ==============================

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

      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // ==============================
    // 演奏者情報取得
    // ==============================

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

      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // ==============================
    // 案件取得
    // ==============================

    const {
      data: performanceRequest,
      error: requestError,
    } = await supabase
      .from("performance_requests")
      .select(
        "id, status, title, performance_date, start_time, end_time, area, facility_id, target_levels, application_deadline, reward"
      )
      .eq("id", requestId)
      .single();

    if (requestError || !performanceRequest) {
      console.error("案件取得エラー:", requestError);

      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    // ==============================
    // 応募期限確認
    // ==============================

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
      return NextResponse.json(
        {
          error:
            "応募期限を過ぎているため、この案件には応募できません",
        },
        { status: 400 }
      );
    }

    // ==============================
    // 募集中の案件か確認
    // ==============================

    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        { error: "この案件は現在応募できません" },
        { status: 400 }
      );
    }

    // ==============================
    // 募集対象レベルの確認
    // ==============================

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

      return NextResponse.json(
        {
          error:
            `この案件の募集対象は「${targetLevelNames}」です。` +
            "登録プロフィールの演奏者レベルが対象外のため応募できません。",
        },
        { status: 403 }
      );
    }

    // ==============================
    // 応募登録・コイン消費をDBで一括実行
    // ==============================

    // 1回の応募処理につき一意の試行IDを発行
    const attemptId = crypto.randomUUID();

    const {
      data: applicationResultData,
      error: applicationResultError,
    } = await supabase.rpc("apply_to_performance_request", {
      p_user_id: user.id,
      p_request_id: requestId,
      p_performer_id: performer.id,
      p_message: applicationMessage,
      p_attempt_id: attemptId,
    });

    if (applicationResultError) {
      console.error(
        "応募一括処理RPCエラー:",
        applicationResultError
      );

      return NextResponse.json(
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
      const errorMessage =
        applicationResult?.error_message ||
        "応募処理に失敗しました";

      console.error("応募一括処理失敗:", errorMessage);

      let status = 400;

      if (
        errorMessage.includes("すでに応募") ||
        errorMessage.includes("すでに採用") ||
        errorMessage.includes("再応募できない")
      ) {
        status = 409;
      } else if (errorMessage.includes("権限")) {
        status = 403;
      } else if (errorMessage.includes("見つかりません")) {
        status = 404;
      }

      return NextResponse.json(
        { error: errorMessage },
        { status }
      );
    }

    // ==============================
    // 登録された応募情報を取得
    // ==============================

    const {
      data: savedApplication,
      error: savedApplicationError,
    } = await supabase
      .from("applications")
      .select("*")
      .eq("id", applicationResult.application_id)
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

    // ==============================
    // 施設へのLINE通知
    // ==============================

    let notificationSent = false;

    try {
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
    } catch (notificationError) {
      console.error(
        "施設へのLINE通知処理エラー:",
        notificationError
      );
    }

    return NextResponse.json({
      success: true,
      application,
      coinBalance: applicationResult.balance_after,
      notificationSent,
    });
  } catch (error) {
    console.error("応募APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}