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
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return privateJson(
        { error: "依頼IDが指定されていません" },
        { status: 400 }
      );
    }

    // LINE IDトークンを検証
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!idToken) {
      return privateJson(
        {
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return privateJson(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const lineUserId = verified.userId;

    // LINEユーザーからユーザー情報を取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, line_user_id, display_name, picture_url, user_type")
      .eq("line_user_id", lineUserId)
      .eq("account_status", "active")
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return privateJson(
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

      return privateJson(
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
          venue_address,
          instruments,
          genres,
          reward,
          status,
          facility_id,
          facilities (
            id,
            name,
            facility_type,
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

      return privateJson(
        { error: "依頼情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    if (!application) {
      return privateJson(
        { error: "依頼が見つかりません" },
        { status: 404 }
      );
    }

    const {
      request_id: _requestId,
      performer_id: _performerId,
      performance_requests: rawPerformanceRequest,
      ...publicApplication
    } = application as any;

    const performanceRequest = Array.isArray(rawPerformanceRequest)
      ? rawPerformanceRequest[0]
      : rawPerformanceRequest;

    let publicPerformanceRequest = performanceRequest;
    if (performanceRequest && typeof performanceRequest === "object") {
      const {
        id: _performanceRequestId,
        facility_id: _facilityId,
        facilities: rawFacilities,
        ...requestFields
      } = performanceRequest;
      const facility = Array.isArray(rawFacilities)
        ? rawFacilities[0]
        : rawFacilities;
      let publicFacility = facility;
      if (facility && typeof facility === "object") {
        const { id: _facilityId, ...facilityFields } = facility;
        publicFacility = facilityFields;
      }
      publicPerformanceRequest = {
        ...requestFields,
        facilities: publicFacility,
      };
    }

    return privateJson({
      invitation: {
        ...publicApplication,
        performance_requests: publicPerformanceRequest,
      },
    });
  } catch (error) {
    console.error("演奏依頼詳細APIエラー:", error);

    return privateJson(
      { error: "依頼情報の取得中にエラーが発生しました" },
      { status: 500 }
    );
  }
}