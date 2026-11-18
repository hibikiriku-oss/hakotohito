import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase configuration missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "決済事故IDが不正です。" }, { status: 400, headers: noStore });
    }
    const body = await request.json().catch(() => null) as { actionType?: unknown; note?: unknown } | null;
    const actionType = body?.actionType;
    const note = body?.note;
    if (actionType !== "under_review" && actionType !== "resolved" && actionType !== "dismissed") {
      return NextResponse.json({ error: "操作内容が不正です。" }, { status: 400, headers: noStore });
    }
    if (typeof note !== "string" || note.trim().length < 1 || note.trim().length > 2000) {
      return NextResponse.json({ error: "対応記録は1〜2000文字で入力してください。" }, { status: 400, headers: noStore });
    }

    const { data, error } = await dbAdmin().rpc("manage_stripe_payment_incident", {
      p_incident_id: id,
      p_admin_line_user_id: auth.userId,
      p_action: actionType,
      p_note: note.trim(),
    });
    if (error || !data?.success) {
      console.error("Stripe incident update error:", error?.message ?? data?.errorMessage ?? "UnknownError");
      return NextResponse.json({ error: data?.errorMessage || "決済事故の対応記録を保存できませんでした。" }, { status: 409, headers: noStore });
    }
    return NextResponse.json({ success: true, result: data }, { headers: noStore });
  } catch (error) {
    console.error("Stripe incident PATCH error:", error instanceof Error ? error.name : "UNKNOWN");
    return NextResponse.json({ error: "決済事故の対応記録を保存できませんでした。" }, { status: 500, headers: noStore });
  }
}
