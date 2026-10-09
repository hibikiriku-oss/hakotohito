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
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    const { id: matchId } = await params;

    // LINEユーザーを取得
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        {
          error: "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設を取得
    const { data: facility, error: facilityError } =
      await supabase
        .from("facilities")
        .select("id")
        .eq("user_id", user.id)
        .single();

    if (facilityError || !facility) {
      console.error(
        "施設取得エラー:",
        facilityError
      );

      return NextResponse.json(
        {
          error: "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // マッチングを取得
    const { data: match, error: matchError } =
      await supabase
        .from("matches")
        .select(`
          id,
          request_id,
          performer_id,
          matched_at,
          status,
          performance_status,
          completed_at,
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
        .eq("performer_id", (await getPerformerId(matchId)))
        .single();

    if (matchError || !match) {
      console.error(
        "マッチング取得エラー:",
        matchError
      );

      return NextResponse.json(
        {
          error:
            "マッチング情報が見つかりません",
        },
        { status: 404 }
      );
    }

    const performanceRequest =
      Array.isArray(match.performance_requests)
        ? match.performance_requests[0]
        : match.performance_requests;

    if (!performanceRequest) {
      return NextResponse.json(
        {
          error: "演奏案件が見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設本人の案件か確認
    if (
      performanceRequest.facility_id !==
      facility.id
    ) {
      return NextResponse.json(
        {
          error:
            "このマッチングを閲覧する権限がありません",
        },
        { status: 403 }
      );
    }

    // 応募メッセージを取得
    const { data: application, error: applicationError } =
      await supabase
        .from("applications")
        .select(`
          id,
          message,
          status,
          created_at
        `)
        .eq("request_id", match.request_id)
        .eq(
          "performer_id",
          match.performer_id
        )
        .single();

    if (applicationError) {
      console.error(
        "応募情報取得エラー:",
        applicationError
      );
    }

    return NextResponse.json({
      match,
      application:
        application || null,
    });
  } catch (error) {
    console.error(
      "施設マッチング詳細APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "サーバーエラー",
      },
      { status: 500 }
    );
  }
}

/**
 * マッチングに登録されている演奏者IDを取得
 */
async function getPerformerId(
  matchId: string
): Promise<string> {
  const { data, error } =
    await supabase
      .from("matches")
      .select("performer_id")
      .eq("id", matchId)
      .single();

  if (error || !data) {
    throw new Error(
      "演奏者情報を取得できません"
    );
  }

  return data.performer_id;
}