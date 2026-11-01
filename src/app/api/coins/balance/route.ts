import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = match?.[1]?.trim() ?? "";

    if (!idToken) {
      return jsonResponse(
        {
          error:
            "LINEの本人確認情報がありません。再ログインしてください。",
        },
        401
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return jsonResponse(
        {
          error:
            "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        401
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, user_type, coin_balance")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (userError) {
      console.error(
        "コイン残高取得エラー:",
        userError.code ?? "UNKNOWN"
      );

      return jsonResponse(
        { error: "コイン残高の取得に失敗しました。" },
        500
      );
    }

    if (!user) {
      return jsonResponse(
        { error: "ユーザーが見つかりません。" },
        404
      );
    }

    return jsonResponse({
      success: true,
      coinBalance: user.coin_balance ?? 0,
      userType: user.user_type,
    });
  } catch (error) {
    console.error(
      "コイン残高APIエラー:",
      error instanceof Error ? error.name : "UNKNOWN"
    );

    return jsonResponse(
      { error: "コイン残高の取得に失敗しました。" },
      500
    );
  }
}