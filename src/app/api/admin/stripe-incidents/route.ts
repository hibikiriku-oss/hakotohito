import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase configuration missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "all";
    const pageRaw = Number(params.get("page") ?? "1");
    const pageSizeRaw = Number(params.get("pageSize") ?? "25");
    if (!Number.isSafeInteger(pageRaw) || pageRaw < 1 || !Number.isSafeInteger(pageSizeRaw) || pageSizeRaw < 1 || pageSizeRaw > 100) {
      return NextResponse.json({ error: "ページ指定が不正です。" }, { status: 400, headers: noStore });
    }
    const page = pageRaw;
    const pageSize = pageSizeRaw;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const allowed = ["all", "open", "under_review", "resolved", "dismissed"];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: "対応状況が不正です。" }, { status: 400, headers: noStore });
    }

    let query = dbAdmin().from("stripe_payment_incidents").select(`
      id, payment_order_id, incident_type, stripe_payment_intent_id,
      amount_jpy, currency, details, resolution_status, created_at,
      resolved_at, resolved_by_line_user_id,
      payment_orders!inner ( id, payer_user_id, status, coin_amount, amount_jpy, created_at ),
      stripe_payment_incident_actions ( id, admin_line_user_id, action_type, note, created_at )
    `, { count: "exact" }).order("created_at", { ascending: false }).range(from, to)
      .order("created_at", { referencedTable: "stripe_payment_incident_actions", ascending: true });
    if (status === "open") query = query.eq("resolution_status", "open");
    else if (status !== "all") query = query.eq("resolution_status", status);

    const { data, error, count } = await query;
    if (error) {
      console.error("Stripe incident list error:", error.message);
      return NextResponse.json({ error: "決済事故一覧を取得できませんでした。" }, { status: 500, headers: noStore });
    }
    return NextResponse.json({ incidents: data ?? [], page, pageSize, total: count ?? 0, hasMore: from + (data?.length ?? 0) < (count ?? 0) }, { headers: noStore });
  } catch (error) {
    console.error("Stripe incident GET error:", error instanceof Error ? error.name : "UNKNOWN");
    return NextResponse.json({ error: "決済事故一覧を取得できませんでした。" }, { status: 500, headers: noStore });
  }
}
