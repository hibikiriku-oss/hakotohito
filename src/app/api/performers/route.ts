import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: performers, error: performersError } =
      await supabase
        .from("performers")
        .select(`
          id,
          user_id,
          name,
          instruments,
          genres,
          area,
          bio,
          created_at,
          users (
            id,
            display_name,
            picture_url
          )
        `)
        .order("created_at", {
          ascending: false,
        });

    if (performersError) {
      console.error(
        "演奏者一覧取得エラー:",
        performersError
      );

      return NextResponse.json(
        {
          error: "演奏者一覧の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    const userIds = (performers || [])
      .map((performer) => performer.user_id)
      .filter(Boolean);

    let reviews: {
      reviewee_id: string;
      rating: number;
    }[] = [];

    if (userIds.length > 0) {
      const { data: reviewData, error: reviewError } =
        await supabase
          .from("reviews")
          .select("reviewee_id, rating")
          .in("reviewee_id", userIds);

      if (reviewError) {
        console.error(
          "評価取得エラー:",
          reviewError
        );
      } else {
        reviews = reviewData || [];
      }
    }

    const performersWithReviews = (performers || []).map(
      (performer) => {
        const performerReviews = reviews.filter(
          (review) =>
            review.reviewee_id === performer.user_id
        );

        const reviewCount =
          performerReviews.length;

        const averageRating =
          reviewCount > 0
            ? performerReviews.reduce(
                (sum, review) =>
                  sum + review.rating,
                0
              ) / reviewCount
            : null;

        return {
          ...performer,
          review_count: reviewCount,
          average_rating: averageRating,
        };
      }
    );

    return NextResponse.json({
      performers: performersWithReviews,
    });
  } catch (error) {
    console.error(
      "演奏者一覧取得エラー:",
      error
    );

    return NextResponse.json(
      {
        error: "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      name,
      area,
      instruments,
      genres,
      bio,
    } = body;

    if (!name || !area || !instruments || !genres) {
      return NextResponse.json(
        {
          error:
            "必要な情報が入力されていません",
        },
        { status: 400 }
      );
    }

    const lineUserId = request.headers.get(
      "x-line-user-id"
    );

    if (!lineUserId) {
      return NextResponse.json(
        {
          error:
            "LINEユーザー情報がありません",
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
          error:
            "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("performers")
      .upsert(
        {
          user_id: user.id,
          name,
          area,
          instruments,
          genres,
          bio,
        },
        {
          onConflict: "user_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error(
        "performer登録エラー:",
        error
      );

      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      performer: data,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}