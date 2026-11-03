
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_APPLICATIONS = 200;
const FETCH_APPLICATIONS = MAX_APPLICATIONS + 1;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(
  body: unknown,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function logDatabaseError(
  label: string,
  error: { code?: string; name?: string } | null
) {
  console.error(label, {
    code: error?.code ?? null,
    name: error?.name ?? null,
  });
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id: requestId } = await context.params;

    if (!UUID_REGEX.test(requestId)) {
      return jsonResponse(
        { error: "案件IDが正しくありません" },
        400
      );
    }

    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    if (!idToken) {
      return jsonResponse(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        401
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return jsonResponse(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        401
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("応募者API: Supabase環境変数が未設定です");

      return jsonResponse(
        { error: "サーバーの設定に問題があります" },
        500
      );
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const lineUserId = verified.userId;

    // LINEユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      logDatabaseError("応募者API: ユーザー取得エラー", userError);

      return jsonResponse(
        { error: "ユーザー情報が見つかりません" },
        404
      );
    }

    // 施設を取得
    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      logDatabaseError("応募者API: 施設取得エラー", facilityError);

      return jsonResponse(
        { error: "施設プロフィールが見つかりません" },
        404
      );
    }

    // この案件が本当にこの施設の案件か確認
    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select("id, title")
        .eq("id", requestId)
        .eq("facility_id", facility.id)
        .single();

    if (requestError || !performanceRequest) {
      logDatabaseError("応募者API: 案件取得エラー", requestError);

      return jsonResponse(
        { error: "案件が見つかりません" },
        404
      );
    }

    // 有効なマッチングの参加人数を全件集計
    // 応募一覧の200件制限とは独立して集計する
    const { data: matches, error: matchesError } = await supabase
      .from("matches")
      .select("participant_count")
      .eq("request_id", requestId)
      .eq("status", "active")
      .or("performance_status.is.null,performance_status.neq.cancelled");

    if (matchesError) {
      logDatabaseError(
        "応募者API: マッチング人数集計エラー",
        matchesError
      );

      return jsonResponse(
        { error: "採用人数を取得できませんでした" },
        500
      );
    }

    const acceptedParticipantCount = (matches ?? []).reduce(
      (total, match) => {
        const count = Number(match.participant_count);

        return total + (
          Number.isInteger(count) && count >= 1
            ? count
            : 0
        );
      },
      0
    );

    // 最新の応募から最大200件取得
    // 201件取得することで、続きがあるか判定する
    const { data: fetchedApplications, error: applicationsError } =
      await supabase
        .from("applications")
        .select(`
          id,
          message,
          status,
          source,
          band_id,
          created_at,
          performers (
            id,
            name,
            area,
            areas,
            instruments,
            genres,
            bio,
            status_level,
            users (
              display_name,
              picture_url,
              avatar_type,
              avatar_emoji
            )
          )
        `)
        .eq("request_id", requestId)
        .order("created_at", {
          ascending: false,
        })
        .limit(FETCH_APPLICATIONS);

    if (applicationsError) {
      logDatabaseError(
        "応募者API: 応募者取得エラー",
        applicationsError
      );

      return jsonResponse(
        { error: "応募者情報を取得できませんでした" },
        500
      );
    }

    const hasMore =
      (fetchedApplications ?? []).length > MAX_APPLICATIONS;

    const applicationRows = (
      fetchedApplications ?? []
    ).slice(0, MAX_APPLICATIONS);

    // バンド応募のIDを取得
    const bandIds = [
      ...new Set(
        applicationRows
          .map((application) => application.band_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const bandsById = new Map<
      string,
      {
        id: string;
        name: string;
        description: string | null;
        status: string;
      }
    >();

    const membersByBand = new Map<
      string,
      {
        id: string;
        name: string;
        role: string;
        instruments: string[];
        genres: string[];
        area: string | null;
        areas: string[];
        users: {
          display_name: string | null;
          picture_url: string | null;
          avatar_type: string | null;
          avatar_emoji: string | null;
        } | null;
      }[]
    >();

    if (bandIds.length > 0) {
      // バンド情報
      const { data: bands, error: bandsError } = await supabase
        .from("bands")
        .select("id, name, description, status")
        .in("id", bandIds);

      if (bandsError) {
        logDatabaseError(
          "応募者API: 応募バンド取得エラー",
          bandsError
        );

        return jsonResponse(
          { error: "応募バンドの情報を取得できませんでした" },
          500
        );
      }

      for (const band of bands ?? []) {
        bandsById.set(band.id, band);
        membersByBand.set(band.id, []);
      }

      // 現在の活動中メンバーを取得
      const { data: memberships, error: membersError } =
        await supabase
          .from("band_members")
          .select("band_id, performer_id, role")
          .in("band_id", bandIds)
          .eq("status", "active");

      if (membersError) {
        logDatabaseError(
          "応募者API: バンドメンバー取得エラー",
          membersError
        );

        return jsonResponse(
          { error: "バンドメンバーを取得できませんでした" },
          500
        );
      }

      const performerIds = [
        ...new Set(
          (memberships ?? []).map((member) => member.performer_id)
        ),
      ];

      const performersById = new Map<
        string,
        {
          id: string;
          name: string;
          instruments: string[];
          genres: string[];
          area: string | null;
          areas: string[];
          users: {
            display_name: string | null;
            picture_url: string | null;
            avatar_type: string | null;
            avatar_emoji: string | null;
          } | null;
        }
      >();

      if (performerIds.length > 0) {
        const { data: performers, error: performersError } =
          await supabase
            .from("performers")
            .select(`
              id,
              name,
              instruments,
              genres,
              area,
              areas,
              users (
                display_name,
                picture_url,
                avatar_type,
                avatar_emoji
              )
            `)
            .in("id", performerIds);

        if (performersError) {
          logDatabaseError(
            "応募者API: バンド演奏者取得エラー",
            performersError
          );

          return jsonResponse(
            { error: "演奏者情報を取得できませんでした" },
            500
          );
        }

        for (const performer of performers ?? []) {
          const performerUser = performer.users?.[0] ?? null;

          performersById.set(performer.id, {
            id: performer.id,
            name: performer.name,
            instruments: performer.instruments ?? [],
            genres: performer.genres ?? [],
            area: performer.area ?? null,
            areas:
              performer.areas?.length > 0
                ? performer.areas
                : performer.area
                  ? [performer.area]
                  : [],
            users: performerUser
              ? {
                  display_name: performerUser.display_name,
                  picture_url: performerUser.picture_url,
                  avatar_type: performerUser.avatar_type,
                  avatar_emoji: performerUser.avatar_emoji,
                }
              : null,
          });
        }
      }

      for (const member of memberships ?? []) {
        const performer = performersById.get(member.performer_id);

        if (!performer) {
          continue;
        }

        const currentMembers = membersByBand.get(member.band_id);

        currentMembers?.push({
          ...performer,
          role: member.role,
        });
      }
    }

    // 既存のapplications形式を維持しながらband情報を追加
    const result = applicationRows.map((application) => {
      const bandId = application.band_id as string | null;
      const band = bandId ? bandsById.get(bandId) : null;

      return {
        ...application,
        applicationType:
          application.source === "band_apply" && bandId
            ? "band"
            : "individual",
        band: band
          ? {
              ...band,
              members: membersByBand.get(band.id) ?? [],
            }
          : null,
      };
    });

    return jsonResponse({
      request: performanceRequest,
      applications: result,
      hasMore,
      acceptedParticipantCount,
    });
  } catch (error) {
    console.error("応募者APIエラー:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return jsonResponse(
      { error: "サーバーエラーが発生しました" },
      500
    );
  }
}
