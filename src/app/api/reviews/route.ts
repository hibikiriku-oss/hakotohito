import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_COMMENT_LENGTH = 1000;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() ?? "";
}

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
    const idToken = getBearerToken(request);

    const verified = idToken
      ? await verifyLineIdToken(idToken)
      : null;

    const lineUserId = verified?.userId;
    const matchId = request.nextUrl.searchParams.get("match_id");

    if (!lineUserId) {
      return jsonResponse(
        { error: "LINEユーザー情報がありません" },
        401
      );
    }

    if (!matchId || !UUID_PATTERN.test(matchId)) {
      return jsonResponse(
        { error: "マッチングIDが不正です" },
        400
      );
    }

    const user = await getUserByLineUserId(lineUserId);

    if (!user) {
      return jsonResponse(
        { error: "ユーザーが見つかりません" },
        404
      );
    }

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        performance_status,
        completed_at,
        performers (
          user_id
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !match) {
      return jsonResponse(
        { error: "マッチングが見つかりません" },
        404
      );
    }

    const performer = Array.isArray(match.performers)
      ? match.performers[0]
      : match.performers;

    if (!performer) {
      return jsonResponse(
        { error: "演奏者情報が見つかりません" },
        404
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
      return jsonResponse(
        { error: "このマッチングを評価する権限がありません" },
        403
      );
    }

    const { data: review, error: reviewError } = await supabase
      .from("reviews")
      .select("id, rating, comment, created_at")
      .eq("match_id", matchId)
      .eq("reviewer_id", user.id)
      .maybeSingle();

    if (reviewError) {
      console.error("評価確認エラー:", {
        code: reviewError.code,
      });

      return jsonResponse(
        { error: "評価情報の取得に失敗しました" },
        500
      );
    }

    return jsonResponse({
      reviewed: !!review,
      review: review || null,
      reviewee_id: revieweeId,
      performance_status: match.performance_status,
      completed_at: match.completed_at,
      can_review:
        match.performance_status === "completed" &&
        !!match.completed_at,
    });
  } catch (error) {
    console.error(
      "評価確認APIエラー:",
      error instanceof Error ? error.name : "UNKNOWN"
    );

    return jsonResponse(
      { error: "サーバーエラーが発生しました" },
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const idToken = getBearerToken(request);

    const verified = idToken
      ? await verifyLineIdToken(idToken)
      : null;

    const lineUserId = verified?.userId;

    if (!lineUserId) {
      return jsonResponse(
        { error: "LINEユーザー情報がありません" },
        401
      );
    }

    const user = await getUserByLineUserId(lineUserId);

    if (!user) {
      return jsonResponse(
        { error: "ユーザーが見つかりません" },
        404
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "リクエストのJSON形式が正しくありません" },
        400
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return jsonResponse(
        { error: "リクエスト内容が不正です" },
        400
      );
    }

    const data = body as Record<string, unknown>;

    const matchId =
      typeof data.match_id === "string"
        ? data.match_id.trim()
        : "";

    const rating = Number(data.rating);

    const comment =
      typeof data.comment === "string"
        ? data.comment.trim()
        : "";

    if (!matchId || !UUID_PATTERN.test(matchId)) {
      return jsonResponse(
        { error: "マッチングIDが不正です" },
        400
      );
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return jsonResponse(
        { error: "評価は1〜5の整数で入力してください" },
        400
      );
    }

    if (comment.length > MAX_COMMENT_LENGTH) {
      return jsonResponse(
        { error: "レビューコメントは1,000文字以内で入力してください" },
        400
      );
    }

    // 評価対象と権限を確認
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        performance_status,
        completed_at,
        performers (
          user_id
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !match) {
      return jsonResponse(
        { error: "マッチングが見つかりません" },
        404
      );
    }

    const performer = Array.isArray(match.performers)
      ? match.performers[0]
      : match.performers;

    if (!performer) {
      return jsonResponse(
        { error: "演奏者情報が見つかりません" },
        404
      );
    }

    const performerUserId = performer.user_id;
    let revieweeId: string | null = null;

    if (user.user_type === "performer") {
      if (performerUserId !== user.id) {
        return jsonResponse(
          { error: "このマッチングを評価する権限がありません" },
          403
        );
      }

      const { data: requestData, error: requestError } =
        await supabase
          .from("performance_requests")
          .select("facility_id")
          .eq("id", match.request_id)
          .single();

      if (requestError || !requestData) {
        return jsonResponse(
          { error: "依頼情報が見つかりません" },
          404
        );
      }

      const { data: facility, error: facilityError } =
        await supabase
          .from("facilities")
          .select("user_id")
          .eq("id", requestData.facility_id)
          .single();

      if (facilityError || !facility) {
        return jsonResponse(
          { error: "施設情報が見つかりません" },
          404
        );
      }

      revieweeId = facility.user_id;
    } else if (user.user_type === "facility") {
      const { data: requestData, error: requestError } =
        await supabase
          .from("performance_requests")
          .select("facility_id")
          .eq("id", match.request_id)
          .single();

      if (requestError || !requestData) {
        return jsonResponse(
          { error: "依頼情報が見つかりません" },
          404
        );
      }

      const { data: facility, error: facilityError } =
        await supabase
          .from("facilities")
          .select("user_id")
          .eq("id", requestData.facility_id)
          .single();

      if (facilityError || !facility || facility.user_id !== user.id) {
        return jsonResponse(
          { error: "このマッチングを評価する権限がありません" },
          403
        );
      }

      revieweeId = performerUserId;
    } else {
      return jsonResponse(
        { error: "このユーザー種別では評価できません" },
        403
      );
    }

    // SQL関数側でも完了状態・権限・二重評価を検証する
    const { data: result, error: rpcError } = await supabase.rpc(
      "create_review_with_reward",
      {
        p_match_id: matchId,
        p_reviewer_id: user.id,
        p_reviewee_id: revieweeId,
        p_rating: rating,
        p_comment: comment || null,
      }
    );

    if (rpcError || !result?.success) {
      console.error("評価登録・報酬付与エラー:", {
        code: rpcError?.code,
      });

      const message = rpcError?.message || "";

      if (message.includes("演奏完了後に評価できます")) {
        return jsonResponse(
          { error: "演奏完了後に評価できます" },
          400
        );
      }

      if (
        message.includes("すでに評価済み") ||
        message.includes("すでに付与")
      ) {
        return jsonResponse(
          { error: "このマッチングはすでに評価済みです" },
          400
        );
      }

      if (message.includes("権限がありません")) {
        return jsonResponse(
          { error: "このマッチングを評価する権限がありません" },
          403
        );
      }

      return jsonResponse(
        { error: "評価の登録に失敗しました" },
        500
      );
    }

    return jsonResponse({
      success: true,
      message: "評価を登録しました",
      review_id: result.reviewId,
      rewardAmount: result.rewardAmount,
      balanceAfter: result.balanceAfter,
    });
  } catch (error) {
    console.error(
      "評価登録APIエラー:",
      error instanceof Error ? error.name : "UNKNOWN"
    );

    return jsonResponse(
      { error: "サーバーエラーが発生しました" },
      500
    );
  }
}