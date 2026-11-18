
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";

function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return NextResponse.json(body, { ...init, headers });
}

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
      error: privateJson(
        { error: "LINEの認証情報がありません。再ログインしてください" },
        { status: 401 }
      ),
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      error: privateJson(
        { error: "LINEの本人確認に失敗しました。再ログインしてください" },
        { status: 401 }
      ),
    };
  }

  if (!supabase) {
    return {
      error: privateJson(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      ),
    };
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", verified.userId)
    .eq("account_status", "active")
    .maybeSingle();

  if (userError) {
    console.error("バンド応募のユーザー取得エラー:", userError);

    return {
      error: privateJson(
        { error: "ユーザー情報を取得できませんでした" },
        { status: 500 }
      ),
    };
  }

  if (!user) {
    return {
      error: privateJson(
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
      error: privateJson(
        { error: "演奏者情報を取得できませんでした" },
        { status: 500 }
      ),
    };
  }

  if (!performer) {
    return {
      error: privateJson(
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
  is_replay?: boolean;
};

// バンド応募状態取得
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return privateJson(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const { bandId } = await context.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(bandId)) {
      return privateJson(
        { error: "バンドIDが正しくありません" },
        { status: 400 }
      );
    }

    const requestId = request.nextUrl.searchParams.get("requestId");

    if (!requestId || !uuidPattern.test(requestId)) {
      return privateJson(
        { error: "案件IDが正しくありません" },
        { status: 400 }
      );
    }

    const auth = await getAuthenticatedPerformer(request);

    if ("error" in auth) {
      return auth.error;
    }

    const { data: membership, error: membershipError } =
      await supabase
        .from("band_members")
        .select("role, status")
        .eq("band_id", bandId)
        .eq("performer_id", auth.performer.id)
        .eq("role", "leader")
        .eq("status", "active")
        .maybeSingle();

    if (membershipError) {
      console.error("バンドリーダー権限確認エラー:", membershipError);

      return privateJson(
        { error: "バンドの権限を確認できませんでした" },
        { status: 500 }
      );
    }

    if (!membership) {
      return privateJson(
        { error: "このバンドの応募状態を確認する権限がありません" },
        { status: 403 }
      );
    }

    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("id, status")
      .eq("id", bandId)
      .eq("status", "active")
      .maybeSingle();

    if (bandError) {
      console.error("バンド状態取得エラー:", bandError);

      return privateJson(
        { error: "バンド情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!band) {
      return privateJson(
        { error: "このバンドは現在応募に使用できません" },
        { status: 403 }
      );
    }

    const { data: application, error: applicationError } =
      await supabase
        .from("applications")
        .select("id, status")
        .eq("request_id", requestId)
        .eq("band_id", bandId)
        .maybeSingle();

    if (applicationError) {
      console.error("バンド応募状態取得エラー:", applicationError);

      return privateJson(
        { error: "バンド応募状態を取得できませんでした" },
        { status: 500 }
      );
    }

    return privateJson({
      application: application
        ? {
            id: application.id,
            status: application.status,
          }
        : null,
    });
  } catch (error) {
    console.error("バンド応募状態APIエラー:", error);

    return privateJson(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return privateJson(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const { bandId } = await context.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(bandId)) {
      return privateJson(
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
      return privateJson(
        { error: "リクエスト形式が正しくありません" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return privateJson(
        { error: "入力内容が正しくありません" },
        { status: 400 }
      );
    }

    const input = body as {
      requestId?: unknown;
      message?: unknown;
      operationId?: unknown;
    };

    if (
      typeof input.requestId !== "string" ||
      !uuidPattern.test(input.requestId) ||
      typeof input.operationId !== "string" ||
      !uuidPattern.test(input.operationId)
    ) {
      return privateJson(
        { error: "案件IDが正しくありません" },
        { status: 400 }
      );
    }

    if (
      input.message !== undefined &&
      input.message !== null &&
      typeof input.message !== "string"
    ) {
      return privateJson(
        { error: "応募メッセージの形式が正しくありません" },
        { status: 400 }
      );
    }

    const message =
      typeof input.message === "string"
        ? input.message.trim()
        : "";

    if (message.length > 2000) {
      return privateJson(
        { error: "応募メッセージは2000文字以内で入力してください" },
        { status: 400 }
      );
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "submit_band_application_idempotent",
      {
        p_operation_id: input.operationId,
        p_user_id: auth.user.id,
        p_performer_id: auth.performer.id,
        p_band_id: bandId,
        p_request_id: input.requestId,
        p_message: message || null,
      }
    );

    if (rpcError) {
      console.error("バンド応募DB処理エラー:", rpcError);

      return privateJson(
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
        errorMessage === "IDEMPOTENCY_CONFLICT" ||
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

      return privateJson(
        { error: errorMessage },
        { status }
      );
    }

    let notificationSent = false;

    if (result.is_replay !== true) {
      const delivery = await drainLineNotificationOutbox(supabase, 20);
      notificationSent = delivery.sent > 0;
    }

    return privateJson(
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

    return privateJson(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
