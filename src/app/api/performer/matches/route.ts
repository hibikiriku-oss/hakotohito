import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest
) {
  try {
    // LINEユーザーID取得
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error:
            "LINEユーザー情報がありません",
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
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        {
          error:
            "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 演奏者を取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .single();

    if (performerError || !performer) {
      console.error(
        "演奏者取得エラー:",
        performerError
      );

      return NextResponse.json(
        {
          error:
            "演奏者プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // マッチング一覧を取得
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
            status,
            facilities (
              id,
              name,
              facility_type,
              address,
              description
            )
          )
        `)
        .eq("performer_id", performer.id)
        .order("matched_at", {
          ascending: false,
        });

    if (matchesError) {
      console.error(
        "マッチング取得エラー:",
        matchesError
      );

      return NextResponse.json(
        {
          error:
            matchesError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      matches: matches || [],
    });

  } catch (error) {
    console.error(
      "演奏者マッチングAPIエラー:",
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