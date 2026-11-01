import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);

    if (!auth.authorized) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const requestedStatus = searchParams.get("status") ?? "all";

    const allowedStatuses = ["all", "in_progress", "resolved"];

    if (!allowedStatuses.includes(requestedStatus)) {
      return NextResponse.json(
        { error: "指定された対応状況が不正です。" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("completion_dispute_admin_cases")
      .select(`
        id,
        match_id,
        status,
        dispute_reason,
        disputed_by,
        disputed_at,
        resolved_at,
        resolved_by_line_user_id,
        resolution_note,
        resolution_source,
        created_at,
        updated_at,
        matches!inner (
          id,
          request_id,
          performer_id,
          band_id,
          performance_status,
          performer_completion_reported_at,
          facility_completion_reported_at,
          completion_dispute_facility_agreed_at,
          completion_dispute_performer_agreed_at,
          performance_requests!inner (
            id,
            title,
            performance_date,
            facility_id,
            facilities!inner (
              id,
              name
            )
          ),
          performers (
            id,
            name
          )
        ),
        completion_dispute_admin_actions (
          id,
          admin_line_user_id,
          action_type,
          note,
          created_at
        )
      `)
      .order("created_at", { ascending: false })
      .order("created_at", {
        referencedTable: "completion_dispute_admin_actions",
        ascending: true,
      })
      .limit(100);

    if (requestedStatus !== "all") {
      query = query.eq("status", requestedStatus);
    }

    const { data, error } = await query;

    if (error) {
      console.error("異議申し立て一覧取得エラー:", error.message);

      return NextResponse.json(
        { error: "異議申し立て一覧を取得できませんでした。" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      disputes: data ?? [],
    });
  } catch (error) {
    console.error("管理者異議申し立てAPIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました。" },
      { status: 500 }
    );
  }
}