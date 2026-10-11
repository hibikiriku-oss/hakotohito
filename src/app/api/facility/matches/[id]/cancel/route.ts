import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
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

    const { id: matchId } =
      await context.params;

    if (!matchId) {
      return NextResponse.json(
        {
          error:
            "マッチングIDが指定されていません",
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
          error:
            "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    const { data: match, error: matchError } =
      await supabase
        .from("matches")
        .select(
          `
          id,
          request_id,
          performer_id,
          status,
          performance_status,
          performance_requests!inner (
            id,
            facility_id
          )
          `
        )
        .eq("id", matchId)
        .eq(
          "performance_requests.facility_id",
          facility.id
        )
        .single();

    if (matchError || !match) {
      console.error(
        "マッチング取得エラー:",
        matchError
      );

      return NextResponse.json(
        {
          error:
            "マッチング情報が見つからないか、キャンセルする権限がありません",
        },
        { status: 404 }
      );
    }

    if (
      match.status === "cancelled" ||
      match.performance_status ===
        "cancelled"
    ) {
      return NextResponse.json(
        {
          error:
            "このマッチングはすでにキャンセルされています",
        },
        { status: 400 }
      );
    }

    if (
      match.performance_status ===
      "completed"
    ) {
      return NextResponse.json(
        {
          error:
            "演奏完了後のマッチングはキャンセルできません",
        },
        { status: 400 }
      );
    }

    if (match.status !== "active") {
      return NextResponse.json(
        {
          error:
            "このマッチングは現在キャンセルできません",
        },
        { status: 400 }
      );
    }

    const { data: updatedMatch, error: updateError } =
      await supabase
        .from("matches")
        .update({
          status: "cancelled",
          performance_status: "cancelled",
        })
        .eq("id", matchId)
        .select(
          `
          id,
          request_id,
          performer_id,
          matched_at,
          status,
          performance_status,
          completed_at
          `
        )
        .single();

    if (updateError) {
      console.error(
        "マッチングキャンセル更新エラー:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "マッチングのキャンセルに失敗しました",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "マッチングをキャンセルしました",
      match: updatedMatch,
    });
  } catch (error) {
    console.error(
      "施設側マッチングキャンセルAPIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "マッチングのキャンセル中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}