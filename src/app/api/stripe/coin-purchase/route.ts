import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { getAppBaseUrl, stripeGet, stripeRequest, StripeRequestError } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PURCHASE_JPY = 315000;
// Stripe may prune idempotency keys after 24 hours. Refuse automatic recovery
// before that boundary when a Session ID was never persisted.
const MAX_SESSION_RECOVERY_AGE_MS = 20 * 60 * 60 * 1000;
const TERMS_VERSION = "coin-purchase-2026-11-23-v1";
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };
function stripeReady() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL));
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CheckoutSession = Record<string, unknown> & { id?: string; url?: string | null };
type PurchaseOrder = {
  id: string;
  status: string;
  coin_amount: number;
  coin_rate_yen: number;
  amount_jpy: number;
  stripe_checkout_session_id: string | null;
  stripe_checkout_url: string | null;
  created_at: string;
};

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
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("id,user_type,account_status")
    .eq("line_user_id", verified.userId)
    .maybeSingle();
  if (error || !data || data.account_status !== "active") return null;
  return { ...data, lineUserId: verified.userId };
}

async function getPurchaseSettings() {
  const db = supabaseAdmin();
  const [{ data: flags, error: flagsError }, { data: rate, error: rateError }] = await Promise.all([
    db.from("payment_feature_settings").select("coin_purchase_enabled").eq("id", 1).maybeSingle(),
    db.from("coin_rate_settings").select("coin_purchase_yen_per_coin").eq("id", 1).maybeSingle(),
  ]);
  if (flagsError || rateError || !flags || !rate) throw new Error("購入設定を取得できません。");
  const yenPerCoin = Number(rate.coin_purchase_yen_per_coin);
  if (!Number.isSafeInteger(yenPerCoin) || yenPerCoin < 1 || yenPerCoin > 100000) {
    throw new Error("購入レートの設定が正しくありません。");
  }
  return { enabled: flags.coin_purchase_enabled === true, yenPerCoin };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ error: "認証が必要です。" }, { status: 401, headers: noStore });
    const settings = await getPurchaseSettings();
    return NextResponse.json({
      enabled: settings.enabled && stripeReady(),
      yenPerCoin: settings.yenPerCoin,
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

    const settings = await getPurchaseSettings();
    if (!settings.enabled || !stripeReady()) {
      return NextResponse.json({ error: "コイン購入は現在利用できません。" }, { status: 403, headers: noStore });
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) {
      return NextResponse.json({ error: "購入内容が正しくありません。" }, { status: 400, headers: noStore });
    }
    const coins = body.coins;
    const requestKey = body.requestKey;
    if (!Number.isSafeInteger(coins) || (coins as number) < 1 || !Number.isSafeInteger((coins as number) * settings.yenPerCoin)) {
      return NextResponse.json({ error: "購入コイン数を正しく入力してください。" }, { status: 400, headers: noStore });
    }
    const requestedAmountJpy = (coins as number) * settings.yenPerCoin;
    if (requestedAmountJpy < 1 || requestedAmountJpy > MAX_PURCHASE_JPY) {
      return NextResponse.json({ error: `1回の購入金額は${MAX_PURCHASE_JPY.toLocaleString("ja-JP")}円以内にしてください。` }, { status: 400, headers: noStore });
    }
    if (typeof requestKey !== "string" || !UUID_PATTERN.test(requestKey)) {
      return NextResponse.json({ error: "購入リクエストIDが正しくありません。画面を再読み込みしてください。" }, { status: 400, headers: noStore });
    }
    if (body.termsAccepted !== true || body.termsVersion !== TERMS_VERSION) {
      return NextResponse.json({ error: "最新のコイン購入条件を確認して同意してください。" }, { status: 400, headers: noStore });
    }

    const db = supabaseAdmin();
    const orderColumns = "id,status,coin_amount,coin_rate_yen,amount_jpy,stripe_checkout_session_id,stripe_checkout_url,created_at";
    let order: PurchaseOrder | null = null;
    let reusedPendingOrder = false;

    // One pending coin-purchase order per user is enforced by migration 011.
    // Reuse it across reloads/tabs instead of creating a second payable Session.
    const { data: pending, error: pendingError } = await db.from("payment_orders")
      .select(orderColumns)
      .eq("payer_user_id", user.id).eq("payment_type", "coin_purchase").eq("status", "pending")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (pendingError) throw new Error("未完了の購入注文を確認できませんでした。");

    if (pending) {
      order = pending as PurchaseOrder;
      reusedPendingOrder = true;
      if (order.stripe_checkout_session_id) {
        const session = await stripeGet<CheckoutSession>(`checkout/sessions/${encodeURIComponent(order.stripe_checkout_session_id)}`);
        if (session.status === "open" && typeof session.url === "string" && session.url.startsWith("https://checkout.stripe.com/")) {
          return NextResponse.json({
            url: session.url, orderId: order.id, resumed: true,
            coins: order.coin_amount, amountJpy: order.amount_jpy, coinRateYen: order.coin_rate_yen,
          }, { headers: noStore });
        }
        if (session.status === "complete") {
          return NextResponse.json({ error: "この決済は完了または確認処理中です。残高への反映をお待ちください。" }, { status: 409, headers: noStore });
        }
        if (session.status !== "expired") {
          return NextResponse.json({ error: "既存の決済状態を確認できませんでした。時間をおいて再試行してください。" }, { status: 409, headers: noStore });
        }
        const { data: expired, error: expireError } = await db.from("payment_orders")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", order.id).eq("status", "pending").select("id").maybeSingle();
        if (expireError) throw new Error("期限切れ注文を更新できませんでした。");
        if (!expired) return NextResponse.json({ error: "決済状態が更新されました。画面を再読み込みしてください。" }, { status: 409, headers: noStore });
        order = null;
      }
    }

    if (!order) {
      const { data: sameRequest, error: requestError } = await db.from("payment_orders")
        .select(orderColumns).eq("payer_user_id", user.id).eq("request_key", requestKey)
        .eq("payment_type", "coin_purchase").maybeSingle();
      if (requestError) throw new Error("購入リクエストを確認できませんでした。");
      if (sameRequest && sameRequest.status !== "pending") {
        return NextResponse.json({ error: "この購入リクエストは既に終了しています。もう一度画面を開いてください。" }, { status: 409, headers: noStore });
      }
      if (sameRequest) {
        order = sameRequest as PurchaseOrder;
      } else {
        const { data: created, error: createError } = await db.from("payment_orders").insert({
          payment_type: "coin_purchase", payer_user_id: user.id,
          amount_jpy: requestedAmountJpy, currency: "jpy", coin_amount: coins,
          coin_rate_yen: settings.yenPerCoin, status: "pending", request_key: requestKey,
          description: `Hakotohitoコイン ${coins}コイン購入`,
          metadata: {
            terms_version: TERMS_VERSION, terms_accepted: true,
            terms_accepted_at: new Date().toISOString(), payer_line_user_id: user.lineUserId,
          },
        }).select(orderColumns).single();
        if (createError || !created) {
          // Another tab/request may have won the single-pending-order race.
          const { data: raced, error: raceError } = await db.from("payment_orders")
            .select(orderColumns).eq("payer_user_id", user.id)
            .eq("payment_type", "coin_purchase").eq("status", "pending")
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (raceError || !raced) throw new Error("購入注文を作成できませんでした。");
          order = raced as PurchaseOrder;
          reusedPendingOrder = true;
        } else {
          order = created as PurchaseOrder;
        }
      }
    }

    if (!order) throw new Error("購入注文を確定できませんでした。");
    // An existing order's amount and rate are immutable. Never recompute them
    // from the current admin rate when recovering a Checkout Session.
    if (order.status !== "pending") {
      return NextResponse.json({ error: "この購入注文は決済可能な状態ではありません。画面を再読み込みしてください。" }, { status: 409, headers: noStore });
    }
    if (reusedPendingOrder && !order.stripe_checkout_session_id) {
      const createdAt = Date.parse(order.created_at);
      const ageMs = Date.now() - createdAt;
      if (!Number.isFinite(createdAt) || ageMs < 0 || ageMs >= MAX_SESSION_RECOVERY_AGE_MS) {
        // The original Stripe request may have succeeded while its Session ID
        // failed to persist. Once Stripe's idempotency retention window may
        // have elapsed, never create another Session automatically.
        return NextResponse.json({
          error: "決済Sessionの保存状況を確認できない注文があります。二重決済防止のため自動再開を停止しました。管理者へお問い合わせください。",
        }, { status: 409, headers: noStore });
      }
    }

    const baseUrl = getAppBaseUrl();
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("payment_method_types[0]", "card");
    params.set("line_items[0][price_data][currency]", "jpy");
    params.set("line_items[0][price_data][unit_amount]", String(order.amount_jpy));
    params.set("line_items[0][price_data][product_data][name]", "Hakotohito コイン購入");
    params.set("line_items[0][price_data][product_data][description]", `${order.coin_amount}コイン`);
    params.set("line_items[0][quantity]", "1");
    params.set("client_reference_id", order.id);
    params.set("success_url", `${baseUrl}/coins/purchase/complete?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${baseUrl}/coins/purchase?cancelled=1`);
    params.set("metadata[payment_type]", "coin_purchase");
    params.set("metadata[payment_order_id]", order.id);
    params.set("metadata[payer_user_id]", user.id);
    params.set("metadata[coin_amount]", String(order.coin_amount));
    params.set("metadata[terms_version]", TERMS_VERSION);
    params.set("payment_intent_data[metadata][payment_type]", "coin_purchase");
    params.set("payment_intent_data[metadata][payment_order_id]", order.id);
    params.set("payment_intent_data[metadata][payer_user_id]", user.id);
    params.set("payment_intent_data[metadata][coin_amount]", String(order.coin_amount));

    const session = await stripeRequest<CheckoutSession>("checkout/sessions", params, `hakotohito_coin_purchase_${order.id}`);
    if (typeof session.id !== "string" || typeof session.url !== "string" || !session.url.startsWith("https://checkout.stripe.com/")) {
      throw new Error("Stripeから有効なCheckout Sessionが返されませんでした。");
    }
    const { data: saved, error: saveError } = await db.from("payment_orders")
      .update({ stripe_checkout_session_id: session.id, stripe_checkout_url: session.url, updated_at: new Date().toISOString() })
      .eq("id", order.id).eq("status", "pending").select("id").maybeSingle();
    if (saveError || !saved) {
      throw new Error("Checkout Sessionを注文に保存できませんでした。再試行してください。");
    }
    return NextResponse.json({
      url: session.url, orderId: order.id, resumed: reusedPendingOrder,
      ...(reusedPendingOrder ? { coins: order.coin_amount, amountJpy: order.amount_jpy, coinRateYen: order.coin_rate_yen } : {}),
    }, { headers: noStore });
  } catch (error) {
    const message = error instanceof StripeRequestError
      ? `Stripe決済を開始できませんでした（${error.status}）。`
      : error instanceof Error ? error.message : "UnknownError";
    console.error("Stripe coin purchase error:", message);
    return NextResponse.json({ error: "コイン購入を開始できませんでした。時間をおいて再試行してください。" }, { status: 500, headers: noStore });
  }
}
