import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const DEFAULT_RATES = {
  application_fee_coins: 10,
  direct_invitation_fee_coins: 100,
  match_fee_coins: 100,
  completion_fee_percent: 1,
  free_lesson_match_fee_coins: 5,
  paid_lesson_fee_percent: 1,
};

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Coin rate API: Supabase environment variables are missing.");

    return NextResponse.json(
      { error: "料金設定を取得できませんでした" },
      { status: 500 }
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
      [
        "application_fee_coins",
        "direct_invitation_fee_coins",
        "match_fee_coins",
        "completion_fee_percent",
        "free_lesson_match_fee_coins",
        "paid_lesson_fee_percent",
      ].join(",")
    )
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("Coin rate API: Failed to load settings.", error);

    return NextResponse.json(
      { error: "料金設定を取得できませんでした" },
      { status: 500 }
    );
  }

  const settings = data as unknown as
    | Partial<typeof DEFAULT_RATES>
    | null;

  const rates = {
    ...DEFAULT_RATES,
    ...(settings ?? {}),
  };

  return NextResponse.json(rates, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}