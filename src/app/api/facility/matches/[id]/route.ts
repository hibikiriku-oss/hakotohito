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
      console.error("ユーザー取得エラー:", userError);

      return privateJson(
        { error: "ユーザーが見つかりません" },
        { status: 404 }
      );
    }

    // 施設プロフィールを取得
    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      console.error("施設取得エラー:", facilityError);

      return privateJson(
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // マッチングと完了報告・異議申し立ての情報を取得
    const { data: rawMatch, error: matchError } = await supabase
      .from("matches")
      .select(`
        id,
        request_id,
        performer_id,
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
          facility_id,
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
          status
        ),
        performers (
          name,
          instruments,
          genres,
          area,
          bio,
          users (
            display_name,
            picture_url,
            avatar_type,
            avatar_emoji
          )
        )
      `)
      .eq("id", matchId)
      .single();

    if (matchError || !rawMatch) {
      console.error("マッチング取得エラー:", matchError);

      return privateJson(
        { error: "マッチング情報が見つかりません" },
        { status: 404 }
      );
    }

    const match = rawMatch as unknown as {
      id: string;
      request_id: string;
      performer_id: string;
      status: string;
      performance_status: string;
      completed_at: string | null;
      performer_completion_reported_at: string | null;
      facility_completion_reported_at: string | null;
      completion_disputed_at: string | null;
      completion_disputed_by: string | null;
      completion_dispute_reason: string | null;
      completion_method: string | null;
      performance_requests:
        | Record<string, unknown>
        | Record<string, unknown>[]
        | null;
      performers: Record<string, unknown> | null;
      [key: string]: unknown;
    };

    const performanceRequest = Array.isArray(match.performance_requests)
      ? match.performance_requests[0]
      : match.performance_requests;

    if (!performanceRequest) {
      return privateJson(
        { error: "演奏案件が見つかりません" },
        { status: 404 }
      );
    }

    // 施設本人の案件か確認
    if (performanceRequest.facility_id !== facility.id) {
      return privateJson(
        { error: "このマッチングを閲覧する権限がありません" },
        { status: 403 }
      );
    }

    // 応募メッセージは再応募で更新されるapplications行ではなく、
    // このmatchに紐づくapplication_attemptsのスナップショットから取得する。
    const { data: attempt, error: attemptError } = await supabase
      .from("application_attempts")
      .select("message_snapshot, message_snapshot_available, status, started_at, source")
      .eq("match_id", match.id)
      .maybeSingle();

    if (attemptError) {
      console.error("応募試行履歴取得エラー:", attemptError);
      return privateJson(
        { error: "応募履歴を取得できませんでした" },
        { status: 500 }
      );
    }

    const application = attempt
      ? {
          message: attempt.message_snapshot_available
            ? attempt.message_snapshot
            : null,
          status: attempt.status,
          created_at: attempt.started_at,
          source: attempt.source,
          messageHistoryAvailable: attempt.message_snapshot_available,
        }
      : {
          message: null,
          status: null,
          created_at: null,
          source: null,
          messageHistoryAvailable: false,
        };

    const {
      request_id: _requestId,
      performer_id: _performerId,
      ...publicMatchFields
    } = match;

    const {
      id: _performanceRequestId,
      facility_id: _facilityId,
      ...publicPerformanceRequest
    } = performanceRequest as Record<string, unknown>;

    const rawPerformer = Array.isArray(match.performers)
      ? match.performers[0]
      : match.performers;
    let publicPerformer: Record<string, unknown> | null = null;

    if (rawPerformer && typeof rawPerformer === "object") {
      const {
        id: _performerProfileId,
        users: rawUsers,
        ...publicPerformerFields
      } = rawPerformer as Record<string, unknown>;
      const publicUsers = Array.isArray(rawUsers)
        ? rawUsers.map((rawUser) => {
            const { id: _userId, ...publicUser } = rawUser as Record<string, unknown>;
            return publicUser;
          })
        : rawUsers && typeof rawUsers === "object"
          ? (() => {
              const { id: _userId, ...publicUser } = rawUsers as Record<string, unknown>;
              return publicUser;
            })()
          : rawUsers;
      publicPerformer = {
        ...publicPerformerFields,
        users: publicUsers,
      };
    }

    return privateJson({
      match: {
        ...publicMatchFields,
        performance_requests: publicPerformanceRequest,
        performers: publicPerformer,
      },
      application: application || null,
    });
  } catch (error) {
    console.error("施設マッチング詳細APIエラー:", error);

    return privateJson(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}