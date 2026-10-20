import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    // LINE IDトークンを検証し、管理者本人か確認
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return auth.response;
    }

    const body = await request.json();

    const userId =
      typeof body.userId === "string" ? body.userId.trim() : "";
    const amount = body.amount;
    const description =
      typeof body.description === "string"
        ? body.description.trim()
        : "";
    const idempotencyKey =
      typeof body.idempotencyKey === "string"
        ? body.idempotencyKey.trim()
        : "";

    if (
      !userId ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > 1000000 ||
      !description ||
      description.length > 200 ||
      !idempotencyKey ||
      idempotencyKey.length > 200
    ) {
      return NextResponse.json(
        { error: "付与先・付与コイン数・理由の入力を確認してください" },
        { status: 400 }
      );
    }

    // 認証済み管理者のDB上のユーザーIDを取得
    const { data: adminUser, error: adminError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", auth.userId)
      .maybeSingle();

    if (adminError) {
      console.error("管理者ユーザー取得エラー:", adminError.message);

      return NextResponse.json(
        { error: "管理者情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!adminUser) {
      return NextResponse.json(
        { error: "管理者のユーザー登録が見つかりません" },
        { status: 403 }
      );
    }

    // 付与先が存在することを確認
    const { data: targetUser, error: targetError } = await supabase
      .from("users")
      .select("id, display_name, user_type, coin_balance")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) {
      console.error("付与先ユーザー取得エラー:", targetError.message);

      return NextResponse.json(
        { error: "付与先ユーザーを取得できませんでした" },
        { status: 500 }
      );
    }

    if (!targetUser) {
      return NextResponse.json(
        { error: "指定されたユーザーが見つかりません" },
        { status: 404 }
      );
    }

    // 残高更新と取引履歴登録をDB関数内で一括処理
    const { data: result, error: grantError } = await supabase.rpc(
      "admin_grant_coins",
      {
        p_user_id: userId,
        p_amount: amount,
        p_description: description,
        p_created_by_user_id: adminUser.id,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (grantError) {
      console.error("コイン付与DBエラー:", grantError.message);

      return NextResponse.json(
        { error: "コイン付与処理に失敗しました" },
        { status: 500 }
      );
    }

    const grantResult = Array.isArray(result) ? result[0] : null;

    if (!grantResult?.success) {
      return NextResponse.json(
        {
          error:
            grantResult?.error_message ??
            "コイン付与処理に失敗しました",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: targetUser.id,
        displayName: targetUser.display_name,
        userType: targetUser.user_type,
      },
      amount,
      balanceAfter: grantResult.balance_after,
      description,
    });
  } catch (error) {
    console.error("管理者コイン付与APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}