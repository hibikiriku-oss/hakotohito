import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params;
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザーIDがありません" },
        { status: 401 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      return NextResponse.json(
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    const { data: rawMatch, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        performance_requests!inner (
          facility_id
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !rawMatch) {
      return NextResponse.json(
        { error: "マッチングが見つかりません" },
        { status: 404 }
      );
    }

    const match = rawMatch as unknown as {
      id: string;
      performance_requests:
        | { facility_id: string }
        | { facility_id: string }[];
    };

    const performanceRequest = Array.isArray(match.performance_requests)
      ? match.performance_requests[0]
      : match.performance_requests;

    if (
      !performanceRequest ||
      performanceRequest.facility_id !== facility.id
    ) {
      return NextResponse.json(
        { error: "このマッチングを操作する権限がありません" },
        { status: 403 }
      );
    }

    const { data, error } = await supabase.rpc(
      "agree_completion_dispute",
      {
        p_match_id: matchId,
        p_side: "facility",
      }
    );

    if (error) {
      console.error("施設側の取り下げ同意エラー:", error);

      if (error.message.includes("no_active_dispute")) {
        return NextResponse.json(
          { error: "現在、取り下げ対象の異議申し立てはありません" },
          { status: 409 }
        );
      }

      if (error.message.includes("match_not_active")) {
        return NextResponse.json(
          { error: "現在の演奏状況では同意を登録できません" },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "取り下げへの同意登録に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("施設側の取り下げ同意APIエラー:", error);

    return NextResponse.json(
      { error: "取り下げへの同意処理に失敗しました" },
      { status: 500 }
    );
  }
}