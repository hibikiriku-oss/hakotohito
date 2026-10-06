import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      title,
      description,
      performanceDate,
      startTime,
      endTime,
      area,
      instruments,
      genres,
      reward,
    } = body;

    // 必須項目チェック
    if (
      !title ||
      !performanceDate ||
      !startTime ||
      !endTime
    ) {
      return NextResponse.json(
        {
          error: "必須項目が入力されていません",
        },
        { status: 400 }
      );
    }

    // 時刻チェック
    if (startTime >= endTime) {
      return NextResponse.json(
        {
          error: "終了時間は開始時間より後にしてください",
        },
        { status: 400 }
      );
    }

    // LINEユーザーID取得
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    // users取得
    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        {
          error: "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // facilities取得
    const { data: facility, error: facilityError } =
      await supabase
        .from("facilities")
        .select("id")
        .eq("user_id", user.id)
        .single();

    if (facilityError || !facility) {
      console.error(
        "施設取得エラー:",
        facilityError
      );

      return NextResponse.json(
        {
          error: "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 演奏依頼を登録
    const { data, error } = await supabase
      .from("performance_requests")
      .insert({
        facility_id: facility.id,
        title,
        description: description || null,
        performance_date: performanceDate,
        start_time: startTime,
        end_time: endTime,
        area: area || null,
        instruments: instruments || [],
        genres: genres || [],
        reward:
          reward !== "" && reward !== null
            ? Number(reward)
            : null,
        status: "open",
      })
      .select()
      .single();

    if (error) {
      console.error(
        "演奏依頼登録エラー:",
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
      request: data,
    });
  } catch (error) {
    console.error(
      "演奏依頼APIエラー:",
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