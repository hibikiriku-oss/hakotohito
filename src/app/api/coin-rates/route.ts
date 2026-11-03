
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_RATES = {
  application_fee_coins: 10,
  direct_invitation_fee_coins: 100,
  match_fee_coins: 100,
  completion_fee_percent: 1,
  free_lesson_match_fee_coins: 5,
  paid_lesson_fee_percent: 1,
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function validFixedRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 1_000_000
  );
}

function validPercentRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100 &&
    Math.round(value * 100) === value * 100
  );
}

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Coin rate API: Supabase configuration is missing.");

      return jsonResponse(
        { error: "料金設定を取得できませんでした" },
        500
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data, error } = await supabase
      .from("coin_rate_settings")
      .select(
        "application_fee_coins,direct_invitation_fee_coins,match_fee_coins,completion_fee_percent,free_lesson_match_fee_coins,paid_lesson_fee_percent"
      )
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.error("Coin rate API: Failed to load settings.", {
        code: error.code,
      });

      return jsonResponse(
        { error: "料金設定を取得できませんでした" },
        500
      );
    }

    const settings = data ?? DEFAULT_RATES;

    const rates = {
      application_fee_coins: validFixedRate(
        settings.application_fee_coins
      )
        ? settings.application_fee_coins
        : DEFAULT_RATES.application_fee_coins,

      direct_invitation_fee_coins: validFixedRate(
        settings.direct_invitation_fee_coins
      )
        ? settings.direct_invitation_fee_coins
        : DEFAULT_RATES.direct_invitation_fee_coins,

      match_fee_coins: validFixedRate(
        settings.match_fee_coins
      )
        ? settings.match_fee_coins
        : DEFAULT_RATES.match_fee_coins,

      completion_fee_percent: validPercentRate(
        settings.completion_fee_percent
      )
        ? settings.completion_fee_percent
        : DEFAULT_RATES.completion_fee_percent,

      free_lesson_match_fee_coins: validFixedRate(
        settings.free_lesson_match_fee_coins
      )
        ? settings.free_lesson_match_fee_coins
        : DEFAULT_RATES.free_lesson_match_fee_coins,

      paid_lesson_fee_percent: validPercentRate(
        settings.paid_lesson_fee_percent
      )
        ? settings.paid_lesson_fee_percent
        : DEFAULT_RATES.paid_lesson_fee_percent,
    };

    return jsonResponse(rates);
  } catch (error) {
    console.error("Coin rate API exception:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return jsonResponse(
      { error: "料金設定を取得できませんでした" },
      500
    );
  }
}
