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
          error: "施設IDが指定されていません",
        },
        { status: 400 }
      );
    }

    const { data: facility, error } = await supabase
      .from("facilities")
      .select(
        `
        id,
        user_id,
        name,
        facility_type,
        address,
        description
        `
      )
      .eq("id", id)
      .single();

    if (error) {
      console.error("facility取得エラー:", error);

      return NextResponse.json(
        {
          error: "施設情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    if (!facility) {
      return NextResponse.json(
        {
          error: "施設が見つかりません",
        },
        { status: 404 }
      );
    }

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
        .eq("reviewee_id", facility.user_id)
        .order("created_at", {
          ascending: false,
        });

    if (reviewsError) {
      console.error("レビュー取得エラー:", reviewsError);

      return NextResponse.json(
        {
          error: "レビュー情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    const reviewCount = reviews?.length ?? 0;

    const rating =
      reviewCount > 0
        ? Number(
            (
              reviews!.reduce(
                (sum, review) => sum + review.rating,
                0
              ) / reviewCount
            ).toFixed(1)
          )
        : null;

    return NextResponse.json({
      facility,
      rating,
      review_count: reviewCount,
      reviews: reviews ?? [],
    });
  } catch (error) {
    console.error("施設APIエラー:", error);

    return NextResponse.json(
      {
        error: "施設情報の取得中にエラーが発生しました",
      },
      { status: 500 }
    );
  }
}