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
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    const { id: matchId } = await params;

    // LINEユーザー取得
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .single();

    if (performerError || !performer) {
      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // マッチング取得
    // performer_idも条件に入れて、本人のマッチングだけ取得
    const { data: match, error: matchError } =
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
        .eq("id", matchId)
        .eq("performer_id", performer.id)
        .single();

    if (matchError || !match) {
      console.error(
        "マッチング取得エラー:",
        matchError
      );

      return NextResponse.json(
        { error: "マッチング情報が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      match,
    });

  } catch (error) {
    console.error(
      "マッチング詳細APIエラー:",
      error
    );

    return NextResponse.json(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}