import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return NextResponse.json(body, { ...init, headers });
}

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
      return privateJson(
        { error: "LINEの本人確認情報がありません。再ログインしてください。" },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return privateJson(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
        { status: 401 }
      );
    }

    const { id: matchId } = await params;

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .eq("account_status", "active")
      .single();

    if (userError || !user) {
      return privateJson(
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
      return privateJson(
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
          venue_address,
          instruments,
          genres,
          reward,
          status,
          facilities (
            id,
            name,
            facility_type,
            description,
            users (
              picture_url,
              avatar_type,
              avatar_emoji
            )
          )
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !match) {
      console.error("マッチング取得エラー:", matchError);

      return privateJson(
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

        return privateJson(
          { error: "マッチングの閲覧権限を確認できませんでした" },
          { status: 500 }
        );
      }

      if (!membership) {
        return privateJson(
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

        return privateJson(
          { error: "バンド情報の取得に失敗しました" },
          { status: 500 }
        );
      }

      if (!bandData) {
        return privateJson(
          { error: "バンド情報が見つかりません" },
          { status: 404 }
        );
      }

      // 活動中バンド：現役のアクティブメンバーだけ許可
      if (
        bandData.status === "active" &&
        membership.status !== "active"
      ) {
        return privateJson(
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
        return privateJson(
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
        return privateJson(
          {
            error:
              "マッチングが見つからないか、閲覧する権限がありません",
          },
          { status: 404 }
        );
      }
    }

    // 施設に紐づくusers情報を画面で使う形式に整える
    const flattenFacilityAvatar = (facility: any) => {
      if (!facility) return facility;

      const linkedUser = Array.isArray(facility.users)
        ? facility.users[0]
        : facility.users;

      const {
        id: _facilityId,
        users: _users,
        ...facilityData
      } = facility;

      return {
        ...facilityData,
        picture_url: linkedUser?.picture_url ?? null,
        avatar_type: linkedUser?.avatar_type ?? null,
        avatar_emoji: linkedUser?.avatar_emoji ?? null,
      };
    };

    const sanitizePerformanceRequest = (item: any) => {
      if (!item) return item;
      const {
        id: _requestId,
        facility_id: _facilityId,
        facilities,
        ...publicRequest
      } = item;
      return {
        ...publicRequest,
        facilities: Array.isArray(facilities)
          ? facilities.map(flattenFacilityAvatar)
          : flattenFacilityAvatar(facilities),
      };
    };

    const performanceRequest: any = (match as any).performance_requests;
    const enrichedPerformanceRequest = Array.isArray(performanceRequest)
      ? performanceRequest.map(sanitizePerformanceRequest)
      : sanitizePerformanceRequest(performanceRequest);

    const {
      request_id: _requestId,
      performer_id: _performerId,
      band_id: rawBandId,
      performance_requests: _rawPerformanceRequests,
      ...publicMatchFields
    } = match as any;

    const enrichedMatch = {
      ...publicMatchFields,
      performance_requests: enrichedPerformanceRequest,
      band: band
        ? {
            name: band.name,
            description: band.description,
            status: band.status,
          }
        : null,
      isBandMatch: Boolean(rawBandId),
      isBandLeader,
    };

    return privateJson({ match: enrichedMatch });
  } catch (error) {
    console.error("マッチング詳細APIエラー:", error);

    return privateJson(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}