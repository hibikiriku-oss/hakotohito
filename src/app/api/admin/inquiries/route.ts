import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
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

function applyNoStore(response: NextResponse) {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return applyNoStore(auth.response);
    }

    const { searchParams } = request.nextUrl;
    const requestedStatus = searchParams.get("status") ?? "all";

    const allowedStatuses = [
      "all",
      "open",
      "in_progress",
      "resolved",
    ];

    if (!allowedStatuses.includes(requestedStatus)) {
      return jsonResponse(
        { error: "指定された対応状況が不正です。" },
        400
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
      console.error("問い合わせ一覧取得エラー:", {
        code: error.code,
      });

      return jsonResponse(
        { error: "問い合わせ一覧を取得できませんでした。" },
        500
      );
    }

    return jsonResponse({
      inquiries: data ?? [],
    });
  } catch (error) {
    console.error("管理者問い合わせAPIエラー:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return jsonResponse(
      { error: "サーバーエラーが発生しました。" },
      500
    );
  }
}