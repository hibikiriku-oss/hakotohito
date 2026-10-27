import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim();

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

    const { id: matchId } = await params;

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者プロフィール取得
    const { data: performer, error: performerError } =
      await supabase
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

    // マッチング情報を取得
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
        band_id,
        matched_at,
        status,
        performance_status,
        completed_at,
        performer_completion_reported_at,
        facility_completion_reported_at,
        completion_disputed_at,
        completion_disputed_by,
        completion_dispute_reason,
        completion_dispute_facility_agreed_at,
        completion_dispute_performer_agreed_at,
        completion_method,
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
          facilities (
            id,
            name,
            facility_type,
            address,
            description
          )
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !match) {
      console.error("マッチング取得エラー:", matchError);

      return NextResponse.json(
        { error: "マッチング情報が見つかりません" },
        { status: 404 }
      );
    }

    let band: {
      id: string;
      name: string | null;
      description: string | null;
      status: string;
    } | null = null;

    let isBandLeader = false;

    if (match.band_id) {
      // 現在の所属状態を含めて取得する。
      // 解散済みバンドの過去履歴は、left のメンバーにも閲覧を許可する。
      const { data: membership, error: membershipError } =
        await supabase
          .from("band_members")
          .select("role, status")
          .eq("band_id", match.band_id)
          .eq("performer_id", performer.id)
          .maybeSingle();

      if (membershipError) {
        console.error("バンド所属確認エラー:", membershipError);

        return NextResponse.json(
          { error: "マッチングの閲覧権限を確認できませんでした" },
          { status: 500 }
        );
      }

      if (!membership) {
        return NextResponse.json(
          {
            error:
              "マッチングが見つからないか、閲覧する権限がありません",
          },
          { status: 404 }
        );
      }

      // バンド情報と状態を取得
      const { data: bandData, error: bandError } =
        await supabase
          .from("bands")
          .select("id, name, description, status")
          .eq("id", match.band_id)
          .maybeSingle();

      if (bandError) {
        console.error("バンド情報取得エラー:", bandError);

        return NextResponse.json(
          { error: "バンド情報の取得に失敗しました" },
          { status: 500 }
        );
      }

      if (!bandData) {
        return NextResponse.json(
          { error: "バンド情報が見つかりません" },
          { status: 404 }
        );
      }

      // 活動中バンド：現役のアクティブメンバーだけ許可
      if (
        bandData.status === "active" &&
        membership.status !== "active"
      ) {
        return NextResponse.json(
          {
            error:
              "マッチングが見つからないか、閲覧する権限がありません",
          },
          { status: 404 }
        );
      }

      // 解散済みバンド：所属履歴が残る元メンバーに限って閲覧許可
      if (
        bandData.status === "disbanded" &&
        membership.status !== "left"
      ) {
        return NextResponse.json(
          {
            error:
              "マッチングが見つからないか、閲覧する権限がありません",
          },
          { status: 404 }
        );
      }

      band = bandData;

      // 解散済みバンドは、元リーダーであっても操作権限を付与しない
      isBandLeader =
        bandData.status === "active" &&
        membership.status === "active" &&
        membership.role === "leader";
    } else {
      // 個人マッチングは従来どおり本人だけが閲覧可能
      if (match.performer_id !== performer.id) {
        return NextResponse.json(
          {
            error:
              "マッチングが見つからないか、閲覧する権限がありません",
          },
          { status: 404 }
        );
      }
    }

    const enrichedMatch = {
      ...match,
      band,
      isBandLeader,
    };

    return NextResponse.json({ match: enrichedMatch });
  } catch (error) {
    console.error("マッチング詳細APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}