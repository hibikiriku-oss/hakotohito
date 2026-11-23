import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return NextResponse.json(body, { ...init, headers });
}

export async function GET(request: NextRequest) {
  try {
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

    // usersを取得
    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .eq("account_status", "active")
      .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return privateJson(
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

      return privateJson(
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
        application_deadline,
        start_time,
        end_time,
        area,
        instruments,
        genres,
        reward,
        request_type,
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

      return privateJson(
        {
          error: "案件一覧の取得に失敗しました",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
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

        return privateJson(
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
     * 案件ごとに全マッチングを集計する。
     * イベント・レンタルなど複数の参加者を受け入れる案件では、
     * 最新の1件がキャンセル済みでも、他に有効なマッチングが
     * 残っていれば案件全体をキャンセル扱いにしない。
     */
    const matchesByRequestId =
      new Map<
        string,
        (typeof matches)[number][]
      >();

    for (const match of matches) {
      const requestMatches =
        matchesByRequestId.get(match.request_id) || [];
      requestMatches.push(match);
      matchesByRequestId.set(
        match.request_id,
        requestMatches
      );
    }

    const enrichedRequests =
      requestList.map(
        (item) => {
          const requestMatches =
            matchesByRequestId.get(item.id) || [];
          const latestMatch = requestMatches[0];
          const activeMatches =
            requestMatches.filter(
              (match) =>
                match.status === "active" &&
                match.performance_status !== "cancelled"
            );

          const allActiveMatchesCompleted =
            activeMatches.length > 0 &&
            activeMatches.every(
              (match) =>
                match.performance_status === "completed" ||
                match.completed_at !== null
            );

          let displayStatus = item.status;

          if (activeMatches.length > 0) {
            displayStatus = allActiveMatchesCompleted
              ? "completed"
              : "matched";
          }

          return {
            ...item,
            display_status: displayStatus,
            latest_match_status:
              latestMatch?.status || null,
            latest_performance_status:
              latestMatch?.performance_status || null,
            latest_match_id:
              latestMatch?.id || null,
          };
        }
      );

    return privateJson({
      requests:
        enrichedRequests,
    });
  } catch (error) {
    console.error(
      "施設案件APIエラー:",
      error
    );

    return privateJson(
      {
        error:
          "サーバーエラー",
      },
      { status: 500 }
    );
  }
}