import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type BandMembership = {
  band_id: string;
  role: string;
  status: string;
};

type BandRow = {
  id: string;
  name: string | null;
  description: string | null;
  status: string;
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

    // 現在の所属だけでなく、過去の所属記録も取得する。
    // 解散済みバンドの履歴閲覧に限って過去の所属を利用する。
    const { data: memberships, error: membershipsError } = await supabase
      .from("band_members")
      .select("band_id, role, status")
      .eq("performer_id", performer.id);

    if (membershipsError) {
      console.error("バンド所属情報の取得エラー:", membershipsError);

      return NextResponse.json(
        { error: "バンド所属情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    const membershipRows = (memberships ?? []) as BandMembership[];
    const membershipBandIds = [
      ...new Set(membershipRows.map((membership) => membership.band_id)),
    ];

    const bandById = new Map<string, BandRow>();

    if (membershipBandIds.length > 0) {
      const { data: bands, error: bandsError } = await supabase
        .from("bands")
        .select("id, name, description, status")
        .in("id", membershipBandIds);

      if (bandsError) {
        console.error("バンド情報の取得エラー:", bandsError);

        return NextResponse.json(
          { error: "バンド情報の取得に失敗しました" },
          { status: 500 }
        );
      }

      for (const band of (bands ?? []) as BandRow[]) {
        bandById.set(band.id, band);
      }
    }

    // 活動中バンドは現在のアクティブメンバーのみ対象。
    // 解散済みバンドは、過去の所属記録がある人に履歴閲覧を許可する。
    const allowedBandIds = [
      ...new Set(
        membershipRows
          .filter((membership) => {
            const band = bandById.get(membership.band_id);

            return (
              (membership.status === "active" &&
                band?.status === "active") ||
              (membership.status === "left" &&
                band?.status === "disbanded")
            );
          })
          .map((membership) => membership.band_id)
      ),
    ];

    // 個人マッチングを取得
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

    // 許可されたバンドのマッチングを取得
    let bandMatches: MatchRow[] = [];

    if (allowedBandIds.length > 0) {
      const { data, error: bandMatchesError } = await supabase
        .from("matches")
        .select(MATCH_SELECT)
        .in("band_id", allowedBandIds)
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

    // 個人・バンドの結果を統合し、重複を除外
    const uniqueMatches = new Map<string, MatchRow>();

    for (const match of (personalMatches ?? []) as MatchRow[]) {
      if (
        match.band_id === null ||
        (match.band_id !== null &&
          allowedBandIds.includes(match.band_id))
      ) {
        uniqueMatches.set(match.id, match);
      }
    }

    for (const match of bandMatches) {
      uniqueMatches.set(match.id, match);
    }

    // 現在の所属情報だけを、操作権限の判定に利用する。
    const activeRoleByBandId = new Map<string, string>();

    for (const membership of membershipRows) {
      const band = bandById.get(membership.band_id);

      if (
        membership.status === "active" &&
        band?.status === "active"
      ) {
        activeRoleByBandId.set(
          membership.band_id,
          membership.role
        );
      }
    }

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

          // 解散済みバンドには操作権限を付与しない
          isBandLeader:
            match.band_id !== null &&
            band?.status === "active" &&
            activeRoleByBandId.get(match.band_id) === "leader",
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