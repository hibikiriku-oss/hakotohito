import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

export async function GET(request: NextRequest) {
  try {
    // LINE IDトークンを取得
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim() ?? "";

    if (!idToken) {
      return jsonResponse(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        401
      );
    }

    // LINE IDトークンを検証
    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return jsonResponse(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        401
      );
    }

    // 認証済みLINEユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .single();

    if (userError || !user) {
      return jsonResponse(
        {
          error: "ユーザー情報が見つかりません。",
        },
        404
      );
    }

    // 認証済みユーザーの施設を取得
    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      return jsonResponse(
        {
          error: "施設プロフィールが見つかりません。",
        },
        404
      );
    }

    // !inner を指定し、施設所有案件に紐づくマッチングだけを取得
    const { data: matches, error: matchesError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        matched_at,
        status,
        performance_status,
        completed_at,
        performance_requests!inner (
          id,
          title,
          description,
          performance_date,
          start_time,
          end_time,
          area,
          instruments,
          genres,
          reward,
          status,
          facility_id
        ),
        performers (
          id,
          name,
          instruments,
          genres,
          area,
          bio,
          users (
            display_name,
            picture_url,
            avatar_type,
            avatar_emoji
          )
        )
      `)
      .eq("performance_requests.facility_id", facility.id)
      .order("matched_at", {
        ascending: false,
      })
      .limit(200);

    if (matchesError) {
      console.error(
        "施設マッチング取得エラー:",
        matchesError.code ?? "UNKNOWN"
      );

      return jsonResponse(
        {
          error: "マッチング情報の取得に失敗しました。",
        },
        500
      );
    }

    return jsonResponse({
      matches: matches ?? [],
    });
  } catch (error) {
    console.error(
      "施設マッチングAPIエラー:",
      error instanceof Error ? error.name : "UNKNOWN"
    );

    return jsonResponse(
      {
        error: "サーバーエラーが発生しました。",
      },
      500
    );
  }
}