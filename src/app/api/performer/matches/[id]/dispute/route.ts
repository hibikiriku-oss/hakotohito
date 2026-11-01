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
    const { id: matchId } = await params;

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

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "申し立て理由を入力してください" },
        { status: 400 }
      );
    }

    const reason =
      typeof body === "object" &&
      body !== null &&
      "reason" in body &&
      typeof body.reason === "string"
        ? body.reason.trim()
        : "";

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

    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // マッチングを取得
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        status,
        performance_status,
        performer_id,
        band_id,
        completion_disputed_at
      `)
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) {
      console.error("異議申し立て対象の取得エラー:", matchError);

      return NextResponse.json(
        { error: "マッチング情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!match) {
      return NextResponse.json(
        { error: "マッチングが見つかりません" },
        { status: 404 }
      );
    }

    if (match.band_id) {
      // バンドの場合、現在のアクティブなリーダーだけが申し立て可能
      const { data: membership, error: membershipError } = await supabase
        .from("band_members")
        .select("role")
        .eq("band_id", match.band_id)
        .eq("performer_id", performer.id)
        .eq("status", "active")
        .maybeSingle();

      if (membershipError) {
        console.error("バンド申し立て権限の確認エラー:", membershipError);

        return NextResponse.json(
          { error: "操作権限を確認できませんでした" },
          { status: 500 }
        );
      }

      if (!membership || membership.role !== "leader") {
        return NextResponse.json(
          { error: "バンドの異議申し立てはリーダーのみ行えます" },
          { status: 403 }
        );
      }
    } else {
      // 個人マッチングは本人だけが申し立て可能
      if (match.performer_id !== performer.id) {
        return NextResponse.json(
          { error: "マッチングが見つからないか、操作する権限がありません" },
          { status: 404 }
        );
      }
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

    // matchesの更新と管理者対応案件の作成をDB側で一括実行
    const { data: caseId, error: disputeError } = await supabase.rpc(
      "register_completion_dispute",
      {
        p_match_id: matchId,
        p_disputed_by: "performer",
        p_reason: reason,
        p_user_id: user.id,
      }
);

    if (disputeError) {
      console.error("演奏者側の異議申し立てエラー:", disputeError);

      const errorMessage = disputeError.message ?? "";

      if (
        errorMessage.includes("Dispute already exists") ||
        errorMessage.includes("duplicate key") ||
        errorMessage.includes("idx_dispute_admin_cases_one_open_per_match")
      ) {
        return NextResponse.json(
          { error: "この演奏にはすでに異議申し立てがあります" },
          { status: 409 }
        );
      }

      if (
        errorMessage.includes("Match is not active") ||
        errorMessage.includes("already completed or cancelled")
      ) {
        return NextResponse.json(
          {
            error:
              "演奏状況が変更されています。画面を再読み込みしてください",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "異議申し立ての登録に失敗しました" },
        { status: 500 }
      );
    }

    if (!caseId) {
      console.error("異議申し立ての管理者案件IDが返されませんでした");

      return NextResponse.json(
        { error: "異議申し立ての登録に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "異議申し立てを登録しました",
    });
  } catch (error) {
    console.error("演奏者側の異議申し立てAPIエラー:", error);

    return NextResponse.json(
      { error: "異議申し立ての処理に失敗しました" },
      { status: 500 }
    );
  }
}