import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { sendLinePushMessage } from "@/lib/line";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;

type RouteContext = {
  params: Promise<{
    bandId: string;
  }>;
};

async function getAuthenticatedPerformer(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();

  if (!idToken) {
    return {
      error: NextResponse.json(
        { error: "LINEの認証情報がありません。再ログインしてください" },
        { status: 401 }
      ),
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      error: NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください" },
        { status: 401 }
      ),
    };
  }

  if (!supabase) {
    return {
      error: NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      ),
    };
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", verified.userId)
    .maybeSingle();

  if (userError) {
    console.error("バンド応募のユーザー取得エラー:", userError);

    return {
      error: NextResponse.json(
        { error: "ユーザー情報を取得できませんでした" },
        { status: 500 }
      ),
    };
  }

  if (!user) {
    return {
      error: NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      ),
    };
  }

  const { data: performer, error: performerError } = await supabase
    .from("performers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (performerError) {
    console.error("バンド応募の演奏者取得エラー:", performerError);

    return {
      error: NextResponse.json(
        { error: "演奏者情報を取得できませんでした" },
        { status: 500 }
      ),
    };
  }

  if (!performer) {
    return {
      error: NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      ),
    };
  }

  return {
    user,
    performer,
  };
}

type BandApplicationResult = {
  success: boolean;
  application_id: string | null;
  balance_after: number | null;
  coins_spent: number;
  error_message: string | null;
};

async function sendApplicationNotification(
  requestId: string,
  bandId: string,
  message: string
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  try {
    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select(
          "id, title, performance_date, start_time, end_time, area, facility_id"
        )
        .eq("id", requestId)
        .maybeSingle();

    if (requestError || !performanceRequest) {
      console.error(
        "バンド応募の通知用案件取得エラー:",
        requestError
      );
      return false;
    }

    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("name")
      .eq("id", bandId)
      .maybeSingle();

    if (bandError || !band) {
      console.error("バンド応募の通知用バンド取得エラー:", bandError);
      return false;
    }

    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("user_id")
      .eq("id", performanceRequest.facility_id)
      .maybeSingle();

    if (facilityError || !facility) {
      console.error("バンド応募の施設取得エラー:", facilityError);
      return false;
    }

    const { data: facilityUser, error: facilityUserError } =
      await supabase
        .from("users")
        .select("line_user_id")
        .eq("id", facility.user_id)
        .maybeSingle();

    if (facilityUserError || !facilityUser?.line_user_id) {
      console.error(
        "バンド応募の施設LINE情報取得エラー:",
        facilityUserError
      );
      return false;
    }

    const notificationResult = await sendLinePushMessage(
      facilityUser.line_user_id,
      [
        {
          type: "flex",
          altText: "🎵 新しいバンド応募があります",
          contents: {
            type: "bubble",
            size: "mega",
            header: {
              type: "box",
              layout: "vertical",
              backgroundColor: "#5B46D8",
              paddingAll: "16px",
              contents: [
                {
                  type: "text",
                  text: "🎵 新しいバンド応募",
                  color: "#FFFFFF",
                  weight: "bold",
                  size: "lg",
                  wrap: true,
                },
                {
                  type: "text",
                  text: "演奏案件にバンドから応募が届きました",
                  color: "#EAE6FF",
                  size: "xs",
                  wrap: true,
                  margin: "sm",
                },
              ],
            },
            body: {
              type: "box",
              layout: "vertical",
              paddingAll: "16px",
              spacing: "md",
              contents: [
                {
                  type: "text",
                  text: "応募バンド",
                  size: "xs",
                  color: "#6B7280",
                },
                {
                  type: "text",
                  text: band.name || "バンド名未設定",
                  size: "lg",
                  weight: "bold",
                  color: "#111827",
                  wrap: true,
                },
                {
                  type: "separator",
                  margin: "sm",
                },
                {
                  type: "text",
                  text: "案件名",
                  size: "xs",
                  color: "#6B7280",
                },
                {
                  type: "text",
                  text: performanceRequest.title || "未設定",
                  size: "md",
                  weight: "bold",
                  color: "#111827",
                  wrap: true,
                },
                {
                  type: "box",
                  layout: "horizontal",
                  spacing: "sm",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "演奏日",
                      size: "sm",
                      color: "#6B7280",
                      flex: 2,
                    },
                    {
                      type: "text",
                      text: String(
                        performanceRequest.performance_date || "未設定"
                      ),
                      size: "sm",
                      color: "#111827",
                      flex: 5,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: "box",
                  layout: "horizontal",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "演奏時間",
                      size: "sm",
                      color: "#6B7280",
                      flex: 2,
                    },
                    {
                      type: "text",
                      text:
                        `${performanceRequest.start_time || "未設定"}` +
                        `〜${performanceRequest.end_time || "未設定"}`,
                      size: "sm",
                      color: "#111827",
                      flex: 5,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: "box",
                  layout: "horizontal",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "場所",
                      size: "sm",
                      color: "#6B7280",
                      flex: 2,
                    },
                    {
                      type: "text",
                      text: performanceRequest.area || "未設定",
                      size: "sm",
                      color: "#111827",
                      flex: 5,
                      wrap: true,
                    },
                  ],
                },
                {
                  type: "text",
                  text: "応募メッセージ",
                  size: "xs",
                  color: "#6B7280",
                  margin: "lg",
                },
                {
                  type: "text",
                  text: message || "メッセージはありません",
                  size: "sm",
                  color: "#374151",
                  wrap: true,
                },
              ],
            },
            footer: {
              type: "box",
              layout: "vertical",
              paddingAll: "16px",
              contents: [
                {
                  type: "button",
                  style: "primary",
                  color: "#5B46D8",
                  height: "md",
                  action: {
                    type: "uri",
                    label: "応募者を確認する",
                    uri:
                      `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}` +
                      `/facility/requests/${requestId}/applications`,
                  },
                },
              ],
            },
          },
        },
      ]
    );

    if (!notificationResult?.success) {
      console.error(
        "バンド応募の施設LINE通知に失敗しました:",
        notificationResult?.error
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("バンド応募LINE通知エラー:", error);
    return false;
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const { bandId } = await context.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(bandId)) {
      return NextResponse.json(
        { error: "バンドIDが正しくありません" },
        { status: 400 }
      );
    }

    const auth = await getAuthenticatedPerformer(request);

    if ("error" in auth) {
      return auth.error;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "リクエスト形式が正しくありません" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "入力内容が正しくありません" },
        { status: 400 }
      );
    }

    const input = body as {
      requestId?: unknown;
      message?: unknown;
    };

    if (
      typeof input.requestId !== "string" ||
      !uuidPattern.test(input.requestId)
    ) {
      return NextResponse.json(
        { error: "案件IDが正しくありません" },
        { status: 400 }
      );
    }

    if (
      input.message !== undefined &&
      input.message !== null &&
      typeof input.message !== "string"
    ) {
      return NextResponse.json(
        { error: "応募メッセージの形式が正しくありません" },
        { status: 400 }
      );
    }

    const message =
      typeof input.message === "string"
        ? input.message.trim()
        : "";

    if (message.length > 2000) {
      return NextResponse.json(
        { error: "応募メッセージは2000文字以内で入力してください" },
        { status: 400 }
      );
    }

    // 応募登録とコイン消費を専用DB関数で一括処理
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "apply_to_performance_request_as_band",
      {
        p_user_id: auth.user.id,
        p_performer_id: auth.performer.id,
        p_band_id: bandId,
        p_request_id: input.requestId,
        p_message: message || null,
      }
    );

    if (rpcError) {
      console.error("バンド応募DB処理エラー:", rpcError);

      return NextResponse.json(
        {
          error:
            "バンド応募の処理に失敗しました。時間をおいて再度お試しください。",
        },
        { status: 500 }
      );
    }

    const result = (
      Array.isArray(rpcData) ? rpcData[0] : rpcData
    ) as BandApplicationResult | null;

    if (!result?.success || !result.application_id) {
      const errorMessage =
        result?.error_message || "バンド応募の処理に失敗しました";

      const status =
        /すでに.*応募|すでに.*採用|重複/.test(errorMessage)
          ? 409
          : /リーダー/.test(errorMessage)
            ? 403
            : /コイン不足|コインが不足|残高がマイナス/.test(
                  errorMessage
                )
              ? 400
              : /期限|応募できません|対象レベル/.test(errorMessage)
                ? 400
                : 400;

      return NextResponse.json(
        { error: errorMessage },
        { status }
      );
    }

    // 初回応募・却下後の再応募で実際にコインを消費した場合だけ通知
    // 既存応募の再実行では coins_spent が 0 のため通知しない
    let notificationSent = false;

    if (result.coins_spent > 0) {
      notificationSent = await sendApplicationNotification(
        input.requestId,
        bandId,
        message
      );
    }

    return NextResponse.json(
      {
        success: true,
        application: {
          id: result.application_id,
          requestId: input.requestId,
          bandId,
          status: "pending",
          source: "band_apply",
        },
        coinsSpent: result.coins_spent,
        coinBalance: result.balance_after,
        notificationSent,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("バンド応募APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}