import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getCurrentPerformer(lineUserId: string) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (userError) {
    throw new Error(`ユーザー取得エラー: ${userError.message}`);
  }

  if (!user) return null;

  const { data: performer, error: performerError } = await supabase
    .from("performers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (performerError) {
    throw new Error(`演奏者プロフィール取得エラー: ${performerError.message}`);
  }

  return performer;
}

// レッスン募集の詳細取得
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    // UUID形式を確認
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(id)) {
      return NextResponse.json(
        { error: "レッスン募集IDが正しくありません" },
        { status: 400 }
      );
    }

    const lineUserId = request.headers.get("x-line-user-id");
    let currentPerformerId: string | null = null;

    if (lineUserId) {
      const performer = await getCurrentPerformer(lineUserId);
      currentPerformerId = performer?.id ?? null;
    }

    const { data: offer, error } = await supabase
      .from("lesson_offers")
      .select(`
        id,
        performer_id,
        title,
        description,
        instruments,
        genres,
        area,
        lesson_date,
        start_time,
        end_time,
        lesson_fee,
        capacity,
        target_levels,
        status,
        created_at,
        performers (
          id,
          user_id,
          name,
          area,
          areas,
          instruments,
          genres,
          bio,
          status_level,
          users (
            display_name,
            picture_url
          )
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("レッスン募集詳細取得エラー:", error);

      return NextResponse.json(
        { error: "レッスン募集の詳細を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!offer) {
      return NextResponse.json(
        { error: "レッスン募集が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      offer: {
        ...offer,
        is_mine: Boolean(
          currentPerformerId &&
            offer.performer_id === currentPerformerId
        ),
      },
    });
  } catch (error) {
    console.error("レッスン募集詳細APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}