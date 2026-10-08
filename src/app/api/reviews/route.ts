import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getUserByLineUserId(lineUserId: string) {
  const { data: user, error } = await supabase
    .from("users")
    .select("id, user_type")
    .eq("line_user_id", lineUserId)
    .single();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function GET(request: NextRequest) {
  try {
    const lineUserId = request.headers.get("x-line-user-id");
    const matchId = request.nextUrl.searchParams.get("match_id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 401 }
      );
    }

    if (!matchId) {
      return NextResponse.json(
        { error: "マッチングIDがありません" },
        { status: 400 }
      );
    }

    const user = await getUserByLineUserId(lineUserId);

    if (!user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        performers (
          user_id
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !match) {
      return NextResponse.json(
        { error: "マッチングが見つかりません" },
        { status: 404 }
      );
    }

    const performer = Array.isArray(match.performers)
      ? match.performers[0]
      : match.performers;

    if (!performer) {
      return NextResponse.json(
        { error: "演奏者情報が見つかりません" },
        { status: 404 }
      );
    }

    const performerUserId = performer.user_id;

    let isParticipant = false;
    let revieweeId: string | null = null;

    if (user.user_type === "performer") {
      if (performerUserId === user.id) {
        isParticipant = true;

        const { data: requestData, error: requestError } =
          await supabase
            .from("performance_requests")
            .select(`
              facility_id,
              facilities (
                user_id
              )
            `)
            .eq("id", match.request_id)
            .single();

        if (!requestError && requestData) {
          const facility = Array.isArray(requestData.facilities)
            ? requestData.facilities[0]
            : requestData.facilities;

          if (facility) {
            revieweeId = facility.user_id;
          }
        }
      }
    }

    if (user.user_type === "facility") {
      const { data: requestData, error: requestError } =
        await supabase
          .from("performance_requests")
          .select("facility_id")
          .eq("id", match.request_id)
          .single();

      if (!requestError && requestData) {
        const { data: facility, error: facilityError } =
          await supabase
            .from("facilities")
            .select("user_id")
            .eq("id", requestData.facility_id)
            .single();

        if (!facilityError && facility && facility.user_id === user.id) {
          isParticipant = true;
          revieweeId = performerUserId;
        }
      }
    }

    if (!isParticipant || !revieweeId) {
      return NextResponse.json(
        { error: "このマッチングを評価する権限がありません" },
        { status: 403 }
      );
    }

    const { data: review, error: reviewError } = await supabase
      .from("reviews")
      .select("id, rating, comment, created_at")
      .eq("match_id", matchId)
      .eq("reviewer_id", user.id)
      .maybeSingle();

    if (reviewError) {
      console.error("評価確認エラー:", reviewError);

      return NextResponse.json(
        { error: "評価情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      reviewed: !!review,
      review: review || null,
      reviewee_id: revieweeId,
    });
  } catch (error) {
    console.error("評価確認APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 401 }
      );
    }

    const user = await getUserByLineUserId(lineUserId);

    if (!user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    const body = await request.json();

    const matchId =
      typeof body.match_id === "string"
        ? body.match_id
        : "";

    const rating = Number(body.rating);

    const comment =
      typeof body.comment === "string"
        ? body.comment.trim()
        : "";

    if (!matchId) {
      return NextResponse.json(
        { error: "マッチングIDがありません" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "評価は1〜5の整数で入力してください" },
        { status: 400 }
      );
    }

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        performers (
          user_id
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !match) {
      return NextResponse.json(
        { error: "マッチングが見つかりません" },
        { status: 404 }
      );
    }

    const performer = Array.isArray(match.performers)
      ? match.performers[0]
      : match.performers;

    if (!performer) {
      return NextResponse.json(
        { error: "演奏者情報が見つかりません" },
        { status: 404 }
      );
    }

    const performerUserId = performer.user_id;

    let isParticipant = false;
    let revieweeId: string | null = null;

    if (user.user_type === "performer") {
      if (performerUserId === user.id) {
        const { data: requestData, error: requestError } =
          await supabase
            .from("performance_requests")
            .select(`
              facility_id,
              facilities (
                user_id
              )
            `)
            .eq("id", match.request_id)
            .single();

        if (!requestError && requestData) {
          const facility = Array.isArray(requestData.facilities)
            ? requestData.facilities[0]
            : requestData.facilities;

          if (facility) {
            isParticipant = true;
            revieweeId = facility.user_id;
          }
        }
      }
    }

    if (user.user_type === "facility") {
      const { data: requestData, error: requestError } =
        await supabase
          .from("performance_requests")
          .select("facility_id")
          .eq("id", match.request_id)
          .single();

      if (!requestError && requestData) {
        const { data: facility, error: facilityError } =
          await supabase
            .from("facilities")
            .select("user_id")
            .eq("id", requestData.facility_id)
            .single();

        if (!facilityError && facility && facility.user_id === user.id) {
          isParticipant = true;
          revieweeId = performerUserId;
        }
      }
    }

    if (!isParticipant || !revieweeId) {
      return NextResponse.json(
        { error: "このマッチングを評価する権限がありません" },
        { status: 403 }
      );
    }

    const { data: existingReview, error: existingReviewError } =
      await supabase
        .from("reviews")
        .select("id")
        .eq("match_id", matchId)
        .eq("reviewer_id", user.id)
        .maybeSingle();

    if (existingReviewError) {
      console.error("既存評価確認エラー:", existingReviewError);

      return NextResponse.json(
        { error: "評価情報の確認に失敗しました" },
        { status: 500 }
      );
    }

    if (existingReview) {
      return NextResponse.json(
        { error: "このマッチングはすでに評価済みです" },
        { status: 400 }
      );
    }

    const { data: review, error: reviewError } = await supabase
      .from("reviews")
      .insert({
        match_id: matchId,
        reviewer_id: user.id,
        reviewee_id: revieweeId,
        rating,
        comment: comment || null,
      })
      .select()
      .single();

    if (reviewError || !review) {
      console.error("評価登録エラー:", reviewError);

      return NextResponse.json(
        { error: "評価の登録に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "評価を登録しました",
      review,
    });
  } catch (error) {
    console.error("評価登録APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}