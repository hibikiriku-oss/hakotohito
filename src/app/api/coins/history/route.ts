import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    const { data: transactions, error } = await supabase
      .from("coin_transactions")
      .select(
        "id, amount, transaction_type, description, balance_after, created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("コイン履歴取得エラー:", error);

      return NextResponse.json(
        { error: "コイン履歴の取得に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      transactions: transactions ?? [],
    });
  } catch (error) {
    console.error("コイン履歴APIエラー:", error);

    return NextResponse.json(
      { error: "コイン履歴の取得に失敗しました" },
      { status: 500 }
    );
  }
}