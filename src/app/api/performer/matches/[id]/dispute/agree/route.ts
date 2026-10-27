import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

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

    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!idToken) {
      return NextResponse.json(
        { error: "LINEの本人確認情報がありません。再ログインしてください。" },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
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
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // マッチングを取得し、個人かバンドかを確認する
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("id, performer_id, band_id")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) {
      console.error("取り下げ同意対象の取得エラー:", matchError);

      return NextResponse.json(
        { error: "マッチング情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!match) {
      return NextResponse.json(
        { error: "マッチングが見つからないか、操作する権限がありません" },
        { status: 404 }
      );
    }

    if (match.band_id) {
      // バンドマッチングは、現在のアクティブなリーダーだけが同意可能
      const { data: membership, error: membershipError } = await supabase
        .from("band_members")
        .select("role")
        .eq("band_id", match.band_id)
        .eq("performer_id", performer.id)
        .eq("status", "active")
        .maybeSingle();

      if (membershipError) {
        console.error("バンド取り下げ同意権限の確認エラー:", membershipError);

        return NextResponse.json(
          { error: "操作権限を確認できませんでした" },
          { status: 500 }
        );
      }

      if (!membership || membership.role !== "leader") {
        return NextResponse.json(
          { error: "バンドの取り下げ同意はリーダーのみ行えます" },
          { status: 403 }
        );
      }
    } else {
      // 個人マッチングは従来どおり本人だけが同意可能
      if (match.performer_id !== performer.id) {
        return NextResponse.json(
          { error: "マッチングが見つからないか、操作する権限がありません" },
          { status: 404 }
        );
      }
    }

    const { data, error } = await supabase.rpc(
      "agree_completion_dispute",
      {
        p_match_id: matchId,
        p_side: "performer",
      }
    );

    if (error) {
      console.error("演奏者側の取り下げ同意エラー:", error);

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
    console.error("演奏者側の取り下げ同意APIエラー:", error);

    return NextResponse.json(
      { error: "取り下げへの同意処理に失敗しました" },
      { status: 500 }
    );
  }
}