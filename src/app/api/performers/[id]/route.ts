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
        { error: "演奏者IDが指定されていません" },
        { status: 400 }
      );
    }

    const { data: performer, error } = await supabase
      .from("performers")
      .select(`
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
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Performer lookup failed:", error);
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

    let reviews: {
      rating: number;
      comment: string | null;
      created_at: string;
    }[] = [];

    if (completedMatchIds.length > 0) {
      const { data: completedReviews, error: reviewsError } = await supabase
        .from("reviews")
        .select("match_id, rating, comment, created_at")
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

      reviews = (completedReviews ?? []).map((review) => ({
        rating: review.rating,
        comment: review.comment,
        created_at: review.created_at,
      }));
    }

    const reviewCount = reviews.length;
    const rating =
      reviewCount > 0
        ? Number(
            (
              reviews.reduce((sum, review) => sum + review.rating, 0) /
              reviewCount
            ).toFixed(1)
          )
        : null;

    return NextResponse.json({
      performer,
      rating,
      review_count: reviewCount,
      reviews,
    });
  } catch (error) {
    console.error("Performer API error:", error);
    return NextResponse.json(
      { error: "演奏者情報の取得中にエラーが発生しました" },
      { status: 500 }
    );
  }
}