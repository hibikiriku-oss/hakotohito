import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ActionType = "started" | "note" | "resolved";

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

    if (
      !id ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) {
      return NextResponse.json(
        { error: "案件IDが不正です。" },
        { status: 400 }
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "リクエスト形式が不正です。" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "入力内容が不正です。" },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;
    const actionType = data.actionType;
    const note = data.note;

    if (
      actionType !== "started" &&
      actionType !== "note" &&
      actionType !== "resolved"
    ) {
      return NextResponse.json(
        { error: "操作内容が不正です。" },
        { status: 400 }
      );
    }

    if (
      typeof note !== "string" ||
      note.trim().length === 0 ||
      note.trim().length > 2000
    ) {
      return NextResponse.json(
        { error: "記録内容は1〜2000文字で入力してください。" },
        { status: 400 }
      );
    }

    const typedAction = actionType as ActionType;

    const { data: result, error } = await supabaseAdmin.rpc(
      "manage_completion_dispute_case",
      {
        p_case_id: id,
        p_admin_line_user_id: auth.userId,
        p_action_type: typedAction,
        p_note: note.trim(),
      }
    );

    if (error) {
      console.error("Admin dispute action error:", error);

      const message = error.message ?? "";

      if (
        message.includes("対応中ではありません") ||
        message.includes("解決可能な異議申し立て状態ではありません")
      ) {
        return NextResponse.json(
          { error: message },
          { status: 409 }
        );
      }

      if (
        message.includes("見つかりません") ||
        message.includes("入力内容が不正")
      ) {
        return NextResponse.json(
          { error: message },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "異議申し立ての更新に失敗しました。" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Admin dispute PATCH error:", error);

    return NextResponse.json(
      { error: "管理者処理中にエラーが発生しました。" },
      { status: 500 }
    );
  }
}