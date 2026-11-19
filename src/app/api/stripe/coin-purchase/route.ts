import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { getAppBaseUrl, stripeRequest, StripeRequestError } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_PURCHASE_JPY = 315000;
const TERMS_VERSION = "coin-purchase-2026-11-12-v1";
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };
function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabaseの設定がありません。");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function getUser(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const verified = await verifyLineIdToken(token);
  if (!verified) return null;
  const { data, error } = await supabaseAdmin().from("users").select("id,user_type,account_status").eq("line_user_id", verified.userId).maybeSingle();
  if (error || !data || data.account_status !== "active") return null;
  return { ...data, lineUserId: verified.userId };
}
export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ error: "認証が必要です。" }, { status: 401, headers: noStore });
    const db = supabaseAdmin();
    const [{ data: flags, error: flagsError }, { data: rate, error: rateError }] = await Promise.all([
      db.from("payment_feature_settings").select("coin_purchase_enabled").eq("id", 1).maybeSingle(),
      db.from("coin_rate_settings").select("coin_purchase_yen_per_coin").eq("id", 1).maybeSingle(),
    ]);
    if (flagsError || rateError) throw new Error("購入設定を取得できません。");
    // 限定公開中はDB設定や管理画面の状態にかかわらず購入を停止する。
    return NextResponse.json({
      enabled: false,
      yenPerCoin: Number(rate?.coin_purchase_yen_per_coin ?? 10),
      maxPurchaseYen: MAX_PURCHASE_JPY,
      termsVersion: TERMS_VERSION,
    }, { headers: noStore });
  } catch (error) {
    console.error("Stripe purchase config error:", error instanceof Error ? error.message : "UnknownError");
    return NextResponse.json({ error: "購入設定を取得できませんでした。" }, { status: 500, headers: noStore });
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ error: "認証が必要です。" }, { status: 401, headers: noStore });

    // 限定公開中は、DBフラグやStripe環境変数が有効でもCheckoutを作成しない。
    return NextResponse.json({ error: "コイン購入は現在停止しています。" }, { status: 403, headers: noStore });
  } catch (error) {
    console.error("Stripe coin purchase error:", error instanceof Error ? error.message : "UnknownError");
    return NextResponse.json({ error: "コイン購入を開始できませんでした。時間をおいて再試行してください。" }, { status: 500, headers: noStore });
  }
}
