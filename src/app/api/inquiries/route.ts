import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_CATEGORIES = [
  "bug",
  "account",
  "coins",
  "suggestion",
  "other",
] as const;

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

function isObjectBody(
  body: unknown
): body is Record<string, unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body)
  );
}

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim() ?? "";

    if (!idToken) {
      return jsonResponse(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        401
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return jsonResponse(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        401
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (userError) {
      console.error("問い合わせ履歴のユーザー取得エラー:", {
        code: userError.code,
      });

      return jsonResponse(
        { error: "ユーザー情報を取得できませんでした。" },
        500
      );
    }

    if (!user) {
      return jsonResponse(
        {
          error: "ユーザー登録が見つかりません。先に登録してください。",
        },
        403
      );
    }

    const { data, error } = await supabase
      .from("inquiries")
      .select(
        "id, category, subject, message, status, admin_reply, replied_at, created_at, updated_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("問い合わせ履歴取得エラー:", {
        code: error.code,
      });

      return jsonResponse(
        { error: "問い合わせ履歴を取得できませんでした。" },
        500
      );
    }

    return jsonResponse({
      inquiries: data ?? [],
    });
  } catch (error) {
    console.error(
      "問い合わせ履歴APIエラー:",
      error instanceof Error ? error.name : "UNKNOWN"
    );

    return jsonResponse(
      { error: "サーバーエラーが発生しました。" },
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "リクエストのJSON形式が正しくありません。" },
        400
      );
    }

    if (!isObjectBody(body)) {
      return jsonResponse(
        { error: "リクエスト内容が正しくありません。" },
        400
      );
    }

    const idToken =
      typeof body.idToken === "string" ? body.idToken.trim() : "";
    const category =
      typeof body.category === "string" ? body.category : "";
    const subject =
      typeof body.subject === "string" ? body.subject.trim() : "";
    const message =
      typeof body.message === "string" ? body.message.trim() : "";

    if (!idToken) {
      return jsonResponse(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        401
      );
    }

    if (
      !ALLOWED_CATEGORIES.includes(
        category as (typeof ALLOWED_CATEGORIES)[number]
      ) ||
      subject.length < 1 ||
      subject.length > 100 ||
      message.length < 1 ||
      message.length > 5000
    ) {
      return jsonResponse(
        {
          error: "カテゴリ・件名・問い合わせ内容を確認してください。",
        },
        400
      );
    }

    // LINE公式の検証APIで本人確認
    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return jsonResponse(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        401
      );
    }

    // 検証済みのLINEユーザーIDからDB上のユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (userError) {
      console.error("問い合わせユーザー取得エラー:", {
        code: userError.code,
      });

      return jsonResponse(
        { error: "ユーザー情報を取得できませんでした。" },
        500
      );
    }

    if (!user) {
      return jsonResponse(
        {
          error: "ユーザー登録が見つかりません。先にホーム画面から登録してください。",
        },
        403
      );
    }

    const { data: inquiry, error: insertError } = await supabase
      .from("inquiries")
      .insert({
        user_id: user.id,
        category,
        subject,
        message,
      })
      .select("id, category, subject, message, status, created_at")
      .single();

    if (insertError) {
      console.error("問い合わせ保存エラー:", {
        code: insertError.code,
      });

      return jsonResponse(
        { error: "問い合わせを保存できませんでした。" },
        500
      );
    }

    return jsonResponse(
      {
        success: true,
        inquiry,
      },
      201
    );
  } catch (error) {
    console.error(
      "問い合わせ送信APIエラー:",
      error instanceof Error ? error.name : "UNKNOWN"
    );

    return jsonResponse(
      { error: "サーバーエラーが発生しました。" },
      500
    );
  }
}