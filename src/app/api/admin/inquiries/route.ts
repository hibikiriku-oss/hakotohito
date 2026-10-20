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
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const requestedStatus = searchParams.get("status") ?? "all";

    const allowedStatuses = [
      "all",
      "open",
      "in_progress",
      "resolved",
    ];

    if (!allowedStatuses.includes(requestedStatus)) {
      return NextResponse.json(
        { error: "指定された対応状況が不正です。" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("inquiries")
      .select(`
        id,
        user_id,
        category,
        subject,
        message,
        status,
        admin_reply,
        replied_by_user_id,
        replied_at,
        created_at,
        updated_at,
        users!inquiries_user_id_fkey (
          display_name,
          user_type
        )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (requestedStatus !== "all") {
      query = query.eq("status", requestedStatus);
    }

    const { data, error } = await query;

    if (error) {
      console.error("問い合わせ一覧取得エラー:", error.message);

      return NextResponse.json(
        { error: "問い合わせ一覧を取得できませんでした。" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      inquiries: data ?? [],
    });
  } catch (error) {
    console.error("管理者問い合わせAPIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました。" },
      { status: 500 }
    );
  }
}