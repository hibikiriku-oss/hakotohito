import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
    if (!token) return NextResponse.json({ error: "LINEの本人確認情報がありません" }, { status: 401 });
    const verified = await verifyLineIdToken(token);
    if (!verified?.userId) return NextResponse.json({ error: "LINEの本人確認に失敗しました" }, { status: 401 });
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "レッスン応募IDが不正です" }, { status: 400 });

    const { data: user, error: userError } = await supabase
      .from("users").select("id").eq("line_user_id", verified.userId).eq("account_status", "active").single();
    if (userError || !user) return NextResponse.json({ error: "有効なユーザーが見つかりません" }, { status: 404 });
    const { data: performer, error: performerError } = await supabase
      .from("performers").select("id").eq("user_id", user.id).single();
    if (performerError || !performer) return NextResponse.json({ error: "演奏者プロフィールが見つかりません" }, { status: 404 });

    const { data, error } = await supabase.rpc("cancel_lesson_application_with_refund", {
      p_lesson_application_id: id,
      p_actor_performer_id: performer.id,
    });
    if (error) {
      console.error("レッスンキャンセルRPCエラー:", error);
      return NextResponse.json({ error: "レッスンのキャンセルに失敗しました" }, { status: 409 });
    }
    if (!data?.success) return NextResponse.json({ error: data?.errorMessage ?? "キャンセルできませんでした" }, { status: 409 });
    return NextResponse.json({ success: true, refundAmount: data.refundAmount ?? 0, alreadyCancelled: data.alreadyCancelled ?? false });
  } catch (error) {
    console.error("レッスンキャンセルAPIエラー:", error);
    return NextResponse.json({ error: "レッスンのキャンセルに失敗しました" }, { status: 500 });
  }
}
