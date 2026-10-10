import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function getAuthorizedMatch(
  request: NextRequest,
  matchId: string
) {
  const lineUserId =
    request.headers.get("x-line-user-id");

  if (!lineUserId) {
    return {
      error: NextResponse.json(
        {
          error: "LINEユーザーIDが指定されていません",
        },
        { status: 400 }
      ),
    };
  }

  const {
    data: currentUser,
    error: currentUserError,
  } =
    await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

  if (currentUserError || !currentUser) {
    return {
      error: NextResponse.json(
        {
          error: "ユーザーが見つかりません",
        },
        { status: 404 }
      ),
    };
  }

  /*
   * まずマッチング本体を取得
   */
  const {
    data: match,
    error: matchError,
  } = await supabase
    .from("matches")
    .select(
      `
      id,
      status,
      performance_status,
      performer_id,
      request_id
      `
    )
    .eq("id", matchId)
    .single();

  if (matchError || !match) {
    console.error(
      "マッチング取得エラー:",
      matchError
    );

    return {
      error: NextResponse.json(
        {
          error: "マッチングが見つかりません",
        },
        { status: 404 }
      ),
    };
  }

  /*
   * マッチング状態を確認
   */
  if (match.status !== "active") {
    return {
      error: NextResponse.json(
        {
          error:
            "このマッチングではチャットを利用できません",
        },
        { status: 403 }
      ),
    };
  }

  if (
    match.performance_status ===
    "cancelled"
  ) {
    return {
      error: NextResponse.json(
        {
          error:
            "キャンセルされたマッチングではチャットを利用できません",
        },
        { status: 403 }
      ),
    };
  }

  /*
   * 演奏者のuser_idを取得
   */
  const {
    data: performer,
    error: performerError,
  } = await supabase
    .from("performers")
    .select("user_id")
    .eq("id", match.performer_id)
    .single();

  if (performerError || !performer) {
    console.error(
      "演奏者取得エラー:",
      performerError
    );

    return {
      error: NextResponse.json(
        {
          error: "演奏者情報が見つかりません",
        },
        { status: 404 }
      ),
    };
  }

  /*
   * 演奏依頼から施設IDを取得
   */
  const {
    data: performanceRequest,
    error: requestError,
  } = await supabase
    .from("performance_requests")
    .select("facility_id")
    .eq("id", match.request_id)
    .single();

  if (
    requestError ||
    !performanceRequest
  ) {
    console.error(
      "演奏依頼取得エラー:",
      requestError
    );

    return {
      error: NextResponse.json(
        {
          error: "演奏依頼が見つかりません",
        },
        { status: 404 }
      ),
    };
  }

  /*
   * 施設のuser_idを取得
   */
  const {
    data: facility,
    error: facilityError,
  } = await supabase
    .from("facilities")
    .select("user_id")
    .eq(
      "id",
      performanceRequest.facility_id
    )
    .single();

  if (facilityError || !facility) {
    console.error(
      "施設取得エラー:",
      facilityError
    );

    return {
      error: NextResponse.json(
        {
          error: "施設情報が見つかりません",
        },
        { status: 404 }
      ),
    };
  }

  /*
   * マッチング当事者か確認
   */
  const isPerformer =
    currentUser.id === performer.user_id;

  const isFacility =
    currentUser.id === facility.user_id;

  if (!isPerformer && !isFacility) {
    return {
      error: NextResponse.json(
        {
          error:
            "このチャットを利用する権限がありません",
        },
        { status: 403 }
      ),
    };
  }

  return {
    currentUser,
    match,
  };
}

async function getOrCreateConversation(
  matchId: string
) {
  const {
    data: existingConversation,
    error: existingError,
  } = await supabase
    .from("conversations")
    .select(
      "id, match_id, created_at"
    )
    .eq("match_id", matchId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingConversation) {
    return existingConversation;
  }

  const {
    data: newConversation,
    error: createError,
  } = await supabase
    .from("conversations")
    .insert({
      match_id: matchId,
    })
    .select(
      "id, match_id, created_at"
    )
    .single();

  if (createError) {
    /*
     * 同時アクセスで別のリクエストが
     * conversationを先に作成した場合に備えて、
     * もう一度取得する。
     */
    const {
      data: retryConversation,
      error: retryError,
    } = await supabase
      .from("conversations")
      .select(
        "id, match_id, created_at"
      )
      .eq("match_id", matchId)
      .single();

    if (
      retryError ||
      !retryConversation
    ) {
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
    const { id: matchId } =
      await context.params;

    const authorization =
      await getAuthorizedMatch(
        request,
        matchId
      );

    if (authorization.error) {
      return authorization.error;
    }

    const { currentUser } =
      authorization;

    const conversation =
      await getOrCreateConversation(
        matchId
      );

    /*
     * 自分以外のメッセージを既読にする
     */
    const { error: readError } =
      await supabase
        .from("messages")
        .update({
          read_at:
            new Date().toISOString(),
        })
        .eq(
          "conversation_id",
          conversation.id
        )
        .neq(
          "sender_id",
          currentUser.id
        )
        .is("read_at", null);

    if (readError) {
      console.error(
        "既読更新エラー:",
        readError
      );
    }

    const {
      data: messages,
      error: messagesError,
    } =
      await supabase
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
        .eq(
          "conversation_id",
          conversation.id
        )
        .order("created_at", {
          ascending: true,
        });

    if (messagesError) {
      console.error(
        "メッセージ取得エラー:",
        messagesError
      );

      return NextResponse.json(
        {
          error:
            "メッセージの取得に失敗しました",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      conversation,
      currentUserId: currentUser.id,
      messages: messages ?? [],
    });
  } catch (error) {
    console.error(
      "チャット取得APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "チャット情報の取得中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id: matchId } =
      await context.params;

    const authorization =
      await getAuthorizedMatch(
        request,
        matchId
      );

    if (authorization.error) {
      return authorization.error;
    }

    const { currentUser } =
      authorization;

    const body =
      await request.json();

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    if (!message) {
      return NextResponse.json(
        {
          error:
            "メッセージを入力してください",
        },
        { status: 400 }
      );
    }

    if (message.length > 1000) {
      return NextResponse.json(
        {
          error:
            "メッセージは1000文字以内で入力してください",
        },
        { status: 400 }
      );
    }

    const conversation =
      await getOrCreateConversation(
        matchId
      );

    const {
      data: newMessage,
      error: messageError,
    } =
      await supabase
        .from("messages")
        .insert({
          conversation_id:
            conversation.id,
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
      console.error(
        "メッセージ送信エラー:",
        messageError
      );

      return NextResponse.json(
        {
          error:
            "メッセージの送信に失敗しました",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: newMessage,
    });
  } catch (error) {
    console.error(
      "チャット送信APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "メッセージ送信中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}