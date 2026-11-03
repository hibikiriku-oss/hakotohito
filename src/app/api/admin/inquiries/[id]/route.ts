import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
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

const ALLOWED_STATUSES = [
  "open",
  "in_progress",
  "resolved",
] as const;

type RouteContext = {
  params: Promise<{ id: string }>;
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

function applyNoStore(response: NextResponse) {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
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

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return applyNoStore(auth.response);
    }

    const { id } = await context.params;

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      )
    ) {
      return jsonResponse(
        { error: "問い合わせIDが不正です。" },
        400
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "送信データを読み取れませんでした。" },
        400
      );
    }

    if (!isObjectBody(body)) {
      return jsonResponse(
        { error: "送信データの形式が正しくありません。" },
        400
      );
    }

    const hasStatus = Object.prototype.hasOwnProperty.call(
      body,
      "status"
    );
    const hasReply = Object.prototype.hasOwnProperty.call(
      body,
      "adminReply"
    );

    if (!hasStatus && !hasReply) {
      return jsonResponse(
        { error: "更新する内容がありません。" },
        400
      );
    }

    const updates: {
      status?: (typeof ALLOWED_STATUSES)[number];
      admin_reply?: string | null;
      replied_by_user_id?: string | null;
      replied_at?: string | null;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
    };

    if (hasStatus) {
      if (
        typeof body.status !== "string" ||
        !ALLOWED_STATUSES.includes(
          body.status as (typeof ALLOWED_STATUSES)[number]
        )
      ) {
        return jsonResponse(
          { error: "対応状況が不正です。" },
          400
        );
      }

      updates.status = body.status as (typeof ALLOWED_STATUSES)[number];
    }

    if (hasReply) {
      if (
        body.adminReply !== null &&
        typeof body.adminReply !== "string"
      ) {
        return jsonResponse(
          { error: "返信内容が不正です。" },
          400
        );
      }

      const reply =
        typeof body.adminReply === "string"
          ? body.adminReply.trim()
          : "";

      if (reply.length > 5000) {
        return jsonResponse(
          { error: "返信は5000文字以内で入力してください。" },
          400
        );
      }

      if (reply.length > 0) {
        const { data: adminUser, error: adminError } =
          await supabase
            .from("users")
            .select("id")
            .eq("line_user_id", auth.userId)
            .maybeSingle();

        if (adminError) {
          console.error("管理者ユーザー取得エラー:", {
            code: adminError.code,
          });

          return jsonResponse(
            { error: "管理者情報を取得できませんでした。" },
            500
          );
        }

        if (!adminUser) {
          return jsonResponse(
            { error: "管理者のユーザー登録が見つかりません。" },
            403
          );
        }

        updates.admin_reply = reply;
        updates.replied_by_user_id = adminUser.id;
        updates.replied_at = new Date().toISOString();
      } else {
        updates.admin_reply = null;
        updates.replied_by_user_id = null;
        updates.replied_at = null;
      }
    }

    const { data, error } = await supabase
      .from("inquiries")
      .update(updates)
      .eq("id", id)
      .select(
        "id, category, subject, message, status, admin_reply, replied_at, created_at, updated_at"
      )
      .maybeSingle();

    if (error) {
      console.error("問い合わせ更新エラー:", {
        code: error.code,
      });

      return jsonResponse(
        { error: "問い合わせを更新できませんでした。" },
        500
      );
    }

    if (!data) {
      return jsonResponse(
        { error: "問い合わせが見つかりません。" },
        404
      );
    }

    return jsonResponse({
      success: true,
      inquiry: data,
    });
  } catch (error) {
    console.error("管理者問い合わせ更新APIエラー:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return jsonResponse(
      { error: "サーバーエラーが発生しました。" },
      500
    );
  }
}