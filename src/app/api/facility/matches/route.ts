import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
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

    // LINEユーザーを取得
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設を取得
    const {
      data: facility,
      error: facilityError,
    } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      return NextResponse.json(
        {
          error: "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設の案件に紐づくマッチングを取得
    const {
      data: matches,
      error: matchesError,
    } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        matched_at,
        status,
        performance_status,
        completed_at,
        performance_requests (
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
          status
        ),
        performers (
          id,
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
        )
      `)
      .eq(
        "performance_requests.facility_id",
        facility.id
      )
      .order("matched_at", {
        ascending: false,
      });

    if (matchesError) {
      console.error(
        "施設マッチング取得エラー:",
        matchesError
      );

      return NextResponse.json(
        {
          error: matchesError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      matches: matches || [],
    });
  } catch (error) {
    console.error(
      "施設マッチングAPIエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "サーバーエラー",
      },
      { status: 500 }
    );
  }
}