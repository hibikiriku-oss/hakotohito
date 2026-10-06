import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { requestId, message } = body;

    if (!requestId) {
      return NextResponse.json(
        { error: "案件IDがありません" },
        { status: 400 }
      );
    }

    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    // LINEユーザーからusersを取得
    const { data: user, error: userError } =
      await supabase
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

    // 演奏者情報を取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .single();

    if (performerError || !performer) {
      console.error(
        "演奏者取得エラー:",
        performerError
      );

      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // 案件が存在するか確認
    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select("id, status")
        .eq("id", requestId)
        .single();

    if (requestError || !performanceRequest) {
      console.error(
        "案件取得エラー:",
        requestError
      );

      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    // 募集中の案件だけ応募可能
    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        { error: "この案件は現在応募できません" },
        { status: 400 }
      );
    }

    // 応募登録
    const { data, error } = await supabase
      .from("applications")
      .insert({
        request_id: requestId,
        performer_id: performer.id,
        message: message || null,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      // unique(request_id, performer_id) による重複応募
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "この案件にはすでに応募しています" },
          { status: 409 }
        );
      }

      console.error(
        "応募登録エラー:",
        error
      );

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      application: data,
    });
  } catch (error) {
    console.error("応募APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}