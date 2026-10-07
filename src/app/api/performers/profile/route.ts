import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ========================================
// 演奏者プロフィール取得
// ========================================
export async function GET(
  request: NextRequest
) {
  try {
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error:
            "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    // LINEユーザー取得
    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        {
          error:
            "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 演奏者プロフィール取得
    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select(
        "id, user_id, name, instruments, genres, area, bio"
      )
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error(
        "演奏者プロフィール取得エラー:",
        performerError
      );

      return NextResponse.json(
        {
          error:
            "演奏者プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      performer,
    });

  } catch (error) {
    console.error(
      "プロフィール取得APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}

// ========================================
// 演奏者プロフィール更新
// ========================================
export async function PATCH(
  request: NextRequest
) {
  try {
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error:
            "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    const body = await request.json();

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const area =
      typeof body.area === "string"
        ? body.area.trim()
        : "";

    const bio =
      typeof body.bio === "string"
        ? body.bio.trim()
        : "";

    const instruments = Array.isArray(
      body.instruments
    )
      ? body.instruments
          .filter(
            (item: unknown) =>
              typeof item === "string"
          )
          .map((item: string) =>
            item.trim()
          )
          .filter(Boolean)
      : [];

    const genres = Array.isArray(
      body.genres
    )
      ? body.genres
          .filter(
            (item: unknown) =>
              typeof item === "string"
          )
          .map((item: string) =>
            item.trim()
          )
          .filter(Boolean)
      : [];

    if (
      !name ||
      !area ||
      instruments.length === 0 ||
      genres.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "必須項目を入力してください",
        },
        { status: 400 }
      );
    }

    // LINEユーザー取得
    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        {
          error:
            "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // このLINEユーザーの演奏者プロフィールを取得
    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error(
        "演奏者プロフィール取得エラー:",
        performerError
      );

      return NextResponse.json(
        {
          error:
            "演奏者プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // プロフィール更新
    const {
      data: updatedPerformer,
      error: updateError,
    } = await supabase
      .from("performers")
      .update({
        name,
        area,
        instruments,
        genres,
        bio,
      })
      .eq("id", performer.id)
      .select(
        "id, user_id, name, instruments, genres, area, bio"
      )
      .single();

    if (updateError) {
      console.error(
        "プロフィール更新エラー:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "プロフィールの更新に失敗しました",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      performer: updatedPerformer,
    });

  } catch (error) {
    console.error(
      "プロフィール更新APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}
