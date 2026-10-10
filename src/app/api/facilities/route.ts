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
      facilityType,
      address,
      description,
    } = body;

    // 必須項目チェック
    if (!name || !facilityType || !address) {
      return NextResponse.json(
        {
          error: "必須項目が入力されていません",
        },
        { status: 400 }
      );
    }

    // LINEユーザーID取得
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

    // usersテーブルからユーザー取得
    const { data: user, error: userError } =
      await supabase
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
          error: "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // facilitiesテーブルに登録
    const { data, error } = await supabase
      .from("facilities")
      .upsert(
        {
          user_id: user.id,
          name,
          facility_type: facilityType,
          address,
          description,
        },
        {
          onConflict: "user_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error(
        "施設登録エラー:",
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
      facility: data,
    });

  } catch (error) {
    console.error(
      "施設APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}