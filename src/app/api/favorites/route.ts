import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザーIDが指定されていません",
        },
        { status: 400 }
      );
    }

    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "ユーザーが見つかりません",
        },
        { status: 404 }
      );
    }

    // まず、お気に入り情報だけを取得する
    const {
      data: favoriteRows,
      error: favoritesError,
    } = await supabase
      .from("favorites")
      .select(
        `
        id,
        target_user_id,
        created_at
        `
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });

    if (favoritesError) {
      console.error(
        "お気に入り取得エラー:",
        favoritesError
      );

      return NextResponse.json(
        {
          error: "お気に入りの取得に失敗しました",
        },
        { status: 500 }
      );
    }

    if (!favoriteRows || favoriteRows.length === 0) {
      return NextResponse.json({
        favorites: [],
      });
    }

    const targetUserIds = favoriteRows.map(
      (favorite) => favorite.target_user_id
    );

    // お気に入り対象のユーザー情報を取得する
    const {
      data: targetUsers,
      error: targetUsersError,
    } = await supabase
      .from("users")
      .select(
        `
        id,
        display_name,
        picture_url,
        user_type
        `
      )
      .in("id", targetUserIds);

    if (targetUsersError) {
      console.error(
        "お気に入り対象ユーザー取得エラー:",
        targetUsersError
      );

      return NextResponse.json(
        {
          error:
            "お気に入り対象ユーザーの取得に失敗しました",
        },
        { status: 500 }
      );
    }

    // 演奏者情報を user_id から直接取得する
    const {
      data: performers,
      error: performersError,
    } = await supabase
      .from("performers")
      .select(
        `
        id,
        user_id,
        name,
        area,
        instruments,
        genres,
        bio
        `
      )
      .in("user_id", targetUserIds);

    if (performersError) {
      console.error(
        "お気に入り演奏者取得エラー:",
        performersError
      );

      return NextResponse.json(
        {
          error:
            "お気に入り演奏者情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    // 施設情報も同様に user_id から直接取得する
    const {
      data: facilities,
      error: facilitiesError,
    } = await supabase
      .from("facilities")
      .select(
        `
        id,
        user_id,
        name,
        facility_type,
        address,
        description
        `
      )
      .in("user_id", targetUserIds);

    if (facilitiesError) {
      console.error(
        "お気に入り施設取得エラー:",
        facilitiesError
      );

      return NextResponse.json(
        {
          error:
            "お気に入り施設情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    // 取得した情報をフロントエンドが扱いやすい形にまとめる
    const favorites = favoriteRows.map(
      (favorite) => {
        const targetUser =
          targetUsers?.find(
            (target) =>
              target.id === favorite.target_user_id
          ) ?? null;

        const performer =
          performers?.find(
            (item) =>
              item.user_id ===
              favorite.target_user_id
          ) ?? null;

        const facility =
          facilities?.find(
            (item) =>
              item.user_id ===
              favorite.target_user_id
          ) ?? null;

        return {
          id: favorite.id,
          target_user_id:
            favorite.target_user_id,
          created_at: favorite.created_at,
          users: targetUser
            ? {
                id: targetUser.id,
                display_name:
                  targetUser.display_name,
                picture_url:
                  targetUser.picture_url,
                user_type:
                  targetUser.user_type,
                performers: performer,
                facilities: facility,
              }
            : null,
        };
      }
    );

    return NextResponse.json({
      favorites,
    });
  } catch (error) {
    console.error(
      "お気に入りAPIエラー:",
      error
    );

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
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザーIDが指定されていません",
        },
        { status: 400 }
      );
    }

    const body = await request.json();

    const targetUserId =
      body.targetUserId;

    if (!targetUserId) {
      return NextResponse.json(
        {
          error:
            "お気に入り対象のユーザーIDが指定されていません",
        },
        { status: 400 }
      );
    }

    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "ユーザーが見つかりません",
        },
        { status: 404 }
      );
    }

    if (user.id === targetUserId) {
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
      .single();

    if (targetUserError || !targetUser) {
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
        user_id: user.id,
        target_user_id: targetUserId,
      })
      .select(
        `
        id,
        target_user_id,
        created_at
        `
      )
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
        favoriteError
      );

      return NextResponse.json(
        {
          error: "お気に入り登録に失敗しました",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      favorite,
    });
  } catch (error) {
    console.error(
      "お気に入り登録APIエラー:",
      error
    );

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
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザーIDが指定されていません",
        },
        { status: 400 }
      );
    }

    const body = await request.json();

    const targetUserId =
      body.targetUserId;

    if (!targetUserId) {
      return NextResponse.json(
        {
          error:
            "お気に入り対象のユーザーIDが指定されていません",
        },
        { status: 400 }
      );
    }

    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "ユーザーが見つかりません",
        },
        { status: 404 }
      );
    }

    const { error: deleteError } =
      await supabase
        .from("favorites")
        .delete()
        .eq("user_id", user.id)
        .eq("target_user_id", targetUserId);

    if (deleteError) {
      console.error(
        "お気に入り解除エラー:",
        deleteError
      );

      return NextResponse.json(
        {
          error: "お気に入り解除に失敗しました",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "お気に入り解除APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "お気に入り解除中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}