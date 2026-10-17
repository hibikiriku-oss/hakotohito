import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CompletionMatch = {
  id: string;
  request_id: string;
  performer_id: string;
  status: string;
  performance_status: string;
  completed_at: string | null;
  performer_completion_reported_at: string | null;
  facility_completion_reported_at: string | null;
  completion_disputed_at: string | null;
  completion_method: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params;
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザーIDがありません" },
        { status: 401 }
      );
    }

    // LINEユーザーを取得
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

    // 施設プロフィールを取得
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

    // マッチングと案件の施設所有者を確認
    const { data: rawMatch, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        status,
        performance_status,
        completed_at,
        performer_completion_reported_at,
        facility_completion_reported_at,
        completion_disputed_at,
        completion_method,
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

    const match = rawMatch as unknown as CompletionMatch & {
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

    if (match.performance_status === "cancelled") {
      return NextResponse.json(
        { error: "キャンセルされた演奏です" },
        { status: 400 }
      );
    }

    if (match.performance_status === "completed") {
      return NextResponse.json({
        success: true,
        completed: true,
        message: "この演奏はすでに完了しています",
        match,
      });
    }

    if (match.completion_disputed_at) {
      return NextResponse.json(
        { error: "演奏完了について異議申し立てがあるため、処理できません" },
        { status: 409 }
      );
    }

    // 施設側の報告日時を記録。既存の報告は上書きしない。
    if (!match.facility_completion_reported_at) {
      const { data: reportRows, error: reportError } = await supabase
        .from("matches")
        .update({
          facility_completion_reported_at: new Date().toISOString(),
        })
        .eq("id", matchId)
        .eq("status", "active")
        .eq("performance_status", "scheduled")
        .is("facility_completion_reported_at", null)
        .is("completion_disputed_at", null)
        .select("id");

      if (reportError) {
        console.error("施設の完了報告エラー:", reportError);
        return NextResponse.json(
          { error: "演奏完了の報告に失敗しました" },
          { status: 500 }
        );
      }

      if (!reportRows || reportRows.length === 0) {
        return NextResponse.json(
          { error: "報告を登録できませんでした。画面を再読み込みしてください" },
          { status: 409 }
        );
      }
    }

    // 最新の報告状況を確認
    const {
      data: latestRawMatch,
      error: latestError,
    } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        status,
        performance_status,
        completed_at,
        performer_completion_reported_at,
        facility_completion_reported_at,
        completion_disputed_at,
        completion_method
      `)
      .eq("id", matchId)
      .single();

    const latestMatch =
      latestRawMatch as unknown as CompletionMatch | null;

    if (latestError || !latestMatch) {
      return NextResponse.json(
        { error: "最新の報告状況を取得できませんでした" },
        { status: 500 }
      );
    }

    if (
      latestMatch.status !== "active" ||
      latestMatch.completion_disputed_at
    ) {
      return NextResponse.json(
        { error: "マッチングの状態が変更されたため、処理を中止しました" },
        { status: 409 }
      );
    }

    // 双方が報告済みなら完了を確定
    if (
      latestMatch.performer_completion_reported_at &&
      latestMatch.facility_completion_reported_at
    ) {
      const { data: completedRows, error: completeError } = await supabase
        .from("matches")
        .update({
          performance_status: "completed",
          completed_at: new Date().toISOString(),
          completion_method: "mutual_confirmation",
        })
        .eq("id", matchId)
        .eq("status", "active")
        .eq("performance_status", "scheduled")
        .not("performer_completion_reported_at", "is", null)
        .not("facility_completion_reported_at", "is", null)
        .is("completion_disputed_at", null)
        .select("*");

      if (completeError) {
        console.error("演奏完了確定エラー:", completeError);
        return NextResponse.json(
          { error: "演奏完了の確定に失敗しました" },
          { status: 500 }
        );
      }

      if (completedRows && completedRows.length > 0) {
        return NextResponse.json({
          success: true,
          completed: true,
          message: "双方の報告により演奏が完了しました",
          match: completedRows[0],
        });
      }

      // 別の処理が先に完了した場合を確認
      const { data: currentMatch, error: currentError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .single();

      if (currentError || !currentMatch) {
        return NextResponse.json(
          { error: "最新の演奏状況を取得できませんでした" },
          { status: 500 }
        );
      }

      if (currentMatch.performance_status === "completed") {
        return NextResponse.json({
          success: true,
          completed: true,
          message: "演奏が完了しました",
          match: currentMatch,
        });
      }

      return NextResponse.json(
        { error: "演奏完了を確定できませんでした。画面を再読み込みしてください" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      completed: false,
      pendingConfirmation: true,
      message: "演奏完了を報告しました。演奏者側の確認を待っています",
      match: latestMatch,
    });
  } catch (error) {
    console.error("施設の演奏完了APIエラー:", error);

    return NextResponse.json(
      { error: "演奏完了処理に失敗しました" },
      { status: 500 }
    );
  }
}