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
      request.headers.get("authorization") !==
      `Bearer ${cronSecret}`
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

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey
    );

    const now = new Date();
    const nowIso = now.toISOString();
    const cutoff = new Date(
      now.getTime() - SEVEN_DAYS_MS
    ).toISOString();
    const cutoffTime = new Date(cutoff).getTime();

    // 7日以上前の完了報告がある、有効な未完了案件を取得
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

    for (const match of candidates) {
      // どちらか一方だけが報告済みであることを確認
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

      if (!performerExpired && !facilityExpired) {
        skippedCount++;
        continue;
      }

      // 更新時にも条件を再確認し、同時操作との競合を防ぐ
      let updateQuery = supabase
        .from("matches")
        .update({
          performance_status: "completed",
          completed_at: nowIso,
          completion_method: "auto_completion",
        })
        .eq("id", match.id)
        .eq("status", "active")
        .eq("performance_status", "scheduled")
        .is("completion_disputed_at", null);

      if (performerExpired && performerReported) {
        updateQuery = updateQuery
          .lte("performer_completion_reported_at", cutoff)
          .is("facility_completion_reported_at", null);
      } else if (facilityExpired && facilityReported) {
        updateQuery = updateQuery
          .lte("facility_completion_reported_at", cutoff)
          .is("performer_completion_reported_at", null);
      } else {
        skippedCount++;
        continue;
      }

      const { data: updatedRows, error: updateError } =
        await updateQuery.select("id");

      if (updateError) {
        console.error(
          `自動完了更新エラー (${match.id}):`,
          updateError
        );

        return NextResponse.json(
          {
            error: "自動完了の更新に失敗しました",
            completedCount,
          },
          { status: 500 }
        );
      }

      if (updatedRows && updatedRows.length > 0) {
        completedCount++;
      } else {
        // 取得後に相手の報告・異議申し立て・キャンセル等が
        // 発生した場合は更新されない
        skippedCount++;
      }
    }

    console.log("自動完了処理:", {
      checkedAt: nowIso,
      candidateCount: candidates.length,
      completedCount,
      skippedCount,
    });

    return NextResponse.json({
      success: true,
      checkedAt: nowIso,
      candidateCount: candidates.length,
      completedCount,
      skippedCount,
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