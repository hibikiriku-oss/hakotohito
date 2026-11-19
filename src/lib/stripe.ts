import "server-only";

export type StripeObject = Record<string, unknown>;

export class StripeRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "StripeRequestError";
  }
}

export async function stripeRequest<T extends StripeObject>(
  path: string,
  params: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY が設定されていません。");

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: params.toString(),
    cache: "no-store",
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new StripeRequestError(payload.error?.message || `Stripe API error (${response.status})`, response.status);
  }
  return payload;
}

export function getAppBaseUrl(): string {
  const value = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!value) throw new Error("APP_BASE_URL または NEXT_PUBLIC_APP_URL が必要です。");
  return value.replace(/\/$/, "");
}
