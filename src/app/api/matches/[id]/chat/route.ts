import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

const PAGE_SIZE = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: NO_STORE_HEADERS }
  );
}

async function getAuthorizedMatch(
  request: NextRequest,
  matchId: string
) {
  const authorization =
    request.headers.get("authorization");

  const idToken =
    authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";

  if (!idToken) {
    return {
      error: jsonError(
        "LINEの本人確認情報がありません。再ログインしてください。",
        401
      ),
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      error: jsonError(
        "LINEの本人確認に失敗しました。再ログインしてください。",
        401
      ),
    };
  }

  const { data: currentUser, error: currentUserError } =
    await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .single();

  if (currentUserError || !currentUser) {
    return {
      error: jsonError("ユーザーが見つかりません", 404),
    };
  }

  const { data: match, error: matchError } =
    await supabase
      .from("matches")
      .select(
        `
        id,
        status,
        performance_status,
        performer_id,
        request_id,
        band_id
        `
      )
      .eq("id", matchId)
      .single();

  if (matchError || !match) {
    console.error("マッチング取得エラー:", matchError);

    return {
      error: jsonError("マッチングが見つかりません", 404),
    };
  }

  if (
    match.status !== "active" ||
    match.performance_status === "cancelled"
  ) {
    return {
      error: jsonError(
        "このマッチングではチャットを利用できません",
        403
      ),
    };
  }

  const { data: performer, error: performerError } =
    await supabase
      .from("performers")
      .select("user_id")
      .eq("id", match.performer_id)
      .single();

  if (performerError || !performer) {
    console.error("演奏者取得エラー:", performerError);

    return {
      error: jsonError("演奏者情報が見つかりません", 404),
    };
  }

  const { data: performanceRequest, error: requestError } =
    await supabase
      .from("performance_requests")
      .select("facility_id")
      .eq("id", match.request_id)
      .single();

  if (requestError || !performanceRequest) {
    console.error("演奏依頼取得エラー:", requestError);

    return {
      error: jsonError("演奏依頼が見つかりません", 404),
    };
  }

  const { data: facility, error: facilityError } =
    await supabase
      .from("facilities")
      .select("user_id")
      .eq("id", performanceRequest.facility_id)
      .single();

  if (facilityError || !facility) {
    console.error("施設取得エラー:", facilityError);

    return {
      error: jsonError("施設情報が見つかりません", 404),
    };
  }

  const isFacility =
    currentUser.id === facility.user_id;

  let isPerformer = false;

  if (match.band_id) {
    // バンドの場合は現在のアクティブなリーダーだけを許可する。
    const { data: leaders, error: leaderError } =
      await supabase
        .from("band_members")
        .select("performer_id")
        .eq("band_id", match.band_id)
        .eq("role", "leader")
        .eq("status", "active");

    if (leaderError) {
      console.error("バンドリーダー取得エラー:", leaderError);

      return {
        error: jsonError(
          "バンドの利用権限を確認できませんでした",
          500
        ),
      };
    }

    const leaderPerformerIds =
      (leaders ?? []).map((leader) => leader.performer_id);

    if (leaderPerformerIds.length > 0) {
      const { data: leaderUsers, error: leaderUserError } =
        await supabase
          .from("performers")
          .select("user_id")
          .in("id", leaderPerformerIds);

      if (leaderUserError) {
        console.error(
          "バンドリーダーユーザー取得エラー:",
          leaderUserError
        );

        return {
          error: jsonError(
            "バンドの利用権限を確認できませんでした",
            500
          ),
        };
      }

      isPerformer = (leaderUsers ?? []).some(
        (leader) => leader.user_id === currentUser.id
      );
    }
  } else {
    isPerformer =
      currentUser.id === performer.user_id;
  }

  if (!isPerformer && !isFacility) {
    return {
      error: jsonError(
        "このチャットを利用する権限がありません",
        403
      ),
    };
  }

  return {
    currentUser,
    match,
  };
}

async function getOrCreateConversation(matchId: string) {
  const { data: existingConversation, error: existingError } =
    await supabase
      .from("conversations")
      .select("id, match_id, created_at")
      .eq("match_id", matchId)
      .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingConversation) {
    return existingConversation;
  }

  const { data: newConversation, error: createError } =
    await supabase
      .from("conversations")
      .insert({
        match_id: matchId,
      })
      .select("id, match_id, created_at")
      .single();

  if (createError) {
    const { data: retryConversation, error: retryError } =
      await supabase
        .from("conversations")
        .select("id, match_id, created_at")
        .eq("match_id", matchId)
        .single();

    if (retryError || !retryConversation) {
      throw createError;
    }

    return retryConversation;
  }

  return newConversation;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: matchId } = await context.params;

    if (!UUID_PATTERN.test(matchId)) {
      return jsonError("マッチングIDが正しくありません", 400);
    }

    const authorization = await getAuthorizedMatch(
      request,
      matchId
    );

    if (authorization.error) {
      return authorization.error;
    }

    const { currentUser } = authorization;

    const conversation =
      await getOrCreateConversation(matchId);

    const searchParams = request.nextUrl.searchParams;

    const isSummary =
      searchParams.get("summary") === "true";

    const beforeCreatedAt =
      searchParams.get("beforeCreatedAt");

    const beforeId =
      searchParams.get("beforeId");

    const hasCreatedAt = beforeCreatedAt !== null;
    const hasId = beforeId !== null;

    if (hasCreatedAt !== hasId) {
      return jsonError(
        "過去メッセージの取得条件が正しくありません",
        400
      );
    }

    if (isSummary && hasCreatedAt) {
      return jsonError(
        "未読件数取得と過去メッセージ取得は同時に指定できません",
        400
      );
    }

    let cursorCreatedAt: string | null = null;

    if (hasCreatedAt && hasId) {
      if (
        !UUID_PATTERN.test(beforeId!) ||
        !beforeCreatedAt ||
        !Number.isFinite(Date.parse(beforeCreatedAt))
      ) {
        return jsonError(
          "過去メッセージの取得条件が正しくありません",
          400
        );
      }

      cursorCreatedAt =
        new Date(beforeCreatedAt).toISOString();
    }

    if (isSummary) {
      const { count: unreadCount, error: unreadError } =
        await supabase
          .from("messages")
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("conversation_id", conversation.id)
          .neq("sender_id", currentUser.id)
          .is("read_at", null);

      if (unreadError) {
        console.error("未読件数取得エラー:", unreadError);

        return jsonError(
          "未読件数の取得に失敗しました",
          500
        );
      }

      return NextResponse.json(
        {
          conversation,
          currentUserId: currentUser.id,
          unreadCount: unreadCount ?? 0,
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const isOlderPage = cursorCreatedAt !== null;

    // 過去ページの取得では既読処理を行わない。
    if (!isOlderPage) {
      const { error: readError } =
        await supabase
          .from("messages")
          .update({
            read_at: new Date().toISOString(),
          })
          .eq("conversation_id", conversation.id)
          .neq("sender_id", currentUser.id)
          .is("read_at", null);

      if (readError) {
        console.error("既読更新エラー:", readError);
      }
    }

    let messagesQuery = supabase
      .from("messages")
      .select(
        `
        id,
        conversation_id,
        sender_id,
        message,
        read_at,
        created_at,
        users (
          id,
          display_name,
          picture_url
        )
        `
      )
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (isOlderPage) {
      // 日時が同じ場合もUUIDで順序を確定し、取りこぼしを防ぐ。
      messagesQuery = messagesQuery.or(
        `created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${beforeId})`
      );
    }

    const { data: fetchedMessages, error: messagesError } =
      await messagesQuery;

    if (messagesError) {
      console.error("メッセージ取得エラー:", messagesError);

      return jsonError(
        "メッセージの取得に失敗しました",
        500
      );
    }

    const rows = fetchedMessages ?? [];
    const hasMore = rows.length > PAGE_SIZE;

    const pageMessages = rows
      .slice(0, PAGE_SIZE)
      .reverse();

    return NextResponse.json(
      {
        conversation,
        currentUserId: currentUser.id,
        messages: pageMessages,
        hasMore,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("チャット取得APIエラー:", error);

    return jsonError(
      "チャット情報の取得中にエラーが発生しました",
      500
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: matchId } = await context.params;

    if (!UUID_PATTERN.test(matchId)) {
      return jsonError("マッチングIDが正しくありません", 400);
    }

    const authorization = await getAuthorizedMatch(
      request,
      matchId
    );

    if (authorization.error) {
      return authorization.error;
    }

    const { currentUser } = authorization;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError(
        "送信データの形式が正しくありません",
        400
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError(
        "送信データの形式が正しくありません",
        400
      );
    }

    const input = body as Record<string, unknown>;

    const message =
      typeof input.message === "string"
        ? input.message.trim()
        : "";

    if (!message) {
      return jsonError(
        "メッセージを入力してください",
        400
      );
    }

    if (message.length > 1000) {
      return jsonError(
        "メッセージは1000文字以内で入力してください",
        400
      );
    }

    const conversation =
      await getOrCreateConversation(matchId);

    const { data: newMessage, error: messageError } =
      await supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          sender_id: currentUser.id,
          message,
        })
        .select(
          `
          id,
          conversation_id,
          sender_id,
          message,
          read_at,
          created_at,
          users (
            id,
            display_name,
            picture_url
          )
          `
        )
        .single();

    if (messageError) {
      console.error("メッセージ送信エラー:", messageError);

      return jsonError(
        "メッセージの送信に失敗しました",
        500
      );
    }

    return NextResponse.json(
      {
        message: newMessage,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("チャット送信APIエラー:", error);

    return jsonError(
      "メッセージ送信中にエラーが発生しました",
      500
    );
  }
}