import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: NO_STORE_HEADERS }
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return auth.response;
    }

    const { data, error } = await supabase
      .from("admin_announcements")
      .select("id, message, is_active, updated_at, updated_by_line_user_id")
      .eq("id", 1)
      .single();

    if (error || !data) {
      console.error("Announcement GET error:", error);
      return jsonError("お知らせを取得できませんでした。", 500);
    }

    return NextResponse.json(
      { announcement: data },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Announcement GET exception:", error);
    return jsonError("サーバーエラーが発生しました。", 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return auth.response;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("送信データを読み取れませんでした。", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("送信データの形式が正しくありません。", 400);
    }

    const input = body as Record<string, unknown>;

    if (typeof input.message !== "string") {
      return jsonError("お知らせ本文を入力してください。", 400);
    }

    const message = input.message.trim();

    if (message.length > 500) {
      return jsonError("お知らせは500文字以内で入力してください。", 400);
    }

    if (typeof input.isActive !== "boolean") {
      return jsonError("公開状態を指定してください。", 400);
    }

    // 空欄の場合は必ず非公開にする
    const isActive = input.isActive && message.length > 0;

    const { data, error } = await supabase
      .from("admin_announcements")
      .update({
        message,
        is_active: isActive,
        updated_at: new Date().toISOString(),
        updated_by_line_user_id: auth.userId,
      })
      .eq("id", 1)
      .select("id, message, is_active, updated_at, updated_by_line_user_id")
      .single();

    if (error || !data) {
      console.error("Announcement PUT error:", error);
      return jsonError("お知らせを保存できませんでした。", 500);
    }

    return NextResponse.json(
      {
        success: true,
        announcement: data,
        message: isActive
          ? "お知らせを保存して公開しました。"
          : "お知らせを保存し、非公開にしました。",
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("Announcement PUT exception:", error);
    return jsonError("サーバーエラーが発生しました。", 500);
  }
}