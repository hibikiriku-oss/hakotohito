import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getAuthenticatedPerformer(
  request: NextRequest
) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();

  if (!idToken) {
    return {
      error: privateJson(
        {
          error:
            "LINEの認証情報がありません。再ログインしてください",
        },
        { status: 401 }
      ),
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      error: privateJson(
        {
          error:
            "LINEの本人確認に失敗しました。再ログインしてください",
        },
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
    console.error("チャットのユーザー取得エラー:", userError);

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
    console.error(
      "チャットの演奏者取得エラー:",
      performerError
    );

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
        { error: "演奏者プロフィールを登録してください" },
        { status: 404 }
      ),
    };
  }

  return { performerId: performer.id, lineUserId: verified.userId };
}

async function verifyActiveBandMember(
  bandId: string,
  performerId: string
) {
  if (!supabase) {
    return {
      error: privateJson(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      ),
    };
  }

  const { data: band, error: bandError } = await supabase
    .from("bands")
    .select("id, name, status")
    .eq("id", bandId)
    .maybeSingle();

  if (bandError) {
    console.error("チャットのバンド取得エラー:", bandError);

    return {
      error: privateJson(
        { error: "バンド情報を取得できませんでした" },
        { status: 500 }
      ),
    };
  }

  if (!band) {
    return {
      error: privateJson(
        { error: "バンドが見つかりません" },
        { status: 404 }
      ),
    };
  }

  if (band.status !== "active") {
    return {
      error: privateJson(
        { error: "このバンドは現在活動していません" },
        { status: 409 }
      ),
    };
  }

  const { data: membership, error: membershipError } =
    await supabase
      .from("band_members")
      .select("id")
      .eq("band_id", bandId)
      .eq("performer_id", performerId)
      .eq("status", "active")
      .maybeSingle();

  if (membershipError) {
    console.error("チャットの所属確認エラー:", membershipError);

    return {
      error: privateJson(
        { error: "バンドの所属情報を確認できませんでした" },
        { status: 500 }
      ),
    };
  }

  if (!membership) {
    return {
      error: privateJson(
        { error: "このバンドのメンバーだけがチャットを利用できます" },
        { status: 403 }
      ),
    };
  }

  return {
    bandId: band.id,
    bandName: band.name,
  };
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return privateJson({ error: "サーバーの設定に問題があります" }, { status: 500 });
    }
    const { bandId } = await context.params;
    if (!uuidPattern.test(bandId)) {
      return privateJson({ error: "バンドIDが正しくありません" }, { status: 400 });
    }
    const auth = await getAuthenticatedPerformer(request);
    if ("error" in auth) return auth.error;

    const { data, error } = await supabase.rpc("get_band_chat_messages_atomic", {
      p_band_id: bandId,
      p_sender_performer_id: auth.performerId,
      p_line_user_id: auth.lineUserId,
    });
    if (error || !data?.success) {
      const errorCode = data?.errorCode;
      if (errorCode === "band_not_active") {
        return privateJson({ error: "このバンドは現在活動していません" }, { status: 409 });
      }
      if (["not_active_member", "user_inactive"].includes(errorCode)) {
        return privateJson({ error: "このバンドのメンバーだけがチャットを利用できます" }, { status: 403 });
      }
      console.error("バンドチャット取得RPCエラー:", error?.message || errorCode);
      return privateJson({ error: "チャット履歴を取得できませんでした" }, { status: 500 });
    }
    return privateJson({ band: data.band, messages: data.messages ?? [] });
  } catch (error) {
    console.error("チャット履歴APIエラー:", error);
    return privateJson({ error: "サーバーエラーが発生しました" }, { status: 500 });
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

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return privateJson(
        { error: "入力内容が正しくありません" },
        { status: 400 }
      );
    }

    const input = body as { message?: unknown };

    if (typeof input.message !== "string") {
      return privateJson(
        { error: "メッセージを入力してください" },
        { status: 400 }
      );
    }

    const message = input.message.trim();

    if (message.length < 1 || message.length > 2000) {
      return privateJson(
        { error: "メッセージは1〜2000文字で入力してください" },
        { status: 400 }
      );
    }

    const access = await verifyActiveBandMember(
      bandId,
      auth.performerId
    );

    if ("error" in access) {
      return access.error;
    }

    const { data: sendResult, error: insertError } = await supabase.rpc(
      "send_band_chat_message_atomic",
      {
        p_band_id: bandId,
        p_sender_performer_id: auth.performerId,
        p_message: message,
        p_line_user_id: auth.lineUserId,
      }
    );

    if (insertError || !sendResult?.success) {
      const errorCode = sendResult?.errorCode;
      if (errorCode === "band_not_active") {
        return privateJson(
          { error: "このバンドは現在活動していません" },
          { status: 409 }
        );
      }
      if (errorCode === "not_active_member" || errorCode === "sender_inactive") {
        return privateJson(
          { error: "このバンドのメンバーだけがチャットを利用できます" },
          { status: 403 }
        );
      }
      console.error("チャットメッセージ送信エラー:", insertError?.message || errorCode);
      return privateJson(
        { error: "メッセージを送信できませんでした" },
        { status: 500 }
      );
    }
    const createdMessage = sendResult.message;

    return privateJson(
      {
        success: true,
        message: {
          id: createdMessage.id,
          bandId: createdMessage.band_id,
          senderPerformerId: createdMessage.sender_performer_id,
          senderName: createdMessage.sender_name ?? "自分",
          message: createdMessage.message,
          createdAt: createdMessage.created_at,
          isMine: true,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("チャットメッセージAPIエラー:", error);

    return privateJson(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}