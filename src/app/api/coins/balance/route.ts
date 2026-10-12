import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select(
        "id, user_type, coin_balance"
      )
      .eq(
        "line_user_id",
        lineUserId
      )
      .single();

    if (userError || !user) {
      console.error(
        "コイン残高取得ユーザーエラー:",
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

    return NextResponse.json({
      success: true,
      coinBalance:
        user.coin_balance ?? 0,
      userType:
        user.user_type,
    });
  } catch (error) {
    console.error(
      "コイン残高取得APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "コイン残高の取得に失敗しました",
      },
      { status: 500 }
    );
  }
}