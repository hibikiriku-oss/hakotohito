import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

// Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// LINE Messaging API
const LINE_CHANNEL_ACCESS_TOKEN =
  process.env.LINE_CHANNEL_ACCESS_TOKEN!;

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
      applicationId: string;
    }>;
  }
) {
  try {
    // ----------------------------------------
    // 1. パラメータ取得
    // ----------------------------------------
    const { id: requestId, applicationId } = await context.params;

    // ----------------------------------------
    // 2. LINEユーザーID取得
    // ----------------------------------------
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = match?.[1]?.trim();

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

    // ----------------------------------------
    // 3. ユーザー取得
    // ----------------------------------------
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("line_user_id", verified.userId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        {
          error: "ユーザーが見つかりません",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // 4. 施設取得
    // ----------------------------------------
    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      console.error("施設取得エラー:", facilityError);

      return NextResponse.json(
        {
          error: "施設情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // 5. 案件取得
    // ----------------------------------------
    const { data: performanceRequest, error: requestError } =
      await supabase
        .from("performance_requests")
        .select("*")
        .eq("id", requestId)
        .eq("facility_id", facility.id)
        .single();

    if (requestError || !performanceRequest) {
      console.error("案件取得エラー:", requestError);

      return NextResponse.json(
        {
          error: "案件が見つからないか、この施設の案件ではありません",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // 6. 案件がすでにマッチング済みか確認
    // ----------------------------------------
    if (performanceRequest.status === "matched") {
      return NextResponse.json(
        {
          error: "この案件はすでにマッチング済みです",
        },
        { status: 400 }
      );
    }

    // ----------------------------------------
    // 7. 応募情報取得
    // ----------------------------------------
    const { data: application, error: applicationError } =
      await supabase
        .from("applications")
        .select("*")
        .eq("id", applicationId)
        .eq("request_id", requestId)
        .single();

    if (applicationError || !application) {
      console.error("応募情報取得エラー:", applicationError);

      return NextResponse.json(
        {
          error: "応募情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // ----------------------------------------
    // 8. 応募がpendingか確認
    // ----------------------------------------
    if (application.status !== "pending") {
      return NextResponse.json(
        {
          error: "この応募はすでに処理されています",
        },
        { status: 400 }
      );
    }

    // =====================================================
    // 9. マッチング成立 + 100コイン消費
    //
    // DB RPC:
    // accept_application_with_coins
    //
    // このRPC内で以下を一括処理する
    // ・matches作成
    // ・採用応募をaccepted
    // ・他の応募をrejected
    // ・案件をmatched
    // ・施設の100コイン消費
    //
    // コイン不足の場合はトランザクション全体を
    // ロールバックする
    // =====================================================
    const { data: matchingResult, error: matchingError } =
      await supabase.rpc("accept_application_with_coins", {
        p_request_id: requestId,
        p_application_id: applicationId,
        p_facility_user_id: user.id,
      });

    if (matchingError) {
      console.error("マッチングRPCエラー:", matchingError);

      const errorMessage = matchingError.message || "";
      const isInsufficientCoins =
        /コイン不足|コインが不足|チャージが必要|insufficient/i.test(
          errorMessage
        );

      return NextResponse.json(
        {
          error: isInsufficientCoins
            ? errorMessage
            : "マッチング処理に失敗しました。時間をおいて再度お試しください。",
        },
        {
          status: isInsufficientCoins ? 400 : 500,
        }
      );
    }

    // Supabase RPCは通常配列で返るため1件目を取得
    const matching = Array.isArray(matchingResult)
      ? matchingResult[0]
      : matchingResult;

    // ----------------------------------------
    // 10. RPC結果確認
    // ----------------------------------------
    if (!matching?.success) {
      console.error(
        "マッチング失敗:",
        matching?.error_message
      );

      return NextResponse.json(
        {
          error:
            matching?.error_message ||
            "マッチングに失敗しました",
        },
        { status: 400 }
      );
    }

    // ----------------------------------------
    // 11. マッチングID・残高取得
    // ----------------------------------------
    const matchId = matching.match_id;

    // 成立処理後の施設側のコイン残高を取得
    const { data: facilityBalance, error: balanceError } =
      await supabase
        .from("users")
        .select("coin_balance")
        .eq("id", user.id)
        .single();

    if (balanceError || !facilityBalance) {
      console.error("施設のコイン残高取得エラー:", balanceError);
    }

    const coinBalance = facilityBalance?.coin_balance ?? null;

    if (!matchId) {
      console.error(
        "マッチングIDが取得できません:",
        matching
      );

      return NextResponse.json(
        {
          error: "マッチングIDの取得に失敗しました",
        },
        { status: 500 }
      );
    }

    // =====================================================
    // 12. LINE通知の対象者を取得
    // =====================================================

    // バンド応募ならband_idが入り、個人応募ならNULL
    const bandId =
      typeof application.band_id === "string"
        ? application.band_id
        : null;

    let notificationSent = false;
    let notificationLineUserIds: string[] = [];
    let notificationName = "演奏者";
    let notificationUrl = "";
    let notificationIntro = "";

    if (bandId) {
      // ----------------------------------------
      // バンド応募：バンド情報と活動中メンバーを取得
      // ----------------------------------------
      const { data: band, error: bandError } = await supabase
        .from("bands")
        .select("id, name")
        .eq("id", bandId)
        .maybeSingle();

      if (bandError || !band) {
        console.error(
          "採用通知用のバンド取得エラー:",
          bandError
        );
      } else {
        notificationName = band.name || "バンド";

        notificationIntro =
          `バンド「${notificationName}」の応募が採用されました。`;

        // メンバー全員（リーダーを含む）のLINE通知先を取得
        const { data: memberships, error: membershipsError } =
          await supabase
            .from("band_members")
            .select("performer_id")
            .eq("band_id", bandId)
            .eq("status", "active");

        if (membershipsError) {
          console.error(
            "採用通知用のバンドメンバー取得エラー:",
            membershipsError
          );
        } else {
          const performerIds = [
            ...new Set(
              (memberships ?? []).map(
                (member) => member.performer_id
              )
            ),
          ];

          if (performerIds.length > 0) {
            const {
              data: memberPerformers,
              error: memberPerformersError,
            } = await supabase
              .from("performers")
              .select("id, users(line_user_id)")
              .in("id", performerIds);

            if (memberPerformersError) {
              console.error(
                "採用通知用のLINEユーザー取得エラー:",
                memberPerformersError
              );
            } else {
              notificationLineUserIds = [
                ...new Set(
                  (memberPerformers ?? []).flatMap(
                    (member) => {
                      const userInfo = Array.isArray(member.users)
                        ? member.users[0]
                        : member.users;

                      const memberLineUserId =
                        userInfo?.line_user_id;

                      return typeof memberLineUserId === "string" &&
                        memberLineUserId
                        ? [memberLineUserId]
                        : [];
                    }
                  )
                ),
              ];
            }
          }
        }
      }

      // メンバーが開けるバンドチャットへ案内
      notificationUrl =
        "https://miniapp.line.me/2011785379-l5XCTbIf/performer/bands/" +
        bandId +
        "/chat";
    } else {
      // ----------------------------------------
      // 個人応募：従来どおり本人へ通知
      // ----------------------------------------
      const {
        data: performer,
        error: performerError,
      } = await supabase
        .from("performers")
        .select(`
          *,
          users (
            line_user_id,
            display_name,
            picture_url
          )
        `)
        .eq("id", application.performer_id)
        .single();

      if (performerError || !performer) {
        console.error(
          "演奏者取得エラー:",
          performerError
        );
      } else {
        const performerUser = Array.isArray(performer.users)
          ? performer.users[0]
          : performer.users;

        const performerLineUserId =
          performerUser?.line_user_id;

        notificationName =
          performer.name ||
          performerUser?.display_name ||
          "演奏者";

        notificationIntro =
          "応募した演奏案件が採用されました。";

        if (performerLineUserId) {
          notificationLineUserIds = [performerLineUserId];
        } else {
          console.warn(
            "演奏者のLINEユーザーIDがありません"
          );
        }
      }

      notificationUrl =
        "https://miniapp.line.me/2011785379-l5XCTbIf/performer/matches/" +
        matchId;
    }

    // =====================================================
    // 13. LINE通知を送信
    // =====================================================

    const rewardText =
      performanceRequest.reward == null ||
      Number(performanceRequest.reward) === 0
        ? "報酬：ボランティア"
        : `報酬：${Number(
            performanceRequest.reward
          ).toLocaleString("ja-JP")}円`;

    const isBandApplication = Boolean(bandId);

    const flexMessage = {
      type: "flex",
      altText: isBandApplication
        ? "🎉 バンド応募が採用されました！"
        : "🎉 マッチングが成立しました！",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: isBandApplication
                ? "🎉 バンド応募が採用されました！"
                : "🎉 マッチング成立！",
              weight: "bold",
              size: "xl",
              wrap: true,
            },
            {
              type: "text",
              text: notificationIntro,
              margin: "md",
              wrap: true,
            },
            {
              type: "text",
              text: performanceRequest.title,
              weight: "bold",
              size: "lg",
              margin: "md",
              wrap: true,
            },
            {
              type: "text",
              text: `演奏日：${performanceRequest.performance_date}`,
              margin: "md",
              wrap: true,
            },
            {
              type: "text",
              text:
                `時間：${performanceRequest.start_time}` +
                `〜${performanceRequest.end_time}`,
              margin: "sm",
              wrap: true,
            },
            {
              type: "text",
              text: rewardText,
              margin: "sm",
              wrap: true,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              action: {
                type: "uri",
                label: isBandApplication
                  ? "バンドチャットを開く"
                  : "マッチング詳細を見る",
                uri: notificationUrl,
              },
            },
          ],
        },
      },
    };

    if (notificationLineUserIds.length === 0) {
      console.warn(
        "採用通知先が見つかりません:",
        {
          bandId,
          matchId,
        }
      );
    } else {
      // メンバーへの通知失敗で、成立済みのマッチングは取り消さない
      const notificationResults = await Promise.all(
        notificationLineUserIds.map(
          async (to): Promise<boolean> => {
            try {
              const lineResponse = await fetch(
                "https://api.line.me/v2/bot/message/push",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization:
                      `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                  },
                  body: JSON.stringify({
                    to,
                    messages: [flexMessage],
                  }),
                }
              );

              if (!lineResponse.ok) {
                const lineError = await lineResponse.text();

                console.error(
                  "LINE通知エラー:",
                  lineResponse.status,
                  lineError
                );

                return false;
              }

              return true;
            } catch (lineError) {
              console.error(
                "LINE通知例外:",
                lineError
              );

              return false;
            }
          }
        )
      );

      const successCount = notificationResults.filter(
        Boolean
      ).length;

      notificationSent =
        successCount === notificationResults.length &&
        successCount > 0;

      console.log("採用通知処理結果:", {
        bandId,
        matchId,
        recipientCount: notificationLineUserIds.length,
        successCount,
        notificationSent,
      });
    }

    // =====================================================
    // 14. 成功レスポンス
    // =====================================================
    return NextResponse.json({
      success: true,
      message: "マッチングが成立しました",
      matchId,
      coinBalance,
      notificationSent,
    });
  } catch (error) {
    console.error(
      "マッチング処理で予期しないエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "マッチング処理に失敗しました",
      },
      { status: 500 }
    );
  }
}