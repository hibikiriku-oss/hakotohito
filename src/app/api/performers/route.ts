import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // LINE IDトークンを検証
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!idToken) {
      return NextResponse.json(
        { error: "ログインが必要です。再ログインしてください。" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

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
          areas,
          bio,
          status_level,
          created_at,
          users (
            display_name,
            picture_url,
            avatar_type,
            avatar_emoji
          )
        `)
        .order("created_at", {
          ascending: false,
        });

    if (performersError) {
      console.error("演奏者一覧取得エラー:", performersError);

      return NextResponse.json(
        { error: "演奏者一覧の取得に失敗しました" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const performerList = performers || [];
    const performerIds = performerList.map(
      (performer) => performer.id
    );
    const userIds = performerList
      .map((performer) => performer.user_id)
      .filter(Boolean);

    let completedMatchIds: string[] = [];

    if (performerIds.length > 0) {
      const { data: completedMatches, error: matchesError } =
        await supabase
          .from("matches")
          .select("id")
          .in("performer_id", performerIds)
          .eq("performance_status", "completed")
          .not("completed_at", "is", null);

      if (matchesError) {
        console.error("完了済みマッチング取得エラー:", matchesError);

        return NextResponse.json(
          { error: "評価情報の取得に失敗しました" },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }

      completedMatchIds = (completedMatches || []).map(
        (match) => match.id
      );
    }

    let reviews: {
      reviewee_id: string;
      rating: number;
    }[] = [];

    if (userIds.length > 0 && completedMatchIds.length > 0) {
      const { data: reviewData, error: reviewError } =
        await supabase
          .from("reviews")
          .select("reviewee_id, rating")
          .in("reviewee_id", userIds)
          .in("match_id", completedMatchIds);

      if (reviewError) {
        console.error("評価取得エラー:", reviewError);

        return NextResponse.json(
          { error: "評価情報の取得に失敗しました" },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }

      reviews = reviewData || [];
    }

    const performersWithReviews = performerList.map(
      (performer) => {
        const performerReviews = reviews.filter(
          (review) => review.reviewee_id === performer.user_id
        );

        const reviewCount = performerReviews.length;

        const averageRating =
          reviewCount > 0
            ? Number(
                (
                  performerReviews.reduce(
                    (sum, review) => sum + review.rating,
                    0
                  ) / reviewCount
                ).toFixed(1)
              )
            : null;

        // 内部処理用のuser_idはレスポンスに含めない
        const {
          user_id: _userId,
          ...publicPerformer
        } = performer;

        return {
          ...publicPerformer,
          areas:
            performer.areas?.length > 0
              ? performer.areas
              : performer.area
                ? [performer.area]
                : [],
          review_count: reviewCount,
          average_rating: averageRating,
        };
      }
    );

    return NextResponse.json(
      {
        performers: performersWithReviews,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("演奏者一覧取得エラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      name,
      area,
      areas: submittedAreas,
      instruments,
      genres,
      bio,
      status_level,
      avatarType,
      avatarEmoji,
    } = body;

    const normalizedAreas: string[] = Array.isArray(submittedAreas)
      ? [
          ...new Set(
            submittedAreas
              .filter(
                (item: unknown): item is string =>
                  typeof item === "string"
              )
              .map((item: string) => item.trim())
              .filter(Boolean)
          ),
        ]
      : typeof area === "string" && area.trim()
        ? [area.trim()]
        : [];

    const primaryArea =
      typeof area === "string" && area.trim()
        ? area.trim()
        : normalizedAreas[0] || "";

    if (
      typeof name !== "string" ||
      !name.trim() ||
      normalizedAreas.length === 0 ||
      !Array.isArray(instruments) ||
      instruments.length === 0 ||
      !Array.isArray(genres) ||
      genres.length === 0
    ) {
      return NextResponse.json(
        { error: "名前・活動エリア・楽器・ジャンルを入力してください" },
        { status: 400 }
      );
    }

    const validStatusLevels = ["beginner", "amateur", "pro"];

    if (
      status_level &&
      !validStatusLevels.includes(status_level)
    ) {
      return NextResponse.json(
        { error: "演奏者レベルの値が正しくありません" },
        { status: 400 }
      );
    }

    // アイコン設定の検証
    const normalizedAvatarType =
      avatarType === "emoji" ? "emoji" : "line";

    if (
      avatarType !== undefined &&
      avatarType !== "line" &&
      avatarType !== "emoji"
    ) {
      return NextResponse.json(
        { error: "アイコンの種類が正しくありません" },
        { status: 400 }
      );
    }

    if (
      normalizedAvatarType === "emoji" &&
      (typeof avatarEmoji !== "string" || !avatarEmoji.trim())
    ) {
      return NextResponse.json(
        { error: "絵文字アイコンを選択してください" },
        { status: 400 }
      );
    }

    // LINE IDトークンを検証
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!idToken) {
      return NextResponse.json(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const lineUserId = verified.userId;

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // usersテーブルにアイコン設定を保存
    const { error: avatarError } = await supabase
      .from("users")
      .update({
        avatar_type: normalizedAvatarType,
        avatar_emoji:
          normalizedAvatarType === "emoji"
            ? avatarEmoji.trim()
            : null,
      })
      .eq("id", user.id);

    if (avatarError) {
      console.error("アイコン設定保存エラー:", avatarError);

      return NextResponse.json(
        { error: "プロフィールアイコンの保存に失敗しました" },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from("performers")
      .upsert(
        {
          user_id: user.id,
          name: name.trim(),
          area: primaryArea,
          areas: normalizedAreas,
          instruments: [
            ...new Set(
              instruments
                .filter((item: unknown) => typeof item === "string")
                .map((item: string) => item.trim())
                .filter(Boolean)
            ),
          ],
          genres: [
            ...new Set(
              genres
                .filter((item: unknown) => typeof item === "string")
                .map((item: string) => item.trim())
                .filter(Boolean)
            ),
          ],
          bio: typeof bio === "string" ? bio : "",
          status_level: status_level || null,
        },
        {
          onConflict: "user_id",
        }
      )
      .select()
      .single();

    if (error) {
      console.error("performer登録エラー:", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      performer: data,
    });
  } catch (error) {
    console.error("演奏者登録エラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}