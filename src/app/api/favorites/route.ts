import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AuthResult =
  | { userId: string; userType: string }
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
    .select("id, user_type")
    .eq("line_user_id", verified.userId)
    .eq("account_status", "active")
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

  return { userId: user.id, userType: user.user_type };
}

function getTargetEntityId(body: unknown, userType: string): string | null {
  const field = userType === "facility"
    ? "targetPerformerId"
    : userType === "performer"
      ? "targetFacilityId"
      : null;

  if (!field || typeof body !== "object" || body === null || !(field in body)) {
    return null;
  }

  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
      .select(
        "id, display_name, picture_url, user_type, avatar_type, avatar_emoji"
      )
      .in("id", targetUserIds)
      .eq("account_status", "active");

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
        "id, user_id, name, facility_type, description"
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

    if (auth.userType !== "facility" && auth.userType !== "performer") {
      return NextResponse.json(
        { error: "このアカウントではお気に入りを利用できません" },
        { status: 403 }
      );
    }

    const activeTargetUserIds = new Set(
      (targetUsers ?? []).map((target) => target.id)
    );
    const visibleFavoriteRows = favoriteRows.filter((favorite) =>
      activeTargetUserIds.has(favorite.target_user_id)
    );

    const favorites = visibleFavoriteRows.map((favorite) => {
      const targetUser =
        targetUsers?.find((target) => target.id === favorite.target_user_id) ?? null;
      const performer =
        performers?.find((item) => item.user_id === favorite.target_user_id) ?? null;
      const facility =
        facilities?.find((item) => item.user_id === favorite.target_user_id) ?? null;

      const publicUser = targetUser
        ? {
            display_name: targetUser.display_name,
            picture_url: targetUser.picture_url,
            user_type: targetUser.user_type,
            avatar_type: targetUser.avatar_type,
            avatar_emoji: targetUser.avatar_emoji,
            performers: auth.userType === "facility" && performer
              ? {
                  id: performer.id,
                  name: performer.name,
                  area: performer.area,
                  instruments: performer.instruments,
                  genres: performer.genres,
                  bio: performer.bio,
                }
              : null,
            facilities: auth.userType === "performer" && facility
              ? {
                  id: facility.id,
                  name: facility.name,
                  facility_type: facility.facility_type,
                  description: facility.description,
                }
              : null,
          }
        : null;

      return {
        id: favorite.id,
        ...(auth.userType === "facility"
          ? { target_performer_id: performer?.id ?? null }
          : { target_facility_id: facility?.id ?? null }),
        created_at: favorite.created_at,
        users: publicUser,
      };
    });

    return NextResponse.json(
      { favorites },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
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
    const targetEntityId = getTargetEntityId(body, auth.userType);

    if (!targetEntityId) {
      return NextResponse.json(
        { error: "お気に入り対象のプロフィールIDが指定されていません" },
        { status: 400 }
      );
    }

    if (auth.userType !== "facility" && auth.userType !== "performer") {
      return NextResponse.json(
        { error: "このアカウントではお気に入りを利用できません" },
        { status: 403 }
      );
    }

    let targetUserId: string | null = null;
    let targetProfileError: { message: string } | null = null;

    if (auth.userType === "facility") {
      const { data, error } = await supabase
        .from("performers")
        .select("user_id, users!inner(id)")
        .eq("id", targetEntityId)
        .eq("users.account_status", "active")
        .maybeSingle();
      targetUserId = data?.user_id ?? null;
      targetProfileError = error;
    } else {
      const { data, error } = await supabase
        .from("facilities")
        .select("user_id, users!inner(id)")
        .eq("id", targetEntityId)
        .eq("users.account_status", "active")
        .maybeSingle();
      targetUserId = data?.user_id ?? null;
      targetProfileError = error;
    }

    if (targetProfileError) {
      console.error("お気に入り対象ユーザー確認エラー:", targetProfileError.message);
      return NextResponse.json(
        { error: "お気に入り対象ユーザーの確認に失敗しました" },
        { status: 500 }
      );
    }

    if (!targetUserId) {
      return NextResponse.json(
        { error: "お気に入り対象のプロフィールが見つかりません" },
        { status: 404 }
      );
    }
    if (auth.userId === targetUserId) {
      return NextResponse.json(
        { error: "自分自身をお気に入りには登録できません" },
        { status: 400 }
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
      .select("id, created_at")
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

    return NextResponse.json({
      favorite: {
        id: favorite.id,
        ...(auth.userType === "facility"
          ? { target_performer_id: targetEntityId }
          : { target_facility_id: targetEntityId }),
        created_at: favorite.created_at,
      },
    });
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
    const targetEntityId = getTargetEntityId(body, auth.userType);

    if (!targetEntityId) {
      return NextResponse.json(
        { error: "お気に入り対象のプロフィールIDが指定されていません" },
        { status: 400 }
      );
    }

    if (auth.userType !== "facility" && auth.userType !== "performer") {
      return NextResponse.json(
        { error: "このアカウントではお気に入りを利用できません" },
        { status: 403 }
      );
    }

    let targetUserId: string | null = null;
    let targetProfileError: { message: string } | null = null;

    if (auth.userType === "facility") {
      const { data, error } = await supabase
        .from("performers")
        .select("user_id")
        .eq("id", targetEntityId)
        .maybeSingle();
      targetUserId = data?.user_id ?? null;
      targetProfileError = error;
    } else {
      const { data, error } = await supabase
        .from("facilities")
        .select("user_id")
        .eq("id", targetEntityId)
        .maybeSingle();
      targetUserId = data?.user_id ?? null;
      targetProfileError = error;
    }

    if (targetProfileError) {
      console.error("お気に入り対象プロフィール取得エラー:", targetProfileError.message);
      return NextResponse.json(
        { error: "お気に入り対象の確認に失敗しました" },
        { status: 500 }
      );
    }

    if (!targetUserId) {
      return NextResponse.json(
        { error: "お気に入り対象のプロフィールが見つかりません" },
        { status: 404 }
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