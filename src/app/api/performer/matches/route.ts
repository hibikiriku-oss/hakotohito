import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type BandMembership = {
  band_id: string;
  role: string;
};

type MatchRow = {
  id: string;
  request_id: string;
  performer_id: string;
  band_id: string | null;
  matched_at: string;
  status: string;
  performance_status: string;
  completed_at: string | null;
  [key: string]: any;
};

const MATCH_SELECT = `
  id,
  request_id,
  performer_id,
  band_id,
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
    status,
    facilities (
      id,
      name,
      facility_type,
      address,
      description
    )
  )
`;

export async function GET(request: NextRequest) {
  try {
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザーIDがありません" },
        { status: 401 }
      );
    }

    // ログインユーザーを取得
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

    // 演奏者プロフィールを取得
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

    // 現在所属しているバンドを取得
    const { data: memberships, error: membershipsError } = await supabase
      .from("band_members")
      .select("band_id, role")
      .eq("performer_id", performer.id)
      .eq("status", "active");

    if (membershipsError) {
      console.error("バンド所属情報の取得エラー:", membershipsError);

      return NextResponse.json(
        { error: "バンド所属情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    const activeMemberships = (memberships ?? []) as BandMembership[];
    const activeBandIds = [
      ...new Set(activeMemberships.map((membership) => membership.band_id)),
    ];

    // 個人のマッチングを取得
    const {
      data: personalMatches,
      error: personalMatchesError,
    } = await supabase
      .from("matches")
      .select(MATCH_SELECT)
      .eq("performer_id", performer.id)
      .order("matched_at", { ascending: false });

    if (personalMatchesError) {
      console.error("個人マッチングの取得エラー:", personalMatchesError);

      return NextResponse.json(
        { error: "マッチング情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    // 所属中のバンドのマッチングを取得
    let bandMatches: MatchRow[] = [];

    if (activeBandIds.length > 0) {
      const { data, error: bandMatchesError } = await supabase
        .from("matches")
        .select(MATCH_SELECT)
        .in("band_id", activeBandIds)
        .order("matched_at", { ascending: false });

      if (bandMatchesError) {
        console.error("バンドマッチングの取得エラー:", bandMatchesError);

        return NextResponse.json(
          { error: "バンドのマッチング情報の取得に失敗しました" },
          { status: 500 }
        );
      }

      bandMatches = (data ?? []) as MatchRow[];
    }

    /*
     * 個人マッチングとバンドマッチングを統合する。
     * リーダーの場合、同じバンドマッチングが両方の検索結果に
     * 含まれることがあるため、マッチングIDで重複を除外する。
     *
     * バンドのマッチングは、現在もそのバンドに所属している
     * メンバーにだけ返す。
     */
    const uniqueMatches = new Map<string, MatchRow>();

    for (const match of (personalMatches ?? []) as MatchRow[]) {
      if (
        match.band_id === null ||
        (match.band_id && activeBandIds.includes(match.band_id))
      ) {
        uniqueMatches.set(match.id, match);
      }
    }

    for (const match of bandMatches) {
      uniqueMatches.set(match.id, match);
    }

    // 所属バンドの情報を取得
    const bandById = new Map<
      string,
      { id: string; name: string | null; description: string | null }
    >();

    if (activeBandIds.length > 0) {
      const { data: bands, error: bandsError } = await supabase
        .from("bands")
        .select("id, name, description")
        .in("id", activeBandIds);

      if (bandsError) {
        console.error("バンド情報の取得エラー:", bandsError);

        return NextResponse.json(
          { error: "バンド情報の取得に失敗しました" },
          { status: 500 }
        );
      }

      for (const band of bands ?? []) {
        bandById.set(band.id, band);
      }
    }

    const roleByBandId = new Map<string, string>();

    for (const membership of activeMemberships) {
      roleByBandId.set(membership.band_id, membership.role);
    }

    // 画面で利用しやすい形式に整える
    const matches = Array.from(uniqueMatches.values())
      .sort(
        (a, b) =>
          new Date(b.matched_at).getTime() -
          new Date(a.matched_at).getTime()
      )
      .map((match) => {
        const band = match.band_id
          ? bandById.get(match.band_id) ?? null
          : null;

        return {
          ...match,
          band: match.band_id
            ? {
                id: match.band_id,
                name: band?.name ?? "バンド名未設定",
                description: band?.description ?? null,
              }
            : null,
          isBandLeader:
            match.band_id !== null &&
            roleByBandId.get(match.band_id) === "leader",
        };
      });

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("マッチング一覧APIエラー:", error);

    return NextResponse.json(
      { error: "マッチング情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}