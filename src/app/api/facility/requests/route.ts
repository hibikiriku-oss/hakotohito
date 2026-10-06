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
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    // usersを取得
    const { data: user, error: userError } =
      await supabase
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
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // 自分の案件を取得
    const { data: requests, error } =
      await supabase
        .from("performance_requests")
        .select(`
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
          status,
          created_at
        `)
        .eq("facility_id", facility.id)
        .order("performance_date", {
          ascending: true,
        });

    if (error) {
      console.error(
        "案件取得エラー:",
        error
      );

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      requests: requests || [],
    });

  } catch (error) {
    console.error(
      "施設案件APIエラー:",
      error
    );

    return NextResponse.json(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}