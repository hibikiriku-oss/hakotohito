import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendLinePushMessage } from "@/lib/line";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 日本時間の今日を YYYY-MM-DD 形式で取得
function getJapanToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { requestId, message } = body;

    if (!requestId) {
      return NextResponse.json(
        { error: "案件IDがありません" },
        { status: 400 }
      );
    }

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

    // ==============================
    // LINEユーザー取得
    // ==============================

    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // ==============================
    // 演奏者情報取得
    // ==============================

    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select("id, name, status_level")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error("演奏者取得エラー:", performerError);

      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // ==============================
    // 案件取得
    // ==============================

    const {
      data: performanceRequest,
      error: requestError,
    } = await supabase
      .from("performance_requests")
      .select(
        "id, status, title, performance_date, start_time, end_time, area, facility_id, target_levels, application_deadline, reward"
      )
      .eq("id", requestId)
      .single();

    if (requestError || !performanceRequest) {
      console.error("案件取得エラー:", requestError);

      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    // ==============================
    // 応募期限確認（最優先）
    // ==============================

    // 締切日当日は応募可能。
    // 日本時間で締切日の翌日になった時点で応募不可。
    // このチェックは応募登録・再応募・コイン消費より前に行う。
    const today = getJapanToday();
    const applicationDeadline = String(
      performanceRequest.application_deadline || ""
    ).slice(0, 10);

    if (
      !applicationDeadline ||
      today > applicationDeadline
    ) {
      return NextResponse.json(
        {
          error:
            "応募期限を過ぎているため、この案件には応募できません",
        },
        { status: 400 }
      );
    }

    // ==============================
    // 募集中の案件か確認
    // ==============================

    if (performanceRequest.status !== "open") {
      return NextResponse.json(
        { error: "この案件は現在応募できません" },
        { status: 400 }
      );
    }

    // ==============================
    // 募集対象レベルの確認
    // ==============================

    // target_levels が NULL または空配列なら制限なし。
    const targetLevels = performanceRequest.target_levels;

    if (
      Array.isArray(targetLevels) &&
      targetLevels.length > 0 &&
      (
        !performer.status_level ||
        !targetLevels.includes(performer.status_level)
      )
    ) {
      const levelNames: Record<string, string> = {
        beginner: "初心者",
        amateur: "アマチュア",
        pro: "プロ",
      };

      const targetLevelNames = targetLevels
        .map((level: string) => levelNames[level] ?? level)
        .join("・");

      return NextResponse.json(
        {
          error:
            `この案件の募集対象は「${targetLevelNames}」です。` +
            "登録プロフィールの演奏者レベルが対象外のため応募できません。",
        },
        { status: 403 }
      );
    }

    // ==============================
    // 既存応募確認
    // ==============================

    const {
      data: existingApplication,
      error: existingApplicationError,
    } = await supabase
      .from("applications")
      .select(
        "id, request_id, performer_id, message, status, source, created_at"
      )
      .eq("request_id", requestId)
      .eq("performer_id", performer.id)
      .is("band_id", null)
      .maybeSingle();

    if (existingApplicationError) {
      console.error(
        "既存応募確認エラー:",
        existingApplicationError
      );

      return NextResponse.json(
        { error: "既存応募情報の確認に失敗しました" },
        { status: 500 }
      );
    }

    // すでに応募中
    if (
      existingApplication &&
      existingApplication.status === "pending"
    ) {
      return NextResponse.json(
        { error: "この案件にはすでに応募しています" },
        { status: 409 }
      );
    }

    // すでに採用済み
    if (
      existingApplication &&
      existingApplication.status === "accepted"
    ) {
      return NextResponse.json(
        { error: "この案件にはすでに採用されています" },
        { status: 409 }
      );
    }

    // ==============================
    // 応募前の必要コイン確認
    // ==============================

    // 報酬の1%手数料は演奏完了時に処理する。
    // 管理画面で設定された応募手数料を取得
    const {
      data: coinRateSettings,
      error: coinRateSettingsError,
    } = await supabase
      .from("coin_rate_settings")
      .select("application_fee_coins")
      .eq("id", 1)
      .maybeSingle();

    if (coinRateSettingsError) {
      console.error("応募手数料設定の取得に失敗しました:", coinRateSettingsError);

      return NextResponse.json(
        { error: "応募手数料の設定を取得できませんでした。時間をおいて再度お試しください。" },
        { status: 500 }
      );
    }

    const requiredCoins = Number(
      coinRateSettings?.application_fee_coins ?? 10
    );

    if (
      !Number.isSafeInteger(requiredCoins) ||
      requiredCoins < 1 ||
      requiredCoins > 1_000_000
    ) {
      return NextResponse.json(
        { error: "応募手数料の設定値が不正です。管理者にお問い合わせください。" },
        { status: 500 }
      );
    }

    // 最新の残高を取得
    const {
      data: latestUser,
      error: balanceError,
    } = await supabase
      .from("users")
      .select("coin_balance")
      .eq("id", user.id)
      .single();

    if (balanceError || !latestUser) {
      console.error("応募前の残高取得エラー:", balanceError);

      return NextResponse.json(
        { error: "コイン残高の確認に失敗しました。時間をおいて再度お試しください。" },
        { status: 500 }
      );
    }

    const currentBalance = Number(latestUser.coin_balance ?? 0);

    if (currentBalance < 0) {
      return NextResponse.json(
        {
          error:
            "コイン残高がマイナスのため、新しい案件には応募できません。" +
            "コインをチャージするなどして残高を0以上にしてください。",
        },
        { status: 400 }
      );
    }

    if (currentBalance < requiredCoins) {
      return NextResponse.json(
        {
          error:
            "コイン不足のため応募できません。" +
            `この案件への応募には${requiredCoins}コイン必要です。` +
            `現在の残高は${currentBalance}コインです。` +
            "チャージしてから再度お試しください。",
        },
        { status: 400 }
      );
    }

    // ==============================
    // 応募登録・再応募
    // ==============================

    let data;
    let isReapply = false;

    if (
      existingApplication &&
      existingApplication.status === "rejected"
    ) {
      isReapply = true;

      const {
        data: updatedApplication,
        error: updateApplicationError,
      } = await supabase
        .from("applications")
        .update({
          message: message || null,
          status: "pending",
          source: "performer_apply",
        })
        .eq("id", existingApplication.id)
        .eq("request_id", requestId)
        .eq("performer_id", performer.id)
        .select()
        .single();

      if (updateApplicationError || !updatedApplication) {
        console.error(
          "再応募更新エラー:",
          updateApplicationError
        );

        return NextResponse.json(
          { error: "再応募の登録に失敗しました" },
          { status: 500 }
        );
      }

      data = updatedApplication;
    } else {
      const {
        data: newApplication,
        error: insertError,
      } = await supabase
        .from("applications")
        .insert({
          request_id: requestId,
          performer_id: performer.id,
          message: message || null,
          status: "pending",
          source: "performer_apply",
        })
        .select()
        .single();

      if (insertError || !newApplication) {
        console.error("応募登録エラー:", insertError);

        if (insertError?.code === "23505") {
          return NextResponse.json(
            { error: "この案件にはすでに応募しています" },
            { status: 409 }
          );
        }

        return NextResponse.json(
          {
            error:
              insertError?.message ||
              "応募登録に失敗しました",
          },
          { status: 500 }
        );
      }

      data = newApplication;
    }

    // ==============================
    // 10コイン消費
    // ==============================

    const idempotencyKey =
      `application_fee:${data.id}:${crypto.randomUUID()}`;

    const {
      data: coinResult,
      error: coinError,
    } = await supabase.rpc("spend_coins", {
      p_user_id: user.id,
      p_amount: 10,
      p_transaction_type: "application_fee",
      p_description: "演奏案件への応募手数料",
      p_idempotency_key: idempotencyKey,
      p_request_id: requestId,
      p_application_id: data.id,
    });

    if (coinError) {
      console.error("応募コイン消費RPCエラー:", coinError);

      // コイン処理に失敗した場合は応募状態を元に戻す
      if (isReapply) {
        await supabase
          .from("applications")
          .update({
            message: existingApplication?.message ?? null,
            status: existingApplication?.status ?? "rejected",
            source:
              existingApplication?.source ?? "performer_apply",
          })
          .eq("id", data.id);
      } else {
        await supabase
          .from("applications")
          .delete()
          .eq("id", data.id);
      }

      return NextResponse.json(
        { error: "応募コインの処理に失敗しました" },
        { status: 500 }
      );
    }

    const coin = Array.isArray(coinResult)
      ? coinResult[0]
      : coinResult;

    if (!coin?.success) {
      console.error("応募コイン不足:", coin);

      // コイン不足の場合も応募状態を元に戻す
      if (isReapply) {
        await supabase
          .from("applications")
          .update({
            message: existingApplication?.message ?? null,
            status: existingApplication?.status ?? "rejected",
            source:
              existingApplication?.source ?? "performer_apply",
          })
          .eq("id", data.id);
      } else {
        await supabase
          .from("applications")
          .delete()
          .eq("id", data.id);
      }


      return NextResponse.json(
        {
          error:
            `コインが不足しています。応募には${requiredCoins}コイン必要です。チャージしてから再度お試しください。`,
        },
        { status: 400 }
      );

    }

    // ==============================
    // 施設へのLINE通知
    // ==============================

    let notificationSent = false;

    try {
      const {
        data: facility,
        error: facilityError,
      } = await supabase
        .from("facilities")
        .select("id, user_id, name")
        .eq("id", performanceRequest.facility_id)
        .single();

      if (facilityError || !facility) {
        console.error("施設取得エラー:", facilityError);
      } else {
        const {
          data: facilityUser,
          error: facilityUserError,
        } = await supabase
          .from("users")
          .select("line_user_id, display_name")
          .eq("id", facility.user_id)
          .single();

        if (facilityUserError || !facilityUser) {
          console.error(
            "施設LINEユーザー取得エラー:",
            facilityUserError
          );
        } else {
          const performerName = performer.name || "演奏者";

          const facilityName =
            facility.name ||
            facilityUser.display_name ||
            "施設";

          const detailUrl =
            "https://miniapp.line.me/2011785379-l5XCTbIf/facility/requests/" +
            requestId +
            "/applications";

          const messages = [
            {
              type: "flex",
              altText: "🎵 新しい応募があります！",
              contents: {
                type: "bubble",
                body: {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "🎵 新しい応募があります！",
                      weight: "bold",
                      size: "xl",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text:
                        facilityName +
                        "さんの案件に、" +
                        performerName +
                        "さんから応募がありました。",
                      margin: "md",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text: "案件：" + performanceRequest.title,
                      margin: "md",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text:
                        "演奏日時：" +
                        performanceRequest.performance_date +
                        "\n" +
                        "時間：" +
                        performanceRequest.start_time +
                        " ～ " +
                        performanceRequest.end_time +
                        "\n" +
                        "場所：" +
                        (performanceRequest.area || "未設定"),
                      margin: "md",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text: message
                        ? "応募メッセージ：\n" + message
                        : "応募メッセージ：なし",
                      margin: "md",
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
                        label: "応募者を確認する",
                        uri: detailUrl,
                      },
                    },
                  ],
                },
              },
            },
          ];

          const lineResult = await sendLinePushMessage(
            facilityUser.line_user_id,
            messages
          );

          if (lineResult.success) {
            notificationSent = true;
            console.log("施設へのLINE通知送信成功");
          } else {
            console.error(
              "施設へのLINE通知送信失敗:",
              lineResult.error
            );
          }
        }
      }
    } catch (notificationError) {
      console.error(
        "施設へのLINE通知処理エラー:",
        notificationError
      );
    }

    return NextResponse.json({
      success: true,
      application: data,
      coinBalance: coin.balance_after,
      notificationSent,
    });
  } catch (error) {
    console.error("応募APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}