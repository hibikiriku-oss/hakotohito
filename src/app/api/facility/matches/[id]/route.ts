import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    const { id: matchId } = await params;

    // LINEユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
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
      console.error("施設取得エラー:", facilityError);

      return NextResponse.json(
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // マッチングと完了報告・異議申し立ての情報を取得
    // * を使用し、新しく追加したカラムも取得する
    const { data: rawMatch, error: matchError } = await supabase
      .from("matches")
      .select(`
        *,
        performance_requests (
          id,
          facility_id,
          title,
          description,
          performance_date,
          start_time,
          end_time,
          area,
          instruments,
          genres,
          reward,
          status
        ),
        performers (
          id,
          name,
          instruments,
          genres,
          area,
          bio,
          users (
            id,
            display_name,
            picture_url
          )
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !rawMatch) {
      console.error("マッチング取得エラー:", matchError);

      return NextResponse.json(
        { error: "マッチング情報が見つかりません" },
        { status: 404 }
      );
    }

    const match = rawMatch as unknown as {
      id: string;
      request_id: string;
      performer_id: string;
      status: string;
      performance_status: string;
      completed_at: string | null;
      performer_completion_reported_at: string | null;
      facility_completion_reported_at: string | null;
      completion_disputed_at: string | null;
      completion_disputed_by: string | null;
      completion_dispute_reason: string | null;
      completion_method: string | null;
      performance_requests:
        | Record<string, unknown>
        | Record<string, unknown>[]
        | null;
      performers: Record<string, unknown> | null;
      [key: string]: unknown;
    };

    const performanceRequest = Array.isArray(match.performance_requests)
      ? match.performance_requests[0]
      : match.performance_requests;

    if (!performanceRequest) {
      return NextResponse.json(
        { error: "演奏案件が見つかりません" },
        { status: 404 }
      );
    }

    // 施設本人の案件か確認
    if (performanceRequest.facility_id !== facility.id) {
      return NextResponse.json(
        { error: "このマッチングを閲覧する権限がありません" },
        { status: 403 }
      );
    }

    // 応募メッセージを取得
    const { data: application, error: applicationError } =
      await supabase
        .from("applications")
        .select("id, message, status, created_at")
        .eq("request_id", match.request_id)
        .eq("performer_id", match.performer_id)
        .maybeSingle();

    if (applicationError) {
      console.error("応募情報取得エラー:", applicationError);
    }

    return NextResponse.json({
      match,
      application: application || null,
    });
  } catch (error) {
    console.error("施設マッチング詳細APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}