import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id: requestId } = await context.params;

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
    const { data: user, error: userError } = await supabase
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

    // 施設を取得
    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      console.error("施設取得エラー:", facilityError);

      return NextResponse.json(
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
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
      console.error("案件取得エラー:", requestError);

      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    // 個人応募・バンド応募の両方を取得
    const { data: applications, error: applicationsError } =
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
              picture_url
            )
          )
        `)
        .eq("request_id", requestId)
        .order("created_at", {
          ascending: true,
        });

    if (applicationsError) {
      console.error("応募者取得エラー:", applicationsError);

      return NextResponse.json(
        { error: applicationsError.message },
        { status: 500 }
      );
    }

    const applicationRows = applications ?? [];

    // バンド応募がない場合は、従来どおりの結果を返す
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
      }[]
    >();

    if (bandIds.length > 0) {
      // バンド情報
      const { data: bands, error: bandsError } = await supabase
        .from("bands")
        .select("id, name, description, status")
        .in("id", bandIds);

      if (bandsError) {
        console.error("応募バンド取得エラー:", bandsError);

        return NextResponse.json(
          { error: "応募バンドの情報を取得できませんでした" },
          { status: 500 }
        );
      }

      for (const band of bands ?? []) {
        bandsById.set(band.id, band);
        membersByBand.set(band.id, []);
      }

      // 応募時点ではなく現在の活動中メンバーを取得
      const { data: memberships, error: membersError } =
        await supabase
          .from("band_members")
          .select("band_id, performer_id, role")
          .in("band_id", bandIds)
          .eq("status", "active");

      if (membersError) {
        console.error("応募バンドのメンバー取得エラー:", membersError);

        return NextResponse.json(
          { error: "バンドメンバーを取得できませんでした" },
          { status: 500 }
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
        }
      >();

      if (performerIds.length > 0) {
        const { data: performers, error: performersError } =
          await supabase
            .from("performers")
            .select("id, name, instruments, genres, area, areas")
            .in("id", performerIds);

        if (performersError) {
          console.error(
            "応募バンドの演奏者取得エラー:",
            performersError
          );

          return NextResponse.json(
            { error: "演奏者情報を取得できませんでした" },
            { status: 500 }
          );
        }

        for (const performer of performers ?? []) {
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

    // 既存のapplications形式を維持しながら、band情報を追加
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

    return NextResponse.json({
      request: performanceRequest,
      applications: result,
    });
  } catch (error) {
    console.error("応募者APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}