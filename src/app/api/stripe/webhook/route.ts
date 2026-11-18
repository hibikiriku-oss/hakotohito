import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripeObject = Record<string, unknown>;
type StripeEvent = { id: string; type: string; created: number; data?: { object?: StripeObject } };
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };

function verifySignature(rawBody: string, header: string, secret: string): boolean {
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  return signatures.some((signature) => {
    try {
      if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
      const actual = Buffer.from(signature, "hex");
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch { return false; }
  });
}

function dbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase configuration missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function saveWebhookState(
  db: SupabaseClient,
  eventId: string,
  processingToken: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await db.from("stripe_webhook_events")
    .update(patch)
    .eq("stripe_event_id", eventId)
    .eq("processing_token", processingToken)
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error("Webhook event state update failed or processing lease was lost");
  }
}

function asObject(value: unknown): StripeObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as StripeObject : null;
}
function stripeId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  const object = asObject(value);
  return typeof object?.id === "string" && object.id.length > 0 ? object.id : null;
}
function metadataString(object: StripeObject, key: string): string | null {
  const metadata = asObject(object.metadata);
  return typeof metadata?.[key] === "string" ? metadata[key] as string : null;
}
function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function stripeGet<T extends StripeObject>(path: string): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Stripe API error (${response.status})`);
  return payload;
}

async function resolvePaymentIntentId(object: StripeObject): Promise<string | null> {
  const direct = stripeId(object.payment_intent);
  if (direct) return direct;
  const chargeId = stripeId(object.charge) || (typeof object.object === "string" && object.object === "charge" ? stripeId(object.id) : null);
  if (!chargeId) return null;
  const charge = await stripeGet<StripeObject>(`charges/${encodeURIComponent(chargeId)}`);
  return stripeId(charge.payment_intent);
}

async function resolvePaymentOrderId(object: StripeObject, paymentIntentId: string | null): Promise<string | null> {
  const directOrderId = metadataString(object, "payment_order_id");
  if (directOrderId) return directOrderId;
  if (!paymentIntentId) return null;
  const paymentIntent = await stripeGet<StripeObject>(`payment_intents/${encodeURIComponent(paymentIntentId)}`);
  return metadataString(paymentIntent, "payment_order_id");
}

async function recordPaymentIncident(
  db: SupabaseClient,
  event: StripeEvent,
  processingToken: string,
  incidentObject: StripeObject,
  incidentType: string,
  paymentIntentId: string | null,
  resolvedOrderId: string | null,
): Promise<boolean> {
  if (!Number.isSafeInteger(event.created) || event.created < 0) {
    throw new Error("Stripe event creation timestamp is missing or invalid");
  }

  const actualAmount = positiveInteger(incidentObject.amount_refunded)
    ?? positiveInteger(incidentObject.amount)
    ?? positiveInteger(incidentObject.amount_disputed);
  const currency = typeof incidentObject.currency === "string"
    ? incidentObject.currency.toLowerCase()
    : null;
  const { data, error } = await db.rpc("record_stripe_payment_incident_ordered", {
    p_order_id: resolvedOrderId,
    p_payment_intent_id: paymentIntentId,
    p_processing_event_id: event.id,
    p_processing_token: processingToken,
    p_event_created: event.created,
    p_event_type: event.type,
    p_incident_type: incidentType,
    p_actual_amount: actualAmount,
    p_actual_currency: currency,
    p_object_id: typeof incidentObject.id === "string" ? incidentObject.id : null,
    p_object_status: typeof incidentObject.status === "string" ? incidentObject.status : null,
    p_reason: typeof incidentObject.reason === "string" ? incidentObject.reason : null,
  });
  if (error) throw new Error("決済事故の原子的な記録に失敗しました。");
  if (data?.legacyOrderingUnknown) {
    throw new Error("既存の決済事故にStripeイベント順序情報がありません。管理者による照合が必要です。");
  }
  if (data?.staleLease) throw new Error("Webhookの処理リースが失効しました。");
  if (data?.ambiguousOrdering) throw new Error("同一秒に異なるStripeイベントが存在するため、順序を確定できません。管理者による照合が必要です。");
  if (!data?.success) {
    if (data?.notFound) return false;
    throw new Error(data?.errorMessage || "決済事故を記録できませんでした。");
  }
  return data.recorded === true;
}

async function processRefundOrDispute(db: SupabaseClient, event: StripeEvent, processingToken: string, object: StripeObject): Promise<boolean> {
  const paymentIntentId = await resolvePaymentIntentId(object);
  const orderId = await resolvePaymentOrderId(object, paymentIntentId);
  if (event.type === "charge.refunded") {
    const chargeId = typeof object.id === "string" ? object.id : "unknown_charge";
    const refunds = asObject(object.refunds);
    const refundData = Array.isArray(refunds?.data) ? refunds.data.map(asObject).filter((item): item is StripeObject => Boolean(item)) : [];
    let recorded = await recordPaymentIncident(db, event, processingToken, object, `charge_refunded:${chargeId}`, paymentIntentId, orderId);
    if (refundData.length === 0) return recorded;
    for (const refund of refundData) {
      const refundId = typeof refund.id === "string" ? refund.id : `unknown_${chargeId}`;
      recorded = await recordPaymentIncident(db, event, processingToken, { ...refund, currency: refund.currency ?? object.currency }, `refund:${refundId}`, paymentIntentId, orderId) || recorded;
    }
    return recorded;
  }

  if (event.type.startsWith("refund.")) {
    const refundId = typeof object.id === "string" ? object.id : event.id;
    return recordPaymentIncident(db, event, processingToken, object, `refund:${refundId}`, paymentIntentId, orderId);
  }

  const disputeId = typeof object.id === "string" ? object.id : event.id;
  return recordPaymentIncident(db, event, processingToken, object, `dispute:${disputeId}`, paymentIntentId, orderId);
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = request.headers.get("stripe-signature");
    if (!secret || !signature) return NextResponse.json({ error: "Webhook configuration missing" }, { status: 400, headers: noStore });
    const rawBody = await request.text();
    if (!verifySignature(rawBody, signature, secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400, headers: noStore });
    let event: StripeEvent;
    try { event = JSON.parse(rawBody) as StripeEvent; }
    catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: noStore }); }
    if (!event?.id || typeof event.id !== "string" || typeof event.type !== "string" || !Number.isSafeInteger(event.created) || event.created < 0) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400, headers: noStore });
    }

    const db = dbAdmin();
    const { data: claim, error: claimError } = await db.rpc("claim_stripe_webhook_event", {
      p_stripe_event_id: event.id,
      p_event_type: event.type,
    });
    if (claimError) {
      console.error("Stripe webhook claim error:", claimError.message);
      return NextResponse.json({ error: "Webhook event could not be claimed" }, { status: 500, headers: noStore });
    }
    if (!claim?.claimed) {
      if (claim?.duplicate) {
        return NextResponse.json({ received: true, duplicate: true }, { headers: noStore });
      }
      if (claim?.inProgress) {
        return NextResponse.json({ error: "Webhook event is already being processed" }, { status: 409, headers: noStore });
      }
      return NextResponse.json({ error: claim?.errorMessage || "Webhook event could not be claimed" }, { status: 500, headers: noStore });
    }
    const processingToken = typeof claim.processingToken === "string" ? claim.processingToken : null;
    if (!processingToken) {
      return NextResponse.json({ error: "Webhook processing token is missing" }, { status: 500, headers: noStore });
    }

    try {
      const object = event.data?.object ?? {};
      const checkoutTypes = [
        "checkout.session.completed", "checkout.session.async_payment_succeeded",
        "checkout.session.expired", "checkout.session.async_payment_failed",
      ];
      const incidentTypes = [
        "charge.refunded", "refund.created", "refund.updated", "refund.failed",
        "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
        "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
      ];

      if (checkoutTypes.includes(event.type)) {
        const paymentType = metadataString(object, "payment_type");
        if (paymentType !== "coin_purchase") {
          await saveWebhookState(db, event.id, processingToken, {
            processing_status: "ignored", processed_at: new Date().toISOString(), error_message: null,
          });
          return NextResponse.json({ received: true, ignored: true }, { headers: noStore });
        }

        const paymentOrderId = metadataString(object, "payment_order_id");
        if (!paymentOrderId) throw new Error("Coin purchase order ID is missing");
        if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
          const sessionId = typeof object.id === "string" ? object.id : "";
          const paymentIntent = stripeId(object.payment_intent);
          const paymentStatus = object.payment_status;
          if (!sessionId) throw new Error("Checkout Session ID is missing");
          if (paymentStatus !== "paid") {
            if (event.type === "checkout.session.completed" && paymentStatus === "unpaid") {
              await saveWebhookState(db, event.id, processingToken, {
                processing_status: "processed", processed_at: new Date().toISOString(), error_message: null,
              });
              return NextResponse.json({ received: true, pending: true }, { headers: noStore });
            }
            throw new Error("Checkout Session is not marked paid");
          }
          if (!paymentIntent) throw new Error("Payment Intent ID is missing for a paid Checkout Session");
          const { error: sessionError } = await db.from("payment_orders")
            .update({ stripe_checkout_session_id: sessionId, updated_at: new Date().toISOString() })
            .eq("id", paymentOrderId).eq("payment_type", "coin_purchase").eq("status", "pending")
            .is("stripe_checkout_session_id", null);
          if (sessionError) throw new Error("Checkout Session ID recovery failed");
          const amountTotal = positiveInteger(object.amount_total);
          const currency = typeof object.currency === "string" ? object.currency : "";
          if (!amountTotal || currency.toLowerCase() !== "jpy") throw new Error("Invalid paid amount or currency");
          const { data, error } = await db.rpc("complete_stripe_coin_purchase", {
            p_order_id: paymentOrderId, p_checkout_session_id: sessionId,
            p_payment_intent_id: paymentIntent, p_paid_amount: amountTotal, p_currency: currency,
          });
          if (error || !data?.success) throw new Error(data?.errorMessage || error?.message || "Coin purchase fulfillment failed");
        } else {
          const nextStatus = event.type === "checkout.session.expired" ? "cancelled" : "failed";
          const { error } = await db.from("payment_orders").update({ status: nextStatus, updated_at: new Date().toISOString() })
            .eq("id", paymentOrderId).eq("payment_type", "coin_purchase").eq("status", "pending");
          if (error) throw new Error("Failed to update unpaid coin order");
        }
      } else if (incidentTypes.includes(event.type)) {
        const recorded = await processRefundOrDispute(db, event, processingToken, object);
        await saveWebhookState(db, event.id, processingToken, {
          processing_status: recorded ? "processed" : "ignored",
          processed_at: new Date().toISOString(), error_message: null,
        });
        return NextResponse.json({ received: true, incidentRecorded: recorded, ignored: !recorded }, { headers: noStore });
      } else {
        await saveWebhookState(db, event.id, processingToken, {
          processing_status: "ignored", processed_at: new Date().toISOString(), error_message: null,
        });
        return NextResponse.json({ received: true, ignored: true }, { headers: noStore });
      }

      await saveWebhookState(db, event.id, processingToken, {
        processing_status: "processed", processed_at: new Date().toISOString(), error_message: null,
      });
      return NextResponse.json({ received: true }, { headers: noStore });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook processing error";
      try {
        await saveWebhookState(db, event.id, processingToken, {
          processing_status: "failed", error_message: message.slice(0, 500),
        });
      } catch (stateError) {
        console.error("Stripe webhook failure state could not be saved:", stateError instanceof Error ? stateError.message : "UnknownError");
      }
      console.error("Stripe webhook processing failed:", message);
      return NextResponse.json({ error: "Webhook processing failed" }, { status: 500, headers: noStore });
    }
  } catch (error) {
    console.error("Stripe webhook infrastructure error:", error instanceof Error ? error.message : "UnknownError");
    return NextResponse.json({ error: "Webhook infrastructure failure" }, { status: 500, headers: noStore });
  }
}
