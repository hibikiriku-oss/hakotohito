import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase environment variables are not configured");
}

const supabase = createClient(supabaseUrl, supabaseKey);

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "演奏者IDが指定されていません" },
        { status: 400 }
      );
    }

    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id, user_id, name")
      .eq("id", id)
      .maybeSingle();

    if (performerError) {
      console.error("Performer lookup failed:", performerError);
      return NextResponse.json(
        { error: "演奏者情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!performer) {
      return NextResponse.json(
        { error: "演奏者が見つかりません" },
        { status: 404 }
      );
    }

    // 完了済みの演奏に限定する
    const { data: completedMatches, error: matchesError } = await supabase
      .from("matches")
      .select("id")
      .eq("performer_id", performer.id)
      .eq("performance_status", "completed")
      .not("completed_at", "is", null);

    if (matchesError) {
      console.error("Completed matches lookup failed:", matchesError);
      return NextResponse.json(
        { error: "レビュー情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    const completedMatchIds = (completedMatches ?? []).map(
      (match) => match.id
    );

    let reviewList: {
      id: string;
      rating: number;
      comment: string | null;
      created_at: string;
      reviewer_id: string;
    }[] = [];

    if (completedMatchIds.length > 0) {
      const { data: reviews, error: reviewsError } = await supabase
        .from("reviews")
        .select("id, match_id, rating, comment, created_at, reviewer_id")
        .eq("reviewee_id", performer.user_id)
        .in("match_id", completedMatchIds)
        .order("created_at", { ascending: false });

      if (reviewsError) {
        console.error("Reviews lookup failed:", reviewsError);
        return NextResponse.json(
          { error: "レビュー情報の取得に失敗しました" },
          { status: 500 }
        );
      }

      reviewList = reviews ?? [];
    }

    const reviewCount = reviewList.length;
    const averageRating =
      reviewCount > 0
        ? reviewList.reduce((total, review) => total + review.rating, 0) /
          reviewCount
        : 0;

    const reviewerIds = Array.from(
      new Set(reviewList.map((review) => review.reviewer_id))
    );

    let reviewerMap: Record<string, string> = {};

    if (reviewerIds.length > 0) {
      const { data: reviewers, error: reviewersError } = await supabase
        .from("users")
        .select("id, display_name")
        .in("id", reviewerIds);

      if (reviewersError) {
        console.error("Reviewer lookup failed:", reviewersError);
      } else {
        reviewerMap = Object.fromEntries(
          (reviewers ?? []).map((reviewer) => [
            reviewer.id,
            reviewer.display_name || "匿名ユーザー",
          ])
        );
      }
    }

    const formattedReviews = reviewList.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      created_at: review.created_at,
      reviewer_name: reviewerMap[review.reviewer_id] || "匿名ユーザー",
    }));

    return NextResponse.json({
      performer: {
        id: performer.id,
        name: performer.name,
      },
      average_rating: Math.round(averageRating * 10) / 10,
      review_count: reviewCount,
      reviews: formattedReviews,
    });
  } catch (error) {
    console.error("Performer reviews API error:", error);
    return NextResponse.json(
      { error: "レビュー情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}