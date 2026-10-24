import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

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
      error: NextResponse.json(
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
      error: NextResponse.json(
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
    console.error("チャットのユーザー取得エラー:", userError);

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
    console.error(
      "チャットの演奏者取得エラー:",
      performerError
    );

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
        { error: "演奏者プロフィールを登録してください" },
        { status: 404 }
      ),
    };
  }

  return { performerId: performer.id };
}

async function verifyActiveBandMember(
  bandId: string,
  performerId: string
) {
  if (!supabase) {
    return {
      error: NextResponse.json(
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
      error: NextResponse.json(
        { error: "バンド情報を取得できませんでした" },
        { status: 500 }
      ),
    };
  }

  if (!band) {
    return {
      error: NextResponse.json(
        { error: "バンドが見つかりません" },
        { status: 404 }
      ),
    };
  }

  if (band.status !== "active") {
    return {
      error: NextResponse.json(
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
      error: NextResponse.json(
        { error: "バンドの所属情報を確認できませんでした" },
        { status: 500 }
      ),
    };
  }

  if (!membership) {
    return {
      error: NextResponse.json(
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
      return NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const { bandId } = await context.params;

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

    const access = await verifyActiveBandMember(
      bandId,
      auth.performerId
    );

    if ("error" in access) {
      return access.error;
    }

    // 最新100件を取得して、画面では古い順に表示する
    const { data: rows, error: messagesError } = await supabase
      .from("band_messages")
      .select(
        "id, band_id, sender_performer_id, message, created_at"
      )
      .eq("band_id", bandId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (messagesError) {
      console.error("バンドメッセージ取得エラー:", messagesError);

      return NextResponse.json(
        { error: "チャット履歴を取得できませんでした" },
        { status: 500 }
      );
    }

    const messageRows = rows ?? [];

    const senderIds = [
      ...new Set(
        messageRows.map((row) => row.sender_performer_id)
      ),
    ];

    const senderNames = new Map<string, string>();

    if (senderIds.length > 0) {
      const { data: senders, error: sendersError } =
        await supabase
          .from("performers")
          .select("id, name")
          .in("id", senderIds);

      if (sendersError) {
        console.error("チャット送信者取得エラー:", sendersError);

        return NextResponse.json(
          { error: "送信者情報を取得できませんでした" },
          { status: 500 }
        );
      }

      for (const sender of senders ?? []) {
        senderNames.set(sender.id, sender.name);
      }
    }

    const messages = messageRows
      .slice()
      .reverse()
      .map((row) => ({
        id: row.id,
        bandId: row.band_id,
        senderPerformerId: row.sender_performer_id,
        senderName:
          senderNames.get(row.sender_performer_id) ??
          "不明な演奏者",
        message: row.message,
        createdAt: row.created_at,
        isMine: row.sender_performer_id === auth.performerId,
      }));

    return NextResponse.json({
      band: {
        id: access.bandId,
        name: access.bandName,
      },
      messages,
    });
  } catch (error) {
    console.error("チャット履歴APIエラー:", error);

    return NextResponse.json(
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
      return NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const { bandId } = await context.params;

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

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "入力内容が正しくありません" },
        { status: 400 }
      );
    }

    const input = body as { message?: unknown };

    if (typeof input.message !== "string") {
      return NextResponse.json(
        { error: "メッセージを入力してください" },
        { status: 400 }
      );
    }

    const message = input.message.trim();

    if (message.length < 1 || message.length > 2000) {
      return NextResponse.json(
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

    const { data: createdMessage, error: insertError } =
      await supabase
        .from("band_messages")
        .insert({
          band_id: bandId,
          sender_performer_id: auth.performerId,
          message,
        })
        .select(
          "id, band_id, sender_performer_id, message, created_at"
        )
        .single();

    if (insertError) {
      console.error("チャットメッセージ送信エラー:", insertError);

      return NextResponse.json(
        { error: "メッセージを送信できませんでした" },
        { status: 500 }
      );
    }

    const { data: sender, error: senderError } = await supabase
      .from("performers")
      .select("name")
      .eq("id", auth.performerId)
      .maybeSingle();

    if (senderError) {
      console.error("送信者名取得エラー:", senderError);
    }

    return NextResponse.json(
      {
        success: true,
        message: {
          id: createdMessage.id,
          bandId: createdMessage.band_id,
          senderPerformerId: createdMessage.sender_performer_id,
          senderName: sender?.name ?? "自分",
          message: createdMessage.message,
          createdAt: createdMessage.created_at,
          isMine: true,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("チャットメッセージAPIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}