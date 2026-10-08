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
        { error: "依頼IDが指定されていません" },
        { status: 400 }
      );
    }

    // LINEユーザーIDを取得
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザーIDが取得できません" },
        { status: 401 }
      );
    }

    // LINEユーザーからユーザー情報を取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, line_user_id, display_name, picture_url, user_type")
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
    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id, user_id, name, instruments, genres, area, bio")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error("演奏者取得エラー:", performerError);

      return NextResponse.json(
        { error: "演奏者情報が見つかりません" },
        { status: 404 }
      );
    }

    // 施設からの依頼を取得
    const { data: application, error: applicationError } = await supabase
      .from("applications")
      .select(`
        id,
        request_id,
        performer_id,
        message,
        status,
        source,
        created_at,
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
          status,
          facility_id,
          facilities (
            id,
            user_id,
            name,
            facility_type,
            address,
            description
          )
        )
      `)
      .eq("id", id)
      .eq("performer_id", performer.id)
      .eq("source", "facility_invite")
      .single();

    if (applicationError) {
      console.error("依頼取得エラー:", applicationError);

      return NextResponse.json(
        { error: "依頼情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!application) {
      return NextResponse.json(
        { error: "依頼が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      invitation: application,
    });
  } catch (error) {
    console.error("演奏依頼詳細APIエラー:", error);

    return NextResponse.json(
      { error: "依頼情報の取得中にエラーが発生しました" },
      { status: 500 }
    );
  }
}