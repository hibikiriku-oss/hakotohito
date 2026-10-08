import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Supabaseの環境変数が設定されていません"
  );
}

const supabase = createClient(
  supabaseUrl,
  supabaseKey
);

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
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

    // ==============================
    // 演奏者取得
    // ==============================

    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select("id, user_id, name")
      .eq("id", id)
      .single();

    if (performerError || !performer) {
      console.error(
        "演奏者取得エラー:",
        performerError
      );

      return NextResponse.json(
        {
          error: "演奏者が見つかりません",
        },
        { status: 404 }
      );
    }

    // ==============================
    // 評価取得
    // ==============================

    const {
      data: reviews,
      error: reviewsError,
    } = await supabase
      .from("reviews")
      .select(
        "id, rating, comment, created_at, reviewer_id"
      )
      .eq("reviewee_id", performer.user_id)
      .order("created_at", {
        ascending: false,
      });

    if (reviewsError) {
      console.error(
        "評価取得エラー:",
        reviewsError
      );

      return NextResponse.json(
        {
          error: "評価の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    const reviewList = reviews || [];

    // ==============================
    // 平均評価
    // ==============================

    const reviewCount = reviewList.length;

    const averageRating =
      reviewCount > 0
        ? reviewList.reduce(
            (total, review) =>
              total + review.rating,
            0
          ) / reviewCount
        : 0;

    // ==============================
    // 評価者の表示名取得
    // ==============================

    const reviewerIds = Array.from(
      new Set(
        reviewList.map(
          (review) => review.reviewer_id
        )
      )
    );

    let reviewerMap: Record<
      string,
      string
    > = {};

    if (reviewerIds.length > 0) {
      const {
        data: reviewers,
        error: reviewersError,
      } = await supabase
        .from("users")
        .select("id, display_name")
        .in("id", reviewerIds);

      if (reviewersError) {
        console.error(
          "評価者取得エラー:",
          reviewersError
        );
      } else {
        reviewerMap = Object.fromEntries(
          (reviewers || []).map(
            (reviewer) => [
              reviewer.id,
              reviewer.display_name ||
                "匿名ユーザー",
            ]
          )
        );
      }
    }

    // ==============================
    // レスポンス
    // ==============================

    const formattedReviews =
      reviewList.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        created_at: review.created_at,
        reviewer_name:
          reviewerMap[review.reviewer_id] ||
          "匿名ユーザー",
      }));

    return NextResponse.json({
      performer: {
        id: performer.id,
        name: performer.name,
      },
      average_rating:
        Math.round(averageRating * 10) / 10,
      review_count: reviewCount,
      reviews: formattedReviews,
    });

  } catch (error) {
    console.error(
      "演奏者評価APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "評価情報の取得に失敗しました",
      },
      { status: 500 }
    );
  }
}