import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id: matchId } = await params;

    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザーIDがありません",
        },
        { status: 401 }
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
          error: "ユーザーが見つかりません",
        },
        { status: 404 }
      );
    }

    // 演奏者プロフィールを取得
    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      return NextResponse.json(
        {
          error: "演奏者プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 自分が参加しているマッチングか確認
    const {
      data: match,
      error: matchError,
    } = await supabase
      .from("matches")
      .select(
        "id, request_id, performer_id, status, performance_status, completed_at"
      )
      .eq("id", matchId)
      .eq("performer_id", performer.id)
      .single();

    if (matchError || !match) {
      return NextResponse.json(
        {
          error: "マッチングが見つかりません",
        },
        { status: 404 }
      );
    }

    // キャンセル済みの場合
    if (match.status === "cancelled") {
      return NextResponse.json(
        {
          error: "キャンセルされたマッチングです",
        },
        { status: 400 }
      );
    }

    // すでに完了している場合
    if (match.performance_status === "completed") {
      return NextResponse.json(
        {
          error: "この演奏はすでに完了しています",
        },
        { status: 400 }
      );
    }

    // 演奏完了に更新
    const completedAt =
      new Date().toISOString();

    const {
      data: updatedMatch,
      error: updateError,
    } = await supabase
      .from("matches")
      .update({
        performance_status: "completed",
        completed_at: completedAt,
      })
      .eq("id", matchId)
      .select(
        "id, request_id, performer_id, status, performance_status, completed_at"
      )
      .single();

    if (updateError || !updatedMatch) {
      console.error(
        "マッチング完了更新エラー:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "演奏完了の更新に失敗しました",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "演奏を完了しました",
      match: updatedMatch,
    });
  } catch (error) {
    console.error(
      "演奏完了APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "演奏完了処理に失敗しました",
      },
      { status: 500 }
    );
  }
}
