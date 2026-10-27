import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLinePushMessage, type LineMessage } from "@/lib/line";
import { verifyLineIdToken } from "@/lib/line-auth";

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params;
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim();

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

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
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

    if (
      !performanceRequest ||
      performanceRequest.facility_id !== facility.id
    ) {
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
        {
          error:
            "演奏完了について異議申し立てがあるため、処理できません",
        },
        { status: 409 }
      );
    }

    // 施設側の完了報告がこのリクエストで新規登録されたかを記録する。
    // 再試行によるLINE通知の重複を避ける。
    let facilityReportJustRecorded = false;

    // 施設側の完了報告を記録。既存の報告日時は上書きしない。
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

      facilityReportJustRecorded = Boolean(reportRows && reportRows.length > 0);

      if (!reportRows || reportRows.length === 0) {
        // 同時操作の可能性があるため、最新状態を確認する。
        const { data: currentMatch, error: currentError } =
          await supabase
            .from("matches")
            .select("*")
            .eq("id", matchId)
            .maybeSingle();

        if (currentError || !currentMatch) {
          return NextResponse.json(
            { error: "最新の演奏状況を取得できませんでした" },
            { status: 500 }
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
          currentMatch.status !== "active" ||
          currentMatch.performance_status !== "scheduled" ||
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

        if (!currentMatch.facility_completion_reported_at) {
          return NextResponse.json(
            {
              error:
                "報告を登録できませんでした。画面を再読み込みしてください",
            },
            { status: 409 }
          );
        }
      }
    }

    // 最新の双方の報告状況を取得する。
    const { data: latestRawMatch, error: latestError } =
      await supabase
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

    const latestMatch = latestRawMatch as unknown as CompletionMatch | null;

    if (latestError || !latestMatch) {
      return NextResponse.json(
        { error: "最新の報告状況を取得できませんでした" },
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
            "マッチングの状態が変更されたため、処理を中止しました",
        },
        { status: 409 }
      );
    }

    // nullチェック後の確定済みマッチングを利用し、通知関数内の型エラーを防ぐ。
    const safeLatestMatch: CompletionMatch = latestMatch;

    const notifyPerformerCompletion = async (
      isCompleted: boolean
    ): Promise<boolean> => {
      if (!facilityReportJustRecorded) {
        return false;
      }

      try {
        const { data: performer, error: performerError } =
          await supabase
            .from("performers")
            .select("id, user_id, name")
            .eq("id", safeLatestMatch.performer_id)
            .maybeSingle();

        if (performerError || !performer?.user_id) {
          console.error(
            "演奏完了通知：演奏者取得エラー",
            performerError
          );
          return false;
        }

        const { data: performerUser, error: performerUserError } =
          await supabase
            .from("users")
            .select("line_user_id, display_name")
            .eq("id", performer.user_id)
            .maybeSingle();

        if (performerUserError || !performerUser?.line_user_id) {
          console.error(
            "演奏完了通知：通知先取得エラー",
            performerUserError
          );
          return false;
        }

        const { data: performanceRequest, error: requestError } =
          await supabase
            .from("performance_requests")
            .select("title")
            .eq("id", safeLatestMatch.request_id)
            .maybeSingle();

        if (requestError) {
          console.error(
            "演奏完了通知：案件名取得エラー",
            requestError
          );
        }

        const miniAppBaseUrl =
          "https://miniapp.line.me/2011785379-l5XCTbIf";
        const matchUrl = `${miniAppBaseUrl}/performer/matches/${matchId}`;
        const reviewUrl = `${miniAppBaseUrl}/performer/matches/${matchId}/review`;
        const title = isCompleted
          ? "✅ 演奏完了が確定しました"
          : "📩 施設から完了報告が届きました";
        const description = isCompleted
          ? "施設と演奏者の双方が完了を報告し、演奏が完了しました。"
          : "施設が演奏完了を報告しました。マッチング詳細を確認し、完了報告を行ってください。";

        const messages: LineMessage[] = [
          {
            type: "flex",
            altText: title,
            contents: {
              type: "bubble",
              size: "kilo",
              header: {
                type: "box",
                layout: "vertical",
                backgroundColor: isCompleted ? "#15803D" : "#2563EB",
                paddingAll: "16px",
                contents: [
                  {
                    type: "text",
                    text: title,
                    color: "#FFFFFF",
                    weight: "bold",
                    size: "lg",
                    wrap: true,
                  },
                ],
              },
              body: {
                type: "box",
                layout: "vertical",
                paddingAll: "16px",
                spacing: "md",
                contents: [
                  {
                    type: "text",
                    text: performanceRequest?.title || "演奏案件",
                    weight: "bold",
                    size: "lg",
                    color: "#111827",
                    wrap: true,
                  },
                  {
                    type: "text",
                    text: `${performer.name || performerUser.display_name || "演奏者"}さんへ`,
                    size: "sm",
                    color: "#374151",
                    wrap: true,
                  },
                  {
                    type: "text",
                    text: description,
                    size: "sm",
                    color: "#374151",
                    wrap: true,
                  },
                ],
              },
              footer: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                paddingAll: "16px",
                contents: [
                  {
                    type: "button",
                    style: "primary",
                    color: isCompleted ? "#15803D" : "#2563EB",
                    action: {
                      type: "uri",
                      label: isCompleted ? "施設を評価する" : "マッチングを確認する",
                      uri: isCompleted ? reviewUrl : matchUrl,
                    },
                  },
                ],
              },
            },
          },
        ];

        const lineResult = await sendLinePushMessage(
          performerUser.line_user_id,
          messages
        );

        if (!lineResult.success) {
          console.error(
            "演奏完了通知の送信エラー:",
            lineResult.error
          );
          return false;
        }

        return true;
      } catch (notificationError) {
        console.error("演奏完了通知の例外:", notificationError);
        return false;
      }
    };

    // 双方が報告済みなら、DB関数で完了確定と手数料処理を一括実行する。
    if (
      safeLatestMatch.performer_completion_reported_at &&
      safeLatestMatch.facility_completion_reported_at
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
          "演奏完了を確定できませんでした。画面を再読み込みしてください";

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

      const notificationSent = await notifyPerformerCompletion(true);

      return NextResponse.json({
        success: true,
        completed: true,
        alreadyCompleted: result.alreadyCompleted ?? false,
        feeCharged: result.feeCharged ?? false,
        feeAmount: result.feeAmount ?? 0,
        notificationSent,
        message:
          result.message || "双方の報告により演奏が完了しました",
        match: completedMatch,
      });
    }

    const notificationSent = await notifyPerformerCompletion(false);

    return NextResponse.json({
      success: true,
      completed: false,
      pendingConfirmation: true,
      notificationSent,
      message: "演奏完了を報告しました。演奏者側の確認を待っています",
      match: safeLatestMatch,
    });
  } catch (error) {
    console.error("施設の演奏完了APIエラー:", error);

    return NextResponse.json(
      { error: "演奏完了処理に失敗しました" },
      { status: 500 }
    );
  }
}