import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppBaseUrl, stripeRequest } from "@/lib/stripe";

export type MarketplacePaymentType = "session" | "lesson" | "performer_reward" | "event_participation" | "rental" | "other";
type CreateMarketplacePaymentInput = {
  db: SupabaseClient;
  paymentType: MarketplacePaymentType;
  payerUserId: string;
  payeeUserId: string;
  amountJpy: number;
  description: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

/** Call only after the owning feature has verified payer, recipient, amount, and reference. */
export async function createMarketplaceCheckoutSession(input: CreateMarketplacePaymentInput) {
  if (!Number.isSafeInteger(input.amountJpy) || input.amountJpy <= 0) throw new Error("決済金額が正しくありません。");
  if (input.payerUserId === input.payeeUserId) throw new Error("支払者と受取人を同一にできません。");
  const [{ data: settings }, { data: connected }] = await Promise.all([
    input.db.from("payment_feature_settings").select("*").eq("id", 1).single(),
    input.db.from("stripe_connected_accounts").select("stripe_account_id,details_submitted,payouts_enabled").eq("user_id", input.payeeUserId).maybeSingle(),
  ]);

  const featureEnabled =
    input.paymentType === "session"
      ? settings?.session_payment_enabled === true
      : input.paymentType === "lesson"
        ? settings?.lesson_payment_enabled === true
        : input.paymentType === "performer_reward"
          ? settings?.reward_payment_enabled === true
          : input.paymentType === "event_participation"
            ? settings?.event_payment_enabled === true
            : input.paymentType === "rental"
              ? settings?.rental_payment_enabled === true
              : settings?.other_payment_enabled === true;

  if (!featureEnabled) throw new Error("この支払い機能は現在停止しています。");
  if (!connected?.stripe_account_id || connected.details_submitted !== true || connected.payouts_enabled !== true) {
    throw new Error("受取人のStripe Connect登録が完了していません。");
  }

  const { data: order, error: insertError } = await input.db.from("payment_orders").insert({
    payment_type: input.paymentType,
    payer_user_id: input.payerUserId,
    payee_user_id: input.payeeUserId,
    amount_jpy: input.amountJpy,
    description: input.description.slice(0, 200),
    reference_type: input.referenceType ?? null,
    reference_id: input.referenceId ?? null,
    stripe_transfer_group: `hako_${crypto.randomUUID().replaceAll("-", "")}`,
    metadata: input.metadata ?? {},
  }).select("id,stripe_transfer_group").single();
  if (insertError || !order) throw new Error("決済注文を作成できませんでした。");

  let stripeSessionCreated = false;
  try {
    const baseUrl = getAppBaseUrl();
    const params = new URLSearchParams({
      mode: "payment",
      success_url: `${baseUrl}/payments/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/payments/cancelled?order_id=${order.id}`,
      client_reference_id: order.id,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "jpy",
      "line_items[0][price_data][unit_amount]": String(input.amountJpy),
      "line_items[0][price_data][product_data][name]": input.description.slice(0, 120),
      "metadata[payment_order_id]": order.id,
      "metadata[payment_type]": input.paymentType,
      "payment_intent_data[transfer_group]": order.stripe_transfer_group,
      "payment_intent_data[metadata][payment_order_id]": order.id,
    });
    const session = await stripeRequest<{ id: string; url?: string }>("checkout/sessions", params, `service-checkout:${order.id}`);
    stripeSessionCreated = true;
    if (!session.url) throw new Error("Stripeの決済URLを取得できませんでした。");
    const { error: updateError } = await input.db.from("payment_orders").update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq("id", order.id);
    if (updateError) throw new Error("Stripe決済情報を保存できませんでした。");
    return { orderId: order.id, checkoutUrl: session.url };
  } catch (error) {
    if (!stripeSessionCreated) {
      await input.db.from("payment_orders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", order.id).eq("status", "pending");
    }
    throw error;
  }
}

/** Call only after the service's completion/cancellation policy has authorized settlement. */
export async function transferPaidMarketplaceOrder(input: {
  db: SupabaseClient;
  orderId: string;
  transferAmountJpy: number;
}) {
  if (!Number.isSafeInteger(input.transferAmountJpy) || input.transferAmountJpy <= 0) throw new Error("送金額が正しくありません。");
  const { data: order, error } = await input.db.from("payment_orders").select("id,payment_type,payee_user_id,amount_jpy,status,stripe_transfer_group,stripe_transfer_id").eq("id", input.orderId).single();
  if (error || !order || order.payment_type === "coin_purchase") throw new Error("送金対象の注文が見つかりません。");
  if (order.status === "transferred" && order.stripe_transfer_id) return { transferId: order.stripe_transfer_id, alreadyTransferred: true };
  if (order.status !== "paid" || !order.payee_user_id || input.transferAmountJpy > order.amount_jpy) throw new Error("この注文は送金できない状態です。");
  const { data: connected } = await input.db.from("stripe_connected_accounts").select("stripe_account_id,payouts_enabled").eq("user_id", order.payee_user_id).single();
  if (!connected?.stripe_account_id || connected.payouts_enabled !== true) throw new Error("受取人のStripe Connect口座が送金可能ではありません。");
  const params = new URLSearchParams({
    amount: String(input.transferAmountJpy),
    currency: "jpy",
    destination: connected.stripe_account_id,
    transfer_group: String(order.stripe_transfer_group ?? `hako_${order.id}`),
    "metadata[payment_order_id]": order.id,
  });
  const transfer = await stripeRequest<{ id: string }>("transfers", params, `service-transfer:${order.id}`);
  const { error: updateError } = await input.db.from("payment_orders").update({
    status: "transferred",
    stripe_transfer_id: transfer.id,
    transfer_amount_jpy: input.transferAmountJpy,
    platform_fee_jpy: order.amount_jpy - input.transferAmountJpy,
    transferred_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", order.id).eq("status", "paid");
  if (updateError) throw new Error("送金結果をDBに保存できませんでした。Stripe側の送金IDを確認してください。");
  return { transferId: transfer.id, alreadyTransferred: false };
}
