import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };
function dbAdmin() { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) throw new Error("Supabase configuration missing"); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]; const verified = token ? await verifyLineIdToken(token) : null;
    if (!verified) return NextResponse.json({ error: "認証が必要です。" }, { status: 401, headers: noStore });
    const sessionId = new URL(request.url).searchParams.get("session_id"); if (!sessionId || sessionId.length > 255) return NextResponse.json({ error: "Session IDが不正です。" }, { status: 400, headers: noStore });
    const db = dbAdmin(); const { data: user, error: userError } = await db.from("users").select("id").eq("line_user_id", verified.userId).eq("account_status", "active")
    .maybeSingle();
    if (userError) throw userError; if (!user) return NextResponse.json({ error: "ユーザーが見つかりません。" }, { status: 404, headers: noStore });
    const { data: order, error } = await db.from("payment_orders").select("status,coin_amount,amount_jpy,currency,paid_at").eq("stripe_checkout_session_id", sessionId).eq("payer_user_id", user.id).eq("payment_type", "coin_purchase").maybeSingle();
    if (error) throw error; if (!order) return NextResponse.json({ error: "購入注文が見つかりません。" }, { status: 404, headers: noStore });
    return NextResponse.json({ status: order.status, coins: order.coin_amount, amountJpy: order.amount_jpy, paidAt: order.paid_at }, { headers: noStore });
  } catch (error) { console.error("Coin purchase status error:", error instanceof Error ? error.message : "UnknownError"); return NextResponse.json({ error: "購入状態を確認できませんでした。" }, { status: 500, headers: noStore }); }
}
