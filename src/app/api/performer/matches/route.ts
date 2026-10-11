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
          error:
            "LINEユーザーIDが指定されていません",
        },
        { status: 400 }
      );
    }

    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "ユーザーが見つかりません",
        },
        { status: 404 }
      );
    }

    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .single();

    if (performerError || !performer) {
      return NextResponse.json(
        {
          error:
            "演奏者プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    const { data: matches, error: matchesError } =
      await supabase
        .from("matches")
        .select(
          `
          id,
          request_id,
          performer_id,
          matched_at,
          status,
          performance_status,
          completed_at,
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
            status,
            facilities (
              id,
              name,
              facility_type,
              address,
              description
            )
          )
          `
        )
        .eq("performer_id", performer.id)
        .order("matched_at", {
          ascending: false,
        });

    if (matchesError) {
      console.error(
        "演奏者マッチング取得エラー:",
        matchesError
      );

      return NextResponse.json(
        {
          error:
            "マッチング情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      matches: matches ?? [],
    });
  } catch (error) {
    console.error(
      "演奏者マッチングAPIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "マッチング情報の取得中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}