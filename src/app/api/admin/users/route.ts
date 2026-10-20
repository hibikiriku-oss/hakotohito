import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // LINE IDトークンを検証し、管理者本人か確認
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return auth.response;
    }

    const searchParams = request.nextUrl.searchParams;
    const keyword = (searchParams.get("q") ?? "").trim();

    if (keyword.length > 100) {
      return NextResponse.json(
        { error: "検索キーワードは100文字以内で入力してください" },
        { status: 400 }
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
      console.error("管理者ユーザー検索エラー:", error.message);

      return NextResponse.json(
        { error: "ユーザー検索に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      users: (data ?? []).map((user) => ({
        id: user.id,
        displayName: user.display_name ?? "",
        userType: user.user_type ?? "",
        coinBalance: user.coin_balance ?? 0,
        createdAt: user.created_at,
      })),
    });
  } catch (error) {
    console.error("管理者ユーザー検索APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}