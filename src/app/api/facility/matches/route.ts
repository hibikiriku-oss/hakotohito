import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
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

    // LINEユーザーを取得
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
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
      return NextResponse.json(
        {
          error: "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設の案件に紐づくマッチングを取得
    const { data: matches, error: matchesError } =
      await supabase
        .from("matches")
        .select(`
          id,
          request_id,
          performer_id,
          matched_at,
          status,
          performance_requests (
            id,
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
        .eq(
          "performance_requests.facility_id",
          facility.id
        )
        .order("matched_at", {
          ascending: false,
        });

    if (matchesError) {
      console.error(
        "施設マッチング取得エラー:",
        matchesError
      );

      return NextResponse.json(
        {
          error: matchesError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      matches: matches || [],
    });
  } catch (error) {
    console.error(
      "施設マッチングAPIエラー:",
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
