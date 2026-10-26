import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = match?.[1]?.trim();

    if (!idToken) {
      return NextResponse.json(
        {
          error:
            "LINEの本人確認情報がありません。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        {
          error:
            "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, user_type, coin_balance")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (userError) {
      console.error("コイン残高取得エラー:", userError.message);

      return NextResponse.json(
        { error: "コイン残高の取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      coinBalance: user.coin_balance ?? 0,
      userType: user.user_type,
    });
  } catch (error) {
    console.error("コイン残高APIエラー:", error);

    return NextResponse.json(
      { error: "コイン残高の取得に失敗しました" },
      { status: 500 }
    );
  }
}