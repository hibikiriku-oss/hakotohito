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
function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL));
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.response;
  try {
    const { data, error } = await dbAdmin().from("payment_feature_settings")
      .select("coin_purchase_enabled").eq("id", 1).single();
    if (error || !data) return NextResponse.json({ error: "決済設定を取得できませんでした。" }, { status: 500, headers: noStore });
    return NextResponse.json({ settings: { coin_purchase_enabled: data.coin_purchase_enabled === true }, stripeConfigured: stripeConfigured() }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "決済設定を取得できませんでした。" }, { status: 500, headers: noStore });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) return auth.response;
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.coin_purchase_enabled !== "boolean") {
      return NextResponse.json({ error: "更新できる設定はコイン購入の有効・無効のみです。" }, { status: 400, headers: noStore });
    }
    if (body.coin_purchase_enabled && !stripeConfigured()) {
      return NextResponse.json({ error: "Stripe環境変数が不足しているため有効化できません。" }, { status: 400, headers: noStore });
    }
    const { data, error } = await dbAdmin().from("payment_feature_settings")
      .update({ coin_purchase_enabled: body.coin_purchase_enabled, updated_at: new Date().toISOString(), updated_by_line_user_id: auth.userId })
      .eq("id", 1).select("coin_purchase_enabled").single();
    if (error || !data) return NextResponse.json({ error: "決済設定を保存できませんでした。" }, { status: 500, headers: noStore });
    return NextResponse.json({ success: true, settings: { coin_purchase_enabled: data.coin_purchase_enabled === true } }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "決済設定を保存できませんでした。" }, { status: 500, headers: noStore });
  }
}
