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
      lineUserId,
      displayName,
      pictureUrl,
      userType,
    } = body;

    if (!lineUserId || !userType) {
      return NextResponse.json(
        {
          error: "必要な情報がありません",
        },
        { status: 400 }
      );
    }

    if (
      userType !== "performer" &&
      userType !== "facility"
    ) {
      return NextResponse.json(
        {
          error: "ユーザー種別が不正です",
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("users")
      .upsert(
        {
          line_user_id: lineUserId,
          display_name: displayName,
          picture_url: pictureUrl,
          user_type: userType,
        },
        {
          onConflict: "line_user_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error(error);

      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      user: data,
    });

  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "サーバーエラー",
      },
      { status: 500 }
    );
  }
}