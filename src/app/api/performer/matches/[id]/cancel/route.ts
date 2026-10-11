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

    // 演奏者プロフィールを取得
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

    // 自分のマッチングか確認
    const { data: match, error: matchError } =
      await supabase
        .from("matches")
        .select(
          `
          id,
          performer_id,
          status,
          performance_status
          `
        )
        .eq("id", matchId)
        .eq("performer_id", performer.id)
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

    // すでにキャンセル済み
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

    // すでに演奏完了している場合はキャンセル不可
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

    // アクティブなマッチング以外はキャンセル不可
    if (match.status !== "active") {
      return NextResponse.json(
        {
          error:
            "このマッチングは現在キャンセルできません",
        },
        { status: 400 }
      );
    }

    // マッチングをキャンセル
    const { data: updatedMatch, error: updateError } =
      await supabase
        .from("matches")
        .update({
          status: "cancelled",
          performance_status: "cancelled",
        })
        .eq("id", matchId)
        .eq("performer_id", performer.id)
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
      "マッチングキャンセルAPIエラー:",
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