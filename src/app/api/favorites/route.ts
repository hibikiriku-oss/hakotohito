import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AuthResult =
  | { userId: string }
  | { response: NextResponse };

async function getAuthenticatedUser(
  request: NextRequest
): Promise<AuthResult> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();

  if (!idToken) {
    return {
      response: NextResponse.json(
        {
          error:
            "LINEの本人確認情報がありません。再ログインしてください。",
        },
        { status: 401 }
      ),
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      response: NextResponse.json(
        {
          error:
            "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        { status: 401 }
      ),
    };
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", verified.userId)
    .maybeSingle();

  if (userError) {
    console.error(
      "お気に入りAPIのユーザー取得エラー:",
      userError.message
    );

    return {
      response: NextResponse.json(
        { error: "ユーザー情報の取得に失敗しました" },
        { status: 500 }
      ),
    };
  }

  if (!user) {
    return {
      response: NextResponse.json(
        {
          error:
            "ユーザーが見つかりません。先にユーザー登録を行ってください。",
        },
        { status: 404 }
      ),
    };
  }

  return { userId: user.id };
}

function getTargetUserId(body: unknown): string | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("targetUserId" in body)
  ) {
    return null;
  }

  const targetUserId = body.targetUserId;

  if (
    typeof targetUserId !== "string" ||
    !targetUserId.trim()
  ) {
    return null;
  }

  return targetUserId.trim();
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);

    if ("response" in auth) {
      return auth.response;
    }

    const {
      data: favoriteRows,
      error: favoritesError,
    } = await supabase
      .from("favorites")
      .select("id, target_user_id, created_at")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false });

    if (favoritesError) {
      console.error(
        "お気に入り取得エラー:",
        favoritesError.message
      );

      return NextResponse.json(
        { error: "お気に入りの取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!favoriteRows || favoriteRows.length === 0) {
      return NextResponse.json({ favorites: [] });
    }

    const targetUserIds = favoriteRows.map(
      (favorite) => favorite.target_user_id
    );

    const {
      data: targetUsers,
      error: targetUsersError,
    } = await supabase
      .from("users")
      .select("id, display_name, picture_url, user_type")
      .in("id", targetUserIds);

    if (targetUsersError) {
      console.error(
        "お気に入り対象ユーザー取得エラー:",
        targetUsersError.message
      );

      return NextResponse.json(
        {
          error:
            "お気に入り対象ユーザーの取得に失敗しました",
        },
        { status: 500 }
      );
    }

    const {
      data: performers,
      error: performersError,
    } = await supabase
      .from("performers")
      .select("id, user_id, name, area, instruments, genres, bio")
      .in("user_id", targetUserIds);

    if (performersError) {
      console.error(
        "お気に入り演奏者取得エラー:",
        performersError.message
      );

      return NextResponse.json(
        {
          error:
            "お気に入り演奏者情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    const {
      data: facilities,
      error: facilitiesError,
    } = await supabase
      .from("facilities")
      .select(
        "id, user_id, name, facility_type, address, description"
      )
      .in("user_id", targetUserIds);

    if (facilitiesError) {
      console.error(
        "お気に入り施設取得エラー:",
        facilitiesError.message
      );

      return NextResponse.json(
        {
          error:
            "お気に入り施設情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    const favorites = favoriteRows.map((favorite) => {
      const targetUser =
        targetUsers?.find(
          (target) => target.id === favorite.target_user_id
        ) ?? null;

      const performer =
        performers?.find(
          (item) => item.user_id === favorite.target_user_id
        ) ?? null;

      const facility =
        facilities?.find(
          (item) => item.user_id === favorite.target_user_id
        ) ?? null;

      return {
        id: favorite.id,
        target_user_id: favorite.target_user_id,
        created_at: favorite.created_at,
        users: targetUser
          ? {
              id: targetUser.id,
              display_name: targetUser.display_name,
              picture_url: targetUser.picture_url,
              user_type: targetUser.user_type,
              performers: performer,
              facilities: facility,
            }
          : null,
      };
    });

    return NextResponse.json({ favorites });
  } catch (error) {
    console.error("お気に入りAPIエラー:", error);

    return NextResponse.json(
      {
        error:
          "お気に入り情報の取得中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);

    if ("response" in auth) {
      return auth.response;
    }

    const body: unknown = await request.json();
    const targetUserId = getTargetUserId(body);

    if (!targetUserId) {
      return NextResponse.json(
        {
          error:
            "お気に入り対象のユーザーIDが指定されていません",
        },
        { status: 400 }
      );
    }

    if (auth.userId === targetUserId) {
      return NextResponse.json(
        {
          error:
            "自分自身をお気に入りには登録できません",
        },
        { status: 400 }
      );
    }

    const {
      data: targetUser,
      error: targetUserError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("id", targetUserId)
      .maybeSingle();

    if (targetUserError) {
      console.error(
        "お気に入り対象ユーザー確認エラー:",
        targetUserError.message
      );

      return NextResponse.json(
        {
          error:
            "お気に入り対象ユーザーの確認に失敗しました",
        },
        { status: 500 }
      );
    }

    if (!targetUser) {
      return NextResponse.json(
        {
          error:
            "お気に入り対象のユーザーが見つかりません",
        },
        { status: 404 }
      );
    }

    const {
      data: favorite,
      error: favoriteError,
    } = await supabase
      .from("favorites")
      .insert({
        user_id: auth.userId,
        target_user_id: targetUserId,
      })
      .select("id, target_user_id, created_at")
      .single();

    if (favoriteError) {
      if (favoriteError.code === "23505") {
        return NextResponse.json(
          {
            error:
              "すでにお気に入り登録されています",
          },
          { status: 409 }
        );
      }

      console.error(
        "お気に入り登録エラー:",
        favoriteError.message
      );

      return NextResponse.json(
        { error: "お気に入り登録に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({ favorite });
  } catch (error) {
    console.error("お気に入り登録APIエラー:", error);

    return NextResponse.json(
      {
        error:
          "お気に入り登録中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);

    if ("response" in auth) {
      return auth.response;
    }

    const body: unknown = await request.json();
    const targetUserId = getTargetUserId(body);

    if (!targetUserId) {
      return NextResponse.json(
        {
          error:
            "お気に入り対象のユーザーIDが指定されていません",
        },
        { status: 400 }
      );
    }

    const { error: deleteError } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", auth.userId)
      .eq("target_user_id", targetUserId);

    if (deleteError) {
      console.error(
        "お気に入り解除エラー:",
        deleteError.message
      );

      return NextResponse.json(
        { error: "お気に入り解除に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("お気に入り解除APIエラー:", error);

    return NextResponse.json(
      {
        error:
          "お気に入り解除中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}