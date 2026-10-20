import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      idToken,
      displayName,
      pictureUrl,
      userType,
    } = body;

    if (
      typeof idToken !== "string" ||
      !idToken ||
      typeof userType !== "string"
    ) {
      return NextResponse.json(
        { error: "必要な情報がありません" },
        { status: 400 }
      );
    }

    if (
      userType !== "performer" &&
      userType !== "facility"
    ) {
      return NextResponse.json(
        { error: "ユーザー種別が不正です" },
        { status: 400 }
      );
    }

    // LINE公式の検証APIでIDトークンを検証する
    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
        { status: 401 }
      );
    }

    // クライアントが送信したlineUserIdではなく、
    // 検証済みトークンから取得したユーザーIDを使用する
    const { data, error } = await supabase
      .from("users")
      .upsert(
        {
          line_user_id: verified.userId,
          display_name:
            typeof displayName === "string"
              ? displayName
              : "",
          picture_url:
            typeof pictureUrl === "string"
              ? pictureUrl
              : null,
          user_type: userType,
        },
        {
          onConflict: "line_user_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error("ユーザー登録DBエラー:", error.message);

      return NextResponse.json(
        { error: "ユーザー登録に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({ user: data });
  } catch (error) {
    console.error("ユーザー登録APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}