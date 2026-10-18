import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { success: false, error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    const { id: lessonOfferId } = await context.params;

    // URLの募集IDがUUID形式か確認
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(lessonOfferId)) {
      return NextResponse.json(
        { success: false, error: "レッスン募集IDが正しくありません" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    if (message.length > 1000) {
      return NextResponse.json(
        { success: false, error: "メッセージは1000文字以内で入力してください" },
        { status: 400 }
      );
    }

    // LINEユーザーIDからアカウントを特定
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    if (userError) {
      console.error("レッスン申し込み：ユーザー取得エラー", userError);

      return NextResponse.json(
        { success: false, error: "ユーザー情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { success: false, error: "ユーザー登録が見つかりません" },
        { status: 404 }
      );
    }

    // 申し込む本人の演奏者プロフィールを特定
    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (performerError) {
      console.error(
        "レッスン申し込み：演奏者取得エラー",
        performerError
      );

      return NextResponse.json(
        { success: false, error: "演奏者プロフィールの取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!performer) {
      return NextResponse.json(
        {
          success: false,
          error: "演奏者プロフィールが見つかりません。先に演奏者登録をしてください。",
        },
        { status: 404 }
      );
    }

    // DB関数内で募集状態・定員・重複・本人申し込みを確認し、
    // 募集者の仮押さえコインから成立手数料を精算する
    const { data, error } = await supabase.rpc(
      "apply_to_lesson_offer",
      {
        p_lesson_offer_id: lessonOfferId,
        p_applicant_performer_id: performer.id,
        p_message: message || null,
      }
    );

    if (error) {
      console.error("レッスン申し込みRPCエラー:", error);

      return NextResponse.json(
        {
          success: false,
          error: "レッスンの申し込み処理に失敗しました。時間をおいて再度お試しください。",
        },
        { status: 500 }
      );
    }

    if (!data || data.success !== true) {
      const errorMessage =
        typeof data?.error === "string"
          ? data.error
          : typeof data?.message === "string"
            ? data.message
            : "レッスンに申し込めませんでした";

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          message: errorMessage,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      application_id: data.application_id,
      coins_charged: data.coins_charged ?? 0,
      balance_after: data.balance_after,
      lesson_fee: data.lesson_fee,
      message:
        data.message || "レッスンの申し込みが成立しました",
    });
  } catch (error) {
    console.error("レッスン申し込みAPIエラー:", error);

    return NextResponse.json(
      {
        success: false,
        error: "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}