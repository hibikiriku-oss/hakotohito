import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CandidateMatch = {
  id: string;
  status: string;
  performance_status: string;
  performer_completion_reported_at: string | null;
  facility_completion_reported_at: string | null;
  completion_disputed_at: string | null;
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

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error("CRON_SECRET が設定されていません");
      return NextResponse.json(
        { error: "自動完了処理の設定がありません" },
        { status: 500 }
      );
    }

    if (
      request.headers.get("authorization") !== `Bearer ${cronSecret}`
    ) {
      return NextResponse.json(
        { error: "認証に失敗しました" },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase の環境変数が設定されていません");
      return NextResponse.json(
        { error: "データベースの設定がありません" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date();
    const nowIso = now.toISOString();
    const cutoff = new Date(
      now.getTime() - SEVEN_DAYS_MS
    ).toISOString();
    const cutoffTime = new Date(cutoff).getTime();

    // 7日以上前の完了報告がある、有効な未完了案件を取得する。
    const { data: matches, error: fetchError } = await supabase
      .from("matches")
      .select(
        [
          "id",
          "status",
          "performance_status",
          "performer_completion_reported_at",
          "facility_completion_reported_at",
          "completion_disputed_at",
        ].join(", ")
      )
      .eq("status", "active")
      .eq("performance_status", "scheduled")
      .is("completion_disputed_at", null)
      .or(
        `performer_completion_reported_at.lte.${cutoff},facility_completion_reported_at.lte.${cutoff}`
      );

    if (fetchError) {
      console.error("自動完了対象の取得エラー:", fetchError);
      return NextResponse.json(
        { error: "自動完了対象を取得できませんでした" },
        { status: 500 }
      );
    }

    const candidates = (matches || []) as unknown as CandidateMatch[];

    let completedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let feeChargedCount = 0;
    let feeTotal = 0;

    for (const match of candidates) {
      const performerReported =
        match.performer_completion_reported_at;
      const facilityReported =
        match.facility_completion_reported_at;

      const performerExpired =
        !!performerReported &&
        new Date(performerReported).getTime() <= cutoffTime &&
        !facilityReported;

      const facilityExpired =
        !!facilityReported &&
        new Date(facilityReported).getTime() <= cutoffTime &&
        !performerReported;

      // 片側のみが7日以上前に報告している案件だけを対象にする。
      if (!performerExpired && !facilityExpired) {
        skippedCount++;
        continue;
      }

      // DB関数内で再検証・行ロック・完了確定・手数料処理を行う。
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "complete_match_with_fee",
        {
          p_match_id: match.id,
          p_completion_mode: "auto",
        }
      );

      if (rpcError) {
        errorCount++;
        console.error(
          `自動完了RPCエラー (${match.id}):`,
          rpcError
        );
        continue;
      }

      const result = rpcData as CompletionResult | null;


      if (!result?.success) {
        const errorMessage =
          result?.errorMessage ||
          result?.error ||
          "自動完了処理に失敗しました";

        // 実行前の検索後に状態が変わった場合は、想定内のスキップとして扱う
        const isExpectedSkip = [
          "自動完了の条件を満たしていません",
          "このマッチングは完了できる状態ではありません",
          "完了について異議申し立て中のため確定できません",
        ].includes(errorMessage);

        if (isExpectedSkip) {
          skippedCount++;
          console.warn(
            `[auto-complete] Skipped match ${match.id}: ${errorMessage}`
          );
        } else {
          errorCount++;
          console.error(
            `[auto-complete] Failed match ${match.id}: ${errorMessage}`
          );
        }

        continue;
      }

      if (result.alreadyCompleted) {
        skippedCount++;
        continue;
      }

      completedCount++;

      if (result.feeCharged) {
        feeChargedCount++;
        feeTotal += result.feeAmount ?? 0;
      }
    }

    console.log("自動完了処理:", {
      checkedAt: nowIso,
      candidateCount: candidates.length,
      completedCount,
      skippedCount,
      errorCount,
      feeChargedCount,
      feeTotal,
    });

    return NextResponse.json({
      success: errorCount === 0,
      checkedAt: nowIso,
      candidateCount: candidates.length,
      completedCount,
      skippedCount,
      errorCount,
      feeChargedCount,
      feeTotal,
      message: `${completedCount}件を自動完了しました`,
    });
  } catch (error) {
    console.error("自動完了処理エラー:", error);

    return NextResponse.json(
      { error: "自動完了処理に失敗しました" },
      { status: 500 }
    );
  }
}