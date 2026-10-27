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
  band_id: string | null;
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
      .select("id, display_name")
      .eq("line_user_id", verified.userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }


    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id, name")
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
        "id, request_id, performer_id, band_id, status, performance_status, completed_at, performer_completion_reported_at, facility_completion_reported_at, completion_disputed_at"
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

    // バンドマッチングの場合、現在のアクティブなリーダーだけが
    // 演奏完了を報告できるようにする
    if (match.band_id) {
      const { data: membership, error: membershipError } = await supabase
        .from("band_members")
        .select("role")
        .eq("band_id", match.band_id)
        .eq("performer_id", performer.id)
        .eq("status", "active")
        .maybeSingle();

      if (membershipError) {
        console.error("バンドリーダー権限の確認エラー:", membershipError);

        return NextResponse.json(
          { error: "操作権限を確認できませんでした" },
          { status: 500 }
        );
      }

      if (!membership || membership.role !== "leader") {
        return NextResponse.json(
          { error: "バンドの演奏完了報告はリーダーのみ行えます" },
          { status: 403 }
        );
      }
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

    // このリクエストで新たに演奏者の完了報告を登録したかを記録する。
    // 既存の報告を再送する操作で通知が重複しないようにする。
    let performerReportedNow = false;

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

      if (reportRows && reportRows.length > 0) {
        performerReportedNow = true;
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

    // 通知処理のクロージャー内でも null 判定済みの値を安全に参照できるよう、
    // 必要な値をここで固定する。
    const requestIdForNotification = latestMatch.request_id;
    const performerNameForNotification =
      performer.name || user.display_name || "演奏者";

    // 施設へ通知する。通知失敗は完了報告・手数料処理に影響させない。
    async function notifyFacility(kind: "pending" | "completed"): Promise<boolean> {
      try {
        const { data: performanceRequest, error: requestError } =
          await supabase
            .from("performance_requests")
            .select("id, title, performance_date, start_time, end_time, facility_id")
            .eq("id", requestIdForNotification)
            .maybeSingle();

        if (requestError || !performanceRequest) {
          console.error("完了通知：案件情報の取得エラー:", requestError);
          return false;
        }

        const { data: facility, error: facilityError } = await supabase
          .from("facilities")
          .select("id, name, user_id")
          .eq("id", performanceRequest.facility_id)
          .maybeSingle();

        if (facilityError || !facility?.user_id) {
          console.error("完了通知：施設情報の取得エラー:", facilityError);
          return false;
        }

        const { data: facilityUser, error: facilityUserError } =
          await supabase
            .from("users")
            .select("line_user_id")
            .eq("id", facility.user_id)
            .maybeSingle();

        if (facilityUserError || !facilityUser?.line_user_id) {
          console.error("完了通知：施設のLINEユーザーIDを取得できません:", facilityUserError);
          return false;
        }

        const miniAppBaseUrl =
          "https://miniapp.line.me/2011785379-l5XCTbIf";
        const matchUrl = `${miniAppBaseUrl}/facility/matches/${matchId}`;
        const reviewUrl = `${miniAppBaseUrl}/facility/matches/${matchId}/review`;
        const isCompletedNotice = kind === "completed";
        const title = isCompletedNotice
          ? "✅ 演奏完了のお知らせ"
          : "📩 演奏完了の確認依頼";
        const description = isCompletedNotice
          ? "双方の完了報告がそろい、演奏が完了しました。手数料の精算も完了処理に含まれています。"
          : "演奏者から完了報告が届きました。内容をご確認のうえ、施設側の完了報告を行ってください。";

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
                backgroundColor: isCompletedNotice ? "#15803D" : "#2563EB",
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
                    text: performanceRequest.title || "案件名未設定",
                    weight: "bold",
                    size: "lg",
                    color: "#111827",
                    wrap: true,
                  },
                  {
                    type: "text",
                    text: `演奏者：${performerNameForNotification}`,
                    size: "sm",
                    color: "#374151",
                    wrap: true,
                  },
                  {
                    type: "separator",
                  },
                  {
                    type: "text",
                    text:
                      `演奏日：${performanceRequest.performance_date || "未設定"}\n` +
                      `時間：${performanceRequest.start_time || "未設定"} ～ ${performanceRequest.end_time || "未設定"}`,
                    size: "sm",
                    color: "#374151",
                    wrap: true,
                  },
                  {
                    type: "text",
                    text: description,
                    size: "sm",
                    color: "#4B5563",
                    wrap: true,
                  },
                ],
              },
              footer: {
                type: "box",
                layout: "vertical",
                paddingAll: "16px",
                contents: [
                  {
                    type: "button",
                    style: "primary",
                    color: isCompletedNotice ? "#15803D" : "#2563EB",
                    action: {
                      type: "uri",
                      label: isCompletedNotice ? "演奏者を評価する" : "マッチングを確認する",
                      uri: isCompletedNotice ? reviewUrl : matchUrl,
                    },
                  },
                ],
              },
            },
          },
        ];

        const lineResult = await sendLinePushMessage(
          facilityUser.line_user_id,
          messages
        );

        if (!lineResult.success) {
          console.error("施設への完了LINE通知エラー:", lineResult.error);
          return false;
        }

        return true;
      } catch (notificationError) {
        console.error("施設への完了LINE通知例外:", notificationError);
        return false;
      }
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

      const notificationSent = result.alreadyCompleted
        ? false
        : await notifyFacility("completed");

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

    const notificationSent = performerReportedNow
      ? await notifyFacility("pending")
      : false;

    return NextResponse.json({
      success: true,
      completed: false,
      pendingConfirmation: true,
      notificationSent,
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