import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id: requestId } = await context.params;

    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
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
      console.error(
        "ユーザー取得エラー:",
        userError
      );

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

    // この案件が本当にこの施設の案件か確認
    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select("id, title")
        .eq("id", requestId)
        .eq("facility_id", facility.id)
        .single();

    if (requestError || !performanceRequest) {
      console.error(
        "案件取得エラー:",
        requestError
      );

      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    // 応募者を取得
    const { data: applications, error: applicationsError } =
      await supabase
        .from("applications")
        .select(`
          id,
          message,
          status,
          created_at,
          performers (
            id,
            name,
            area,
            instruments,
            genres,
            bio,
            users (
              display_name,
              picture_url
            )
          )
        `)
        .eq("request_id", requestId)
        .order("created_at", {
          ascending: true,
        });

    if (applicationsError) {
      console.error(
        "応募者取得エラー:",
        applicationsError
      );

      return NextResponse.json(
        { error: applicationsError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      request: performanceRequest,
      applications: applications || [],
    });

  } catch (error) {
    console.error(
      "応募者APIエラー:",
      error
    );

    return NextResponse.json(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}