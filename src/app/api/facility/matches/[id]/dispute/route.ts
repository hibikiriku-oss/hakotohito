import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
      const authorization = request.headers.get("authorization");
      const idToken = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";

      if (!idToken) {
        return NextResponse.json(
          { error: "LINEの本人確認情報がありません。再ログインしてください。" },
          { status: 401 }
        );
      }

      const verified = await verifyLineIdToken(idToken);

      if (!verified) {
        return NextResponse.json(
          { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
          { status: 401 }
        );
      }

      const lineUserId = verified.userId;
      const { id: matchId } = await params;

    let body: { reason?: unknown };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "申し立て理由を入力してください" },
        { status: 400 }
      );
    }

    const reason =
      typeof body.reason === "string" ? body.reason.trim() : "";

    if (!reason) {
      return NextResponse.json(
        { error: "申し立て理由を入力してください" },
        { status: 400 }
      );
    }

    if (reason.length > 1000) {
      return NextResponse.json(
        { error: "申し立て理由は1000文字以内で入力してください" },
        { status: 400 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      return NextResponse.json(
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    const { data: rawMatch, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        status,
        performance_status,
        completion_disputed_at,
        performance_requests!inner (
          facility_id
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !rawMatch) {
      return NextResponse.json(
        { error: "マッチングが見つかりません" },
        { status: 404 }
      );
    }

    const match = rawMatch as unknown as {
      id: string;
      status: string;
      performance_status: string;
      completion_disputed_at: string | null;
      performance_requests:
        | { facility_id: string }
        | { facility_id: string }[];
    };

    const performanceRequest = Array.isArray(match.performance_requests)
      ? match.performance_requests[0]
      : match.performance_requests;

    if (!performanceRequest || performanceRequest.facility_id !== facility.id) {
      return NextResponse.json(
        { error: "このマッチングを操作する権限がありません" },
        { status: 403 }
      );
    }

    if (match.status !== "active") {
      return NextResponse.json(
        { error: "有効なマッチングではありません" },
        { status: 400 }
      );
    }

    if (
      match.performance_status === "completed" ||
      match.performance_status === "cancelled"
    ) {
      return NextResponse.json(
        { error: "完了またはキャンセル済みの演奏には申し立てできません" },
        { status: 400 }
      );
    }

    if (match.completion_disputed_at) {
      return NextResponse.json(
        { error: "この演奏にはすでに異議申し立てがあります" },
        { status: 409 }
      );
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from("matches")
      .update({
        completion_disputed_at: new Date().toISOString(),
        completion_disputed_by: "facility",
        completion_dispute_reason: reason,
      })
      .eq("id", matchId)
      .eq("status", "active")
      .eq("performance_status", match.performance_status)
      .is("completion_disputed_at", null)
      .select("id");

    if (updateError) {
      console.error("施設側の異議申し立てエラー:", updateError);
      return NextResponse.json(
        { error: "異議申し立ての登録に失敗しました" },
        { status: 500 }
      );
    }

    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json(
        { error: "演奏状況が変更されています。画面を再読み込みしてください" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "異議申し立てを登録しました",
    });
  } catch (error) {
    console.error("施設側の異議申し立てAPIエラー:", error);
    return NextResponse.json(
      { error: "異議申し立ての処理に失敗しました" },
      { status: 500 }
    );
  }
}