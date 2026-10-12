import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    // usersを取得
    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        {
          error:
            "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設を取得
    const {
      data: facility,
      error: facilityError,
    } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      console.error(
        "施設取得エラー:",
        facilityError
      );

      return NextResponse.json(
        {
          error:
            "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 自分の案件を取得
    const {
      data: requests,
      error: requestsError,
    } = await supabase
      .from("performance_requests")
      .select(`
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
        created_at
      `)
      .eq("facility_id", facility.id)
      .order("performance_date", {
        ascending: true,
      });

    if (requestsError) {
      console.error(
        "案件取得エラー:",
        requestsError
      );

      return NextResponse.json(
        {
          error: requestsError.message,
        },
        { status: 500 }
      );
    }

    const requestList =
      requests || [];

    /*
     * 案件に紐づくマッチング履歴を取得する。
     *
     * 同じ案件が
     * 「マッチング → キャンセル → 再マッチング」
     * される可能性があるため、
     * matched_at の新しい順で取得する。
     */
    const requestIds =
      requestList.map(
        (item) => item.id
      );

    let matches: Array<{
      id: string;
      request_id: string;
      status: string;
      performance_status: string;
      matched_at: string;
      completed_at: string | null;
    }> = [];

    if (requestIds.length > 0) {
      const {
        data: matchData,
        error: matchesError,
      } = await supabase
        .from("matches")
        .select(`
          id,
          request_id,
          status,
          performance_status,
          matched_at,
          completed_at
        `)
        .in(
          "request_id",
          requestIds
        )
        .order("matched_at", {
          ascending: false,
        });

      if (matchesError) {
        console.error(
          "マッチング履歴取得エラー:",
          matchesError
        );

        return NextResponse.json(
          {
            error:
              "マッチング情報の取得に失敗しました",
          },
          { status: 500 }
        );
      }

      matches = matchData || [];
    }

    /*
     * 案件ごとに最新のマッチングを1件だけ紐付ける。
     *
     * 最新マッチングが
     * - active + scheduled   → matching
     * - active + completed   → completed
     * - cancelled            → cancelled
     *
     * 最新マッチングが存在しない場合は
     * performance_requests.status をそのまま使用する。
     */
    const latestMatchByRequestId =
      new Map<
        string,
        (typeof matches)[number]
      >();

    for (const match of matches) {
      if (
        !latestMatchByRequestId.has(
          match.request_id
        )
      ) {
        latestMatchByRequestId.set(
          match.request_id,
          match
        );
      }
    }

    const enrichedRequests =
      requestList.map(
        (item) => {
          const latestMatch =
            latestMatchByRequestId.get(
              item.id
            );

          let displayStatus =
            item.status;

          if (latestMatch) {
            if (
              latestMatch.status ===
                "cancelled" ||
              latestMatch.performance_status ===
                "cancelled"
            ) {
              displayStatus =
                "cancelled";
            } else if (
              latestMatch.performance_status ===
              "completed"
            ) {
              displayStatus =
                "completed";
            } else if (
              latestMatch.status ===
              "active"
            ) {
              displayStatus =
                "matched";
            }
          }

          return {
            ...item,
            display_status:
              displayStatus,
            latest_match_status:
              latestMatch?.status ||
              null,
            latest_performance_status:
              latestMatch?.performance_status ||
              null,
            latest_match_id:
              latestMatch?.id ||
              null,
          };
        }
      );

    return NextResponse.json({
      requests:
        enrichedRequests,
    });
  } catch (error) {
    console.error(
      "施設案件APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "サーバーエラー",
      },
      { status: 500 }
    );
  }
}