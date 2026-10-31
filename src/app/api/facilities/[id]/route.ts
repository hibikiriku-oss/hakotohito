import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // LINE IDトークンを検証し、ログイン済みの利用者に限定する
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!token) {
      return NextResponse.json(
        { error: "ログインが必要です。" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const verified = await verifyLineIdToken(token);

    if (!verified) {
      return NextResponse.json(
        { error: "認証に失敗しました。再度ログインしてください。" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "施設IDが指定されていません。" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select(`
        id,
        user_id,
        name,
        facility_type,
        address,
        description
      `)
      .eq("id", id)
      .maybeSingle();

    if (facilityError) {
      console.error("Facility lookup failed:", facilityError);
      return NextResponse.json(
        { error: "施設情報の取得に失敗しました。" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!facility) {
      return NextResponse.json(
        { error: "施設が見つかりません。" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 対象施設が登録した演奏案件を取得する
    const { data: facilityRequests, error: requestsError } = await supabase
      .from("performance_requests")
      .select("id")
      .eq("facility_id", facility.id);

    if (requestsError) {
      console.error("Facility performance requests lookup failed:", requestsError);
      return NextResponse.json(
        { error: "レビュー情報の取得に失敗しました。" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const requestIds = (facilityRequests ?? []).map(
      (performanceRequest) => performanceRequest.id
    );

    let completedMatches: { id: string }[] = [];

    if (requestIds.length > 0) {
      const { data, error: matchesError } = await supabase
        .from("matches")
        .select("id")
        .eq("performance_status", "completed")
        .not("completed_at", "is", null)
        .in("request_id", requestIds);

      if (matchesError) {
        console.error("Completed matches lookup failed:", matchesError);
        return NextResponse.json(
          { error: "レビュー情報の取得に失敗しました。" },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }

      completedMatches = data ?? [];
    }

    const completedMatchIds = completedMatches.map((match) => match.id);

    let reviews: {
      rating: number;
      comment: string | null;
      created_at: string;
    }[] = [];

    if (completedMatchIds.length > 0) {
      const { data: completedReviews, error: reviewsError } = await supabase
        .from("reviews")
        .select("match_id, rating, comment, created_at")
        .eq("reviewee_id", facility.user_id)
        .in("match_id", completedMatchIds)
        .order("created_at", { ascending: false });

      if (reviewsError) {
        console.error("Reviews lookup failed:", reviewsError);
        return NextResponse.json(
          { error: "レビュー情報の取得に失敗しました。" },
          { status: 500, headers: { "Cache-Control": "no-store" } }
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

    return NextResponse.json(
      {
        facility,
        rating,
        review_count: reviewCount,
        reviews,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Facility API error:", error);
    return NextResponse.json(
      { error: "施設情報の取得中にエラーが発生しました。" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}