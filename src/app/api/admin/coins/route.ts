
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    // LINE IDトークンを検証し、管理者本人か確認
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      Object.entries(NO_STORE_HEADERS).forEach(([key, value]) => {
        auth.response.headers.set(key, value);
      });

      return auth.response;
    }

    // JSON形式を確認
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "リクエストのJSON形式が正しくありません" },
        400
      );
    }

    // null・配列・文字列などを拒否
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return jsonResponse(
        { error: "リクエスト内容が正しくありません" },
        400
      );
    }

    const data = body as Record<string, unknown>;

    const userId =
      typeof data.userId === "string" ? data.userId.trim() : "";
    const amount = data.amount;
    const description =
      typeof data.description === "string"
        ? data.description.trim()
        : "";
    const idempotencyKey =
      typeof data.idempotencyKey === "string"
        ? data.idempotencyKey.trim()
        : "";

    if (
      !UUID_REGEX.test(userId) ||
      !Number.isSafeInteger(amount) ||
      (amount as number) <= 0 ||
      (amount as number) > 1000000 ||
      !description ||
      description.length > 200 ||
      !idempotencyKey ||
      idempotencyKey.length > 200
    ) {
      return jsonResponse(
        { error: "付与先・付与コイン数・理由の入力を確認してください" },
        400
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Admin coin API: Supabase configuration is missing.");

      return jsonResponse(
        { error: "コイン付与処理に失敗しました" },
        500
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 認証済み管理者のDB上のユーザーIDを取得
    const { data: adminUser, error: adminError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", auth.userId)
      .maybeSingle();

    if (adminError) {
      console.error("Admin coin API: Admin lookup failed.", {
        code: adminError.code,
      });

      return jsonResponse(
        { error: "管理者情報を取得できませんでした" },
        500
      );
    }

    if (!adminUser) {
      return jsonResponse(
        { error: "管理者のユーザー登録が見つかりません" },
        403
      );
    }

    // 付与先が存在することを確認
    const { data: targetUser, error: targetError } = await supabase
      .from("users")
      .select("id, display_name, user_type")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) {
      console.error("Admin coin API: Target lookup failed.", {
        code: targetError.code,
      });

      return jsonResponse(
        { error: "付与先ユーザーを取得できませんでした" },
        500
      );
    }

    if (!targetUser) {
      return jsonResponse(
        { error: "指定されたユーザーが見つかりません" },
        404
      );
    }

    // 残高更新と取引履歴登録をDB関数内で一括処理
    const { data: result, error: grantError } = await supabase.rpc(
      "admin_grant_coins",
      {
        p_user_id: userId,
        p_amount: amount as number,
        p_description: description,
        p_created_by_user_id: adminUser.id,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (grantError) {
      console.error("Admin coin API: Grant operation failed.", {
        code: grantError.code,
      });

      return jsonResponse(
        { error: "コイン付与処理に失敗しました" },
        500
      );
    }

    const grantResult = Array.isArray(result) ? result[0] : null;

    if (!grantResult?.success) {
      return jsonResponse(
        {
          error:
            grantResult?.error_message ??
            "コイン付与処理に失敗しました",
        },
        400
      );
    }

    return jsonResponse({
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
    console.error("Admin coin API exception:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return jsonResponse(
      { error: "サーバーエラーが発生しました" },
      500
    );
  }
}
