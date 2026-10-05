import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      name,
      area,
      instruments,
      genres,
      bio,
    } = body;

    if (!name || !area || !instruments || !genres) {
      return NextResponse.json(
        {
          error: "必須項目が入力されていません",
        },
        { status: 400 }
      );
    }

    // 現在のユーザー情報を取得
    const lineUserId = request.headers.get(
      "x-line-user-id"
    );

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    // usersからLINEユーザーを検索
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        {
          error: "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // performersに登録
    const { data, error } = await supabase
      .from("performers")
      .upsert(
        {
          user_id: user.id,
          name,
          area,
          instruments,
          genres,
          bio,
        },
        {
          onConflict: "user_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error(
        "performer登録エラー:",
        error
      );

      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      performer: data,
    });

  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}