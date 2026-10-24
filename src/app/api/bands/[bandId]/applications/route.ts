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

function getJapanToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

function normalizeLevel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const level = value.trim().toLowerCase();

  const aliases: Record<string, string> = {
    beginner: "beginner",
    "初心者": "beginner",
    "初級": "beginner",
    "初級者": "beginner",

    amateur: "amateur",
    "アマチュア": "amateur",

    pro: "pro",
    "プロ": "pro",
    "プロフェッショナル": "pro",
  };

  return aliases[level] ?? (level || null);
}

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

async function getAuthenticatedPerformer(
  request: NextRequest
) {
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
    .select("id, coin_balance")
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
    .select("id, user_id, name, status_level")
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

function normalizeLevel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const level = value.trim().toLowerCase();

  const aliases: Record<string, string> = {
    beginner: "beginner",
    "初心者": "beginner",
    "初級": "beginner",
    "初級者": "beginner",

    amateur: "amateur",
    "アマチュア": "amateur",

    pro: "pro",
    "プロ": "pro",
    "プロフェッショナル": "pro",
  };

  return aliases[level] ?? (level || null);
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

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        bandId
      )
    ) {
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
      !input.requestId.trim()
    ) {
      return NextResponse.json(
        { error: "案件IDがありません" },
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

    // バンドが存在し、活動中か確認
    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("id, name, status")
      .eq("id", bandId)
      .maybeSingle();

    if (bandError) {
      console.error("バンド応募のバンド取得エラー:", bandError);

      return NextResponse.json(
        { error: "バンド情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!band || band.status !== "active") {
      return NextResponse.json(
        { error: "活動中のバンドが見つかりません" },
        { status: 404 }
      );
    }

    // 現在の演奏者が当該バンドのリーダーか確認
    // リーダー本人の明示的な操作によって応募手数料を支払う
    const { data: leaderMembership, error: leaderError } =
      await supabase
        .from("band_members")
        .select("id")
        .eq("band_id", bandId)
        .eq("performer_id", auth.performer.id)
        .eq("role", "leader")
        .eq("status", "active")
        .maybeSingle();

    if (leaderError) {
      console.error("バンドリーダー確認エラー:", leaderError);

      return NextResponse.json(
        { error: "バンドのリーダー情報を確認できませんでした" },
        { status: 500 }
      );
    }

    if (!leaderMembership) {
      return NextResponse.json(
        { error: "バンドリーダーだけがバンド名義で応募できます" },
        { status: 403 }
      );
    }

    // 活動中のメンバー全員を取得
    const { data: memberships, error: membersError } =
      await supabase
        .from("band_members")
        .select("performer_id")
        .eq("band_id", bandId)
        .eq("status", "active");

    if (membersError) {
      console.error("バンドメンバー取得エラー:", membersError);

      return NextResponse.json(
        { error: "バンドメンバーを取得できませんでした" },
        { status: 500 }
      );
    }

    const memberIds = [
      ...new Set(
        (memberships ?? []).map((member) => member.performer_id)
      ),
    ];

    if (memberIds.length === 0) {
      return NextResponse.json(
        { error: "バンドに活動中のメンバーがいません" },
        { status: 400 }
      );
    }

    // 案件を取得
    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select(
          "id, status, title, performance_date, start_time, end_time, area, facility_id, target_levels, application_deadline, reward"
        )
        .eq("id", input.requestId)
        .maybeSingle();

    if (requestError) {
      console.error("バンド応募の案件取得エラー:", requestError);

      return NextResponse.json(
        { error: "案件情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!performanceRequest) {
      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    // 応募期限を確認。締切日当日は応募可能
    const today = getJapanToday();
    const deadline = String(
      performanceRequest.application_deadline ?? ""
    ).slice(0, 10);

    if (!deadline || today > deadline) {
      return NextResponse.json(
        {
          error:
            "応募期限を過ぎているため、この案件には応募できません",
        },
        { status: 400 }
      );
    }

    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        { error: "この案件は現在応募できません" },
        { status: 400 }
      );
    }

    // 募集対象レベルが指定されている場合、活動中の全メンバーを確認
    const targetLevels = performanceRequest.target_levels;

    if (Array.isArray(targetLevels) && targetLevels.length > 0) {
      const { data: members, error: levelsError } = await supabase
        .from("performers")
        .select("id, status_level")
        .in("id", memberIds);

      if (levelsError) {
        console.error("バンドの演奏者レベル取得エラー:", levelsError);

        return NextResponse.json(
          { error: "バンドメンバーの演奏者レベルを確認できませんでした" },
          { status: 500 }
        );
      }

      const levelNames: Record<string, string> = {
        beginner: "初心者",
        amateur: "アマチュア",
        pro: "プロ",
      };

      const normalizedTargetLevels = new Set(
        (targetLevels as unknown[])
          .map((level) => normalizeLevel(level))
          .filter((level): level is string => level !== null)
      );

      const ineligibleMembers = (members ?? []).filter((member) => {
        const memberLevel = normalizeLevel(member.status_level);

        return (
          memberLevel === null ||
          !normalizedTargetLevels.has(memberLevel)
        );
      });

      if (ineligibleMembers.length > 0) {
        const targetLevelNames = targetLevels
          .map((level: string) => levelNames[level] ?? level)
          .join("・");

        return NextResponse.json(
          {
            error:
              `この案件の募集対象は「${targetLevelNames}」です。` +
              "活動中のバンドメンバー全員が対象レベルに該当する必要があります。",
          },
          { status: 403 }
        );
      }
    }

    // バンド単位で既存応募を確認
    const { data: existingApplication, error: existingError } =
      await supabase
        .from("applications")
        .select("id, request_id, band_id, performer_id, message, status, source")
        .eq("request_id", performanceRequest.id)
        .eq("band_id", bandId)
        .maybeSingle();

    if (existingError) {
      console.error("バンド応募の既存応募確認エラー:", existingError);

      return NextResponse.json(
        { error: "既存のバンド応募を確認できませんでした" },
        { status: 500 }
      );
    }

    if (
      existingApplication &&
      existingApplication.status === "pending"
    ) {
      return NextResponse.json(
        { error: "このバンドはすでにこの案件に応募しています" },
        { status: 409 }
      );
    }

    if (
      existingApplication &&
      existingApplication.status === "accepted"
    ) {
      return NextResponse.json(
        { error: "このバンドはすでにこの案件に採用されています" },
        { status: 409 }
      );
    }

    // まず現在残高を確認
    const currentBalance = Number(auth.user.coin_balance ?? 0);
    const requiredCoins = 10;

    if (currentBalance < 0) {
      return NextResponse.json(
        {
          error:
            "コイン残高がマイナスのため、新しい案件には応募できません。",
        },
        { status: 400 }
      );
    }

    if (currentBalance < requiredCoins) {
      return NextResponse.json(
        {
          error:
            `バンド応募には10コイン必要です。` +
            `リーダーの現在の残高は${currentBalance}コインです。`,
        },
        { status: 400 }
      );
    }

    // 応募登録・再応募
    let application;
    const isReapply =
      existingApplication?.status === "rejected";

    if (isReapply && existingApplication) {
      const { data: updatedApplication, error: updateError } =
        await supabase
          .from("applications")
          .update({
            performer_id: auth.performer.id,
            message: message || null,
            status: "pending",
            source: "band_apply",
          })
          .eq("id", existingApplication.id)
          .eq("request_id", performanceRequest.id)
          .eq("band_id", bandId)
          .select()
          .single();

      if (updateError || !updatedApplication) {
        console.error("バンド再応募更新エラー:", updateError);

        return NextResponse.json(
          { error: "バンド再応募の登録に失敗しました" },
          { status: 500 }
        );
      }

      application = updatedApplication;
    } else {
      const { data: newApplication, error: insertError } =
        await supabase
          .from("applications")
          .insert({
            request_id: performanceRequest.id,
            performer_id: auth.performer.id,
            band_id: bandId,
            message: message || null,
            status: "pending",
            source: "band_apply",
          })
          .select()
          .single();

      if (insertError || !newApplication) {
        console.error("バンド応募登録エラー:", insertError);

        if (insertError?.code === "23505") {
          return NextResponse.json(
            { error: "このバンドはすでにこの案件に応募しています" },
            { status: 409 }
          );
        }

        return NextResponse.json(
          { error: "バンド応募の登録に失敗しました" },
          { status: 500 }
        );
      }

      application = newApplication;
    }

    // リーダー本人の残高から10コインを消費
    const idempotencyKey =
      `band_application_fee:${application.id}:${crypto.randomUUID()}`;

    const { data: coinResult, error: coinError } =
      await supabase.rpc("spend_coins", {
        p_user_id: auth.user.id,
        p_amount: requiredCoins,
        p_transaction_type: "application_fee",
        p_description: `バンド「${band.name}」の演奏案件応募手数料`,
        p_idempotency_key: idempotencyKey,
        p_request_id: performanceRequest.id,
        p_application_id: application.id,
        p_match_id: null,
      });

    const coin = Array.isArray(coinResult)
      ? coinResult[0]
      : coinResult;

    if (coinError || !coin?.success) {
      console.error(
        "バンド応募コイン処理エラー:",
        coinError ?? coin
      );

      // 応募前の状態に戻す
      if (isReapply && existingApplication) {
        const { error: restoreError } = await supabase
          .from("applications")
          .update({
            performer_id: existingApplication.performer_id,
            message: existingApplication.message,
            status: existingApplication.status,
            source: existingApplication.source,
          })
          .eq("id", application.id);

        if (restoreError) {
          console.error("バンド再応募の復元エラー:", restoreError);
        }
      } else {
        const { error: deleteError } = await supabase
          .from("applications")
          .delete()
          .eq("id", application.id);

        if (deleteError) {
          console.error("バンド応募の取り消しエラー:", deleteError);
        }
      }

      const errorMessage = coin?.error_message || "";

      const insufficientCoins =
        /コイン不足|コインが不足|チャージが必要|insufficient/i.test(
          errorMessage
        );

      return NextResponse.json(
        {
          error: insufficientCoins
            ? errorMessage
            : "応募コインの処理に失敗しました。時間をおいて再度お試しください。",
        },
        { status: insufficientCoins ? 400 : 500 }
      );
    }

    // 施設へのLINE通知。通知失敗で応募を取り消さない
    let notificationSent = false;

    try {
      const { data: facility, error: facilityError } = await supabase
        .from("facilities")
        .select("id, user_id, name")
        .eq("id", performanceRequest.facility_id)
        .maybeSingle();

      if (facilityError || !facility) {
        console.error("バンド応募の施設取得エラー:", facilityError);
      } else {
        const { data: facilityUser, error: facilityUserError } =
          await supabase
            .from("users")
            .select("line_user_id, display_name")
            .eq("id", facility.user_id)
            .maybeSingle();

        if (facilityUserError || !facilityUser?.line_user_id) {
          console.error(
            "バンド応募の施設LINE情報取得エラー:",
            facilityUserError
          );
        } else {
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
                  `/facility/requests/${performanceRequest.id}/applications`,
              },
            },
          ],
        },
      },
    },
  ]
);

          notificationSent = Boolean(notificationResult?.success);

          if (!notificationSent) {
            console.error(
              "バンド応募の施設LINE通知に失敗しました:",
              notificationResult?.error
            );
          }
        }
      }
    } catch (notificationError) {
      console.error("バンド応募LINE通知エラー:", notificationError);
    }

    // 応募後のリーダー残高を取得
    const { data: latestUser, error: balanceError } =
      await supabase
        .from("users")
        .select("coin_balance")
        .eq("id", auth.user.id)
        .single();

    if (balanceError) {
      console.error("バンド応募後の残高取得エラー:", balanceError);
    }

    return NextResponse.json(
      {
        success: true,
        application: {
          id: application.id,
          requestId: performanceRequest.id,
          bandId,
          bandName: band.name,
          status: "pending",
          source: "band_apply",
        },
        coinsSpent: requiredCoins,
        coinBalance: latestUser?.coin_balance ?? coin.balance_after ?? null,
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