import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.response;
  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, picture_url, user_type, created_at")
    .eq("account_status", "pending_approval")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    console.error("承認待ちユーザー取得エラー:", { code: error.code });
    return NextResponse.json({ error: "承認待ちユーザーを取得できませんでした" }, { status: 500, headers });
  }
  return NextResponse.json({ users: data ?? [] }, { headers });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.response;
  const body = await request.json().catch(() => null);
  const userId = body && typeof body.userId === "string" ? body.userId.trim() : "";
  if (!uuidPattern.test(userId)) {
    return NextResponse.json({ error: "承認対象のユーザーIDが正しくありません" }, { status: 400, headers });
  }

  const { data: adminUser, error: adminError } = await supabase
    .from("users").select("id").eq("line_user_id", auth.userId).eq("account_status", "active").maybeSingle();
  if (adminError || !adminUser) {
    return NextResponse.json({ error: "管理者情報を取得できませんでした" }, { status: 403, headers });
  }

  const { data: approved, error } = await supabase
    .from("users")
    .update({
      account_status: "active",
      approved_at: new Date().toISOString(),
      approved_by_user_id: adminUser.id,
    })
    .eq("id", userId)
    .eq("account_status", "pending_approval")
    .select("id, display_name, user_type, account_status, approved_at")
    .maybeSingle();

  if (error) {
    console.error("ユーザー承認エラー:", { code: error.code });
    return NextResponse.json({ error: "ユーザー承認に失敗しました" }, { status: 500, headers });
  }
  if (!approved) {
    return NextResponse.json({ error: "承認待ちユーザーが見つからないか、既に処理されています" }, { status: 409, headers });
  }
  return NextResponse.json({ success: true, user: approved }, { headers });
}
