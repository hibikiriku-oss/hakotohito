import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          error: "演奏者IDが指定されていません",
        },
        { status: 400 }
      );
    }

    // 演奏者情報を取得
    const { data: performer, error } = await supabase
      .from("performers")
      .select(
        `
        id,
        user_id,
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
        `
      )
      .eq("id", id)
      .single();

    if (error) {
      console.error("performer取得エラー:", error);

      return NextResponse.json(
        {
          error: "演奏者情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    if (!performer) {
      return NextResponse.json(
        {
          error: "演奏者が見つかりません",
        },
        { status: 404 }
      );
    }

    // 演奏者に対するレビューを取得
    const { data: reviews, error: reviewsError } =
      await supabase
        .from("reviews")
        .select(
          `
          rating,
          comment,
          created_at
          `
        )
        .eq("reviewee_id", performer.user_id)
        .order("created_at", {
          ascending: false,
        });

    if (reviewsError) {
      console.error(
        "レビュー取得エラー:",
        reviewsError
      );

      return NextResponse.json(
        {
          error: "レビュー情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    // レビュー件数
    const reviewCount = reviews?.length ?? 0;

    // 平均評価
    const rating =
      reviewCount > 0
        ? Number(
            (
              reviews!.reduce(
                (sum, review) =>
                  sum + review.rating,
                0
              ) / reviewCount
            ).toFixed(1)
          )
        : null;

    return NextResponse.json({
      performer,
      rating,
      review_count: reviewCount,
      reviews: reviews ?? [],
    });
  } catch (error) {
    console.error(
      "演奏者APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "演奏者情報の取得中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}