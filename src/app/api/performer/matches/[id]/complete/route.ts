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
  completion_disputed_by?: string | null;
  completion_dispute_reason?: string | null;
  completion_method?: string | null;
};

type CompletionResult = {
  success?: boolean;
  alreadyCompleted?: boolean;
  feeCharged?: boolean;
  feeAmount?: number;
  error?: string;
  errorMessage?: string;
  message?: string;
};

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
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

    const { data: rawMatch, error: matchError } = await supabase
      .from("matches")
      .select(
        "id, request_id, performer_id, status, performance_status, completed_at, performer_completion_reported_at, facility_completion_reported_at, completion_disputed_at"
      )
      .eq("id", matchId)
      .eq("performer_id", performer.id)
      .single();

    const match = rawMatch as unknown as CompletionMatch | null;

    if (matchError || !match) {
      return NextResponse.json(
        { error: "マッチングが見つかりません" },
        { status: 404 }
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
        {
          error:
            "演奏完了について異議申し立てがあるため、現在は完了処理できません",
        },
        { status: 409 }
      );
    }

    // 演奏者の完了報告を記録。既存の報告日時は上書きしない。
    if (!match.performer_completion_reported_at) {
      const { data: reportRows, error: reportError } = await supabase
        .from("matches")
        .update({
          performer_completion_reported_at: new Date().toISOString(),
        })
        .eq("id", matchId)
        .eq("performer_id", performer.id)
        .eq("status", "active")
        .eq("performance_status", "scheduled")
        .is("performer_completion_reported_at", null)
        .is("completion_disputed_at", null)
        .select("id");

      if (reportError) {
        console.error("演奏者の完了報告エラー:", reportError);
        return NextResponse.json(
          { error: "演奏完了の報告に失敗しました" },
          { status: 500 }
        );
      }

      if (!reportRows || reportRows.length === 0) {
        // 同時操作があった可能性があるため、最新状態を再取得する。
        const { data: currentMatch, error: currentError } =
          await supabase
            .from("matches")
            .select(
              "id, request_id, performer_id, status, performance_status, completed_at, performer_completion_reported_at, facility_completion_reported_at, completion_disputed_at, completion_disputed_by, completion_dispute_reason, completion_method"
            )
            .eq("id", matchId)
            .eq("performer_id", performer.id)
            .maybeSingle();

        if (currentError || !currentMatch) {
          return NextResponse.json(
            { error: "最新の演奏状況を取得できませんでした" },
            { status: 500 }
          );
        }

        if (
          currentMatch.status !== "active" ||
          currentMatch.performance_status === "cancelled" ||
          currentMatch.completion_disputed_at
        ) {
          return NextResponse.json(
            {
              error:
                "マッチングの状態が変更されたため、報告を登録できませんでした",
            },
            { status: 409 }
          );
        }

        if (
          currentMatch.performance_status === "completed" ||
          currentMatch.completed_at
        ) {
          return NextResponse.json({
            success: true,
            completed: true,
            message: "この演奏はすでに完了しています",
            match: currentMatch,
          });
        }

        if (
          currentMatch.performance_status !== "scheduled" ||
          !currentMatch.performer_completion_reported_at
        ) {
          return NextResponse.json(
            {
              error:
                "報告を登録できませんでした。演奏状況を再読み込みしてください",
            },
            { status: 409 }
          );
        }
      }
    }

    // 最新の報告状況を取得する。
    const { data: latestRawMatch, error: latestMatchError } =
      await supabase
        .from("matches")
        .select(
          "id, request_id, performer_id, status, performance_status, completed_at, performer_completion_reported_at, facility_completion_reported_at, completion_disputed_at, completion_disputed_by, completion_dispute_reason, completion_method"
        )
        .eq("id", matchId)
        .eq("performer_id", performer.id)
        .single();

    const latestMatch =
      latestRawMatch as unknown as CompletionMatch | null;

    if (latestMatchError || !latestMatch) {
      return NextResponse.json(
        { error: "報告状況の取得に失敗しました" },
        { status: 500 }
      );
    }

    if (
      latestMatch.performance_status === "completed" ||
      latestMatch.completed_at
    ) {
      return NextResponse.json({
        success: true,
        completed: true,
        message: "この演奏はすでに完了しています",
        match: latestMatch,
      });
    }

    if (
      latestMatch.status !== "active" ||
      latestMatch.performance_status !== "scheduled" ||
      latestMatch.completion_disputed_at
    ) {
      return NextResponse.json(
        {
          error:
            "マッチングの状態が変更されたため、完了処理を続行できません",
        },
        { status: 409 }
      );
    }

    // 双方の報告がそろった場合だけ、DB関数で完了確定と手数料処理を行う。
    if (
      latestMatch.performer_completion_reported_at &&
      latestMatch.facility_completion_reported_at
    ) {
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "complete_match_with_fee",
        {
          p_match_id: matchId,
          p_completion_mode: "mutual",
        }
      );

      if (rpcError) {
        console.error("演奏完了RPCエラー:", rpcError);
        return NextResponse.json(
          { error: "演奏完了の確定に失敗しました" },
          { status: 500 }
        );
      }

      const result = rpcData as CompletionResult | null;

      if (!result?.success) {
        const errorMessage =
          result?.errorMessage ||
          result?.error ||
          "演奏完了を確定できませんでした。最新の状況を確認してください";

        console.error("演奏完了RPCが失敗しました:", result);

        return NextResponse.json(
          { error: errorMessage },
          { status: 409 }
        );
      }

      const { data: completedMatch, error: completedMatchError } =
        await supabase
          .from("matches")
          .select("*")
          .eq("id", matchId)
          .eq("performer_id", performer.id)
          .single();

      if (completedMatchError || !completedMatch) {
        console.error(
          "完了後のマッチング取得エラー:",
          completedMatchError
        );
        return NextResponse.json(
          { error: "完了後の演奏状況を取得できませんでした" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        completed: true,
        alreadyCompleted: result.alreadyCompleted ?? false,
        feeCharged: result.feeCharged ?? false,
        feeAmount: result.feeAmount ?? 0,
        message:
          result.message || "双方の報告により演奏が完了しました",
        match: completedMatch,
      });
    }

    return NextResponse.json({
      success: true,
      completed: false,
      pendingConfirmation: true,
      message: "演奏完了を報告しました。施設側の確認を待っています",
      match: latestMatch,
    });
  } catch (error) {
    console.error("演奏完了APIエラー:", error);

    return NextResponse.json(
      { error: "演奏完了処理に失敗しました" },
      { status: 500 }
    );
  }
}