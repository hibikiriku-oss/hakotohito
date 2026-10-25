import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const FIXED_RATE_FIELDS = [
  "application_fee_coins",
  "direct_invitation_fee_coins",
  "match_fee_coins",
  "free_lesson_match_fee_coins",
] as const;

const PERCENT_RATE_FIELDS = [
  "completion_fee_percent",
  "paid_lesson_fee_percent",
] as const;

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

async function authorize(request: NextRequest) {
  return requireAdmin(request);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);

    if (!auth.authorized) {
      return auth.response;
    }

    const { data, error } = await supabase
      .from("coin_rate_settings")
      .select(
        [
          "id",
          "application_fee_coins",
          "direct_invitation_fee_coins",
          "match_fee_coins",
          "completion_fee_percent",
          "free_lesson_match_fee_coins",
          "paid_lesson_fee_percent",
          "updated_at",
          "updated_by_line_user_id",
        ].join(", ")
      )
      .eq("id", 1)
      .single();

    if (error || !data) {
      console.error("消費コイン設定取得エラー:", error);
      return jsonError("消費コイン設定を取得できませんでした。", 500);
    }

    return NextResponse.json(
      { rates: data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("消費コイン設定APIエラー:", error);
    return jsonError("サーバーエラーが発生しました。", 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authorize(request);

    if (!auth.authorized) {
      return auth.response;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("送信データの形式が正しくありません。", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("送信データの形式が正しくありません。", 400);
    }

    const input = body as Record<string, unknown>;
    const values: Record<string, number> = {};

    for (const field of FIXED_RATE_FIELDS) {
      const value = input[field];

      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > 1_000_000
      ) {
        return jsonError(
          `${field} は1〜1,000,000の整数で指定してください。`,
          400
        );
      }

      values[field] = value;
    }

    for (const field of PERCENT_RATE_FIELDS) {
      const value = input[field];

      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100 ||
        Math.round(value * 100) !== value * 100
      ) {
        return jsonError(
          `${field} は0〜100の範囲で小数第2位まで指定してください。`,
          400
        );
      }

      values[field] = value;
    }

    const { data, error } = await supabase
      .from("coin_rate_settings")
      .update({
        ...values,
        updated_at: new Date().toISOString(),
        updated_by_line_user_id: auth.userId,
      })
      .eq("id", 1)
      .select(
        [
          "id",
          "application_fee_coins",
          "direct_invitation_fee_coins",
          "match_fee_coins",
          "completion_fee_percent",
          "free_lesson_match_fee_coins",
          "paid_lesson_fee_percent",
          "updated_at",
          "updated_by_line_user_id",
        ].join(", ")
      )
      .single();

    if (error || !data) {
      console.error("消費コイン設定保存エラー:", error);
      return jsonError("消費コイン設定を保存できませんでした。", 500);
    }

    return NextResponse.json(
      {
        success: true,
        rates: data,
        message: "消費コイン設定を保存しました。",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("消費コイン設定保存APIエラー:", error);
    return jsonError("サーバーエラーが発生しました。", 500);
  }
}