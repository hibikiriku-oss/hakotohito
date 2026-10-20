import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_STATUSES = [
  "open",
  "in_progress",
  "resolved",
] as const;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return auth.response;
    }

    const { id } = await context.params;

    // UUID形式を検証
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      )
    ) {
      return NextResponse.json(
        { error: "問い合わせIDが不正です。" },
        { status: 400 }
      );
    }

    const body = await request.json();

    const hasStatus = Object.prototype.hasOwnProperty.call(
      body,
      "status"
    );
    const hasReply = Object.prototype.hasOwnProperty.call(
      body,
      "adminReply"
    );

    if (!hasStatus && !hasReply) {
      return NextResponse.json(
        { error: "更新する内容がありません。" },
        { status: 400 }
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
        return NextResponse.json(
          { error: "対応状況が不正です。" },
          { status: 400 }
        );
      }

      updates.status = body.status;
    }

    if (hasReply) {
      if (
        body.adminReply !== null &&
        typeof body.adminReply !== "string"
      ) {
        return NextResponse.json(
          { error: "返信内容が不正です。" },
          { status: 400 }
        );
      }

      const reply =
        typeof body.adminReply === "string"
          ? body.adminReply.trim()
          : "";

      if (reply.length > 5000) {
        return NextResponse.json(
          { error: "返信は5000文字以内で入力してください。" },
          { status: 400 }
        );
      }

      if (reply.length > 0) {
        // 認証済み管理者のDBユーザーIDを取得
        const { data: adminUser, error: adminError } =
          await supabase
            .from("users")
            .select("id")
            .eq("line_user_id", auth.userId)
            .maybeSingle();

        if (adminError) {
          console.error(
            "管理者ユーザー取得エラー:",
            adminError.message
          );

          return NextResponse.json(
            { error: "管理者情報を取得できませんでした。" },
            { status: 500 }
          );
        }

        if (!adminUser) {
          return NextResponse.json(
            { error: "管理者のユーザー登録が見つかりません。" },
            { status: 403 }
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
      console.error("問い合わせ更新エラー:", error.message);

      return NextResponse.json(
        { error: "問い合わせを更新できませんでした。" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "問い合わせが見つかりません。" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      inquiry: data,
    });
  } catch (error) {
    console.error("管理者問い合わせ更新APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました。" },
      { status: 500 }
    );
  }
}