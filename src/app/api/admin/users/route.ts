import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
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
    // LINE IDトークンを検証し、管理者本人か確認
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      auth.response.headers.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
      );
      auth.response.headers.set("Pragma", "no-cache");
      auth.response.headers.set("Expires", "0");
      return auth.response;
    }

    const searchParams = request.nextUrl.searchParams;
    const keyword = (searchParams.get("q") ?? "").trim();

    if (keyword.length > 100) {
      return jsonResponse(
        { error: "検索キーワードは100文字以内で入力してください" },
        400
      );
    }

    let query = supabase
      .from("users")
      .select("id, display_name, user_type, coin_balance, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (keyword) {
      // LIKE検索用の特殊文字をエスケープ
      const escapedKeyword = keyword.replace(/[\\%_(),]/g, "\\$&");

      query = query.ilike("display_name", `%${escapedKeyword}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("管理者ユーザー検索エラー:", {
        code: error.code,
      });

      return jsonResponse(
        { error: "ユーザー検索に失敗しました" },
        500
      );
    }

    return jsonResponse({
      users: (data ?? []).map((user) => ({
        id: user.id,
        displayName: user.display_name ?? "",
        userType: user.user_type ?? "",
        coinBalance: user.coin_balance ?? 0,
        createdAt: user.created_at,
      })),
    });
  } catch (error) {
    console.error("管理者ユーザー検索APIエラー:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return jsonResponse(
      { error: "サーバーエラーが発生しました" },
      500
    );
  }
}