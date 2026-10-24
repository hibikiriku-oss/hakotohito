
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;

type RouteContext = {
  params: Promise<{
    bandId: string;
  }>;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const { bandId } = await context.params;

    if (!isUuid(bandId)) {
      return NextResponse.json(
        { error: "バンドIDが正しくありません" },
        { status: 400 }
      );
    }

    // LINE IDトークンを検証
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim();

    if (!idToken) {
      return NextResponse.json(
        { error: "LINEの認証情報がありません。再ログインしてください" },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください" },
        { status: 401 }
      );
    }

    // 認証済みのLINEユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, coin_balance")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (userError) {
      console.error("送金画面のユーザー取得エラー:", userError);

      return NextResponse.json(
        { error: "ユーザー情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (performerError) {
      console.error("送金画面の演奏者取得エラー:", performerError);

      return NextResponse.json(
        { error: "演奏者情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!performer) {
      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // バンドが活動中か確認
    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("id, name, status")
      .eq("id", bandId)
      .maybeSingle();

    if (bandError) {
      console.error("送金画面のバンド取得エラー:", bandError);

      return NextResponse.json(
        { error: "バンド情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!band || band.status !== "active") {
      return NextResponse.json(
        { error: "活動中のバンドが見つかりません" },
        { status: 404 }
      );
    }

    // 閲覧者自身がアクティブメンバーか確認
    const { data: myMembership, error: myMembershipError } =
      await supabase
        .from("band_members")
        .select("role")
        .eq("band_id", bandId)
        .eq("performer_id", performer.id)
        .eq("status", "active")
        .maybeSingle();

    if (myMembershipError) {
      console.error("送金画面の所属確認エラー:", myMembershipError);

      return NextResponse.json(
        { error: "バンドへの所属を確認できませんでした" },
        { status: 500 }
      );
    }

    if (!myMembership) {
      return NextResponse.json(
        { error: "このバンドのメンバーだけが利用できます" },
        { status: 403 }
      );
    }

    // アクティブメンバーを取得
    const { data: memberships, error: membersError } =
      await supabase
        .from("band_members")
        .select("performer_id, role")
        .eq("band_id", bandId)
        .eq("status", "active");

    if (membersError) {
      console.error("送金対象メンバー取得エラー:", membersError);

      return NextResponse.json(
        { error: "バンドメンバーを取得できませんでした" },
        { status: 500 }
      );
    }

    const memberIds = [
      ...new Set(
        (memberships ?? []).map((member) => member.performer_id)
      ),
    ];

    if (memberIds.length === 0) {
      return NextResponse.json(
        { error: "アクティブメンバーがいません" },
        { status: 404 }
      );
    }

    const { data: performers, error: performersError } =
      await supabase
        .from("performers")
        .select("id, name")
        .in("id", memberIds);

    if (performersError) {
      console.error("送金対象の演奏者取得エラー:", performersError);

      return NextResponse.json(
        { error: "メンバーのプロフィールを取得できませんでした" },
        { status: 500 }
      );
    }

    const members = (performers ?? [])
      .filter((member) => member.id !== performer.id)
      .map((member) => ({
        performerId: member.id,
        name: member.name || "名前未設定",
        role:
          memberships?.find(
            (membership) => membership.performer_id === member.id
          )?.role ?? "member",
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));

    // このユーザーが、このバンドで行った送金・受取履歴を取得
    const { data: transferHistory, error: historyError } =
      await supabase
        .from("coin_transactions")
        .select(
          "id, amount, description, balance_after, created_at"
        )
        .eq("user_id", user.id)
        .eq("band_id", bandId)
        .eq("transaction_type", "band_transfer")
        .order("created_at", { ascending: false })
        .limit(20);

    if (historyError) {
      console.error("バンド送金履歴取得エラー:", historyError);

      return NextResponse.json(
        { error: "送金履歴を取得できませんでした" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      band: {
        id: band.id,
        name: band.name,
      },
      members,
      coinBalance: user.coin_balance ?? 0,
      transferHistory: transferHistory ?? [],
    });
  } catch (error) {
    console.error("送金画面のメンバー取得エラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    // バンドIDの検証
    const { bandId } = await context.params;

    if (!isUuid(bandId)) {
      return NextResponse.json(
        { error: "バンドIDが正しくありません" },
        { status: 400 }
      );
    }

    // LINE IDトークンを検証
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim();

    if (!idToken) {
      return NextResponse.json(
        {
          error: "LINEの認証情報がありません。再ログインしてください",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください",
        },
        { status: 401 }
      );
    }

    // 送金者は認証済みのLINEユーザーから特定する
    const { data: sender, error: senderError } = await supabase
      .from("users")
      .select("id, coin_balance")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (senderError) {
      console.error("バンド送金の送金者取得エラー:", senderError);

      return NextResponse.json(
        { error: "ユーザー情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!sender) {
      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 送金者の演奏者プロフィールを取得
    const { data: senderPerformer, error: performerError } =
      await supabase
        .from("performers")
        .select("id, user_id")
        .eq("user_id", sender.id)
        .maybeSingle();

    if (performerError) {
      console.error("バンド送金の演奏者取得エラー:", performerError);

      return NextResponse.json(
        { error: "演奏者情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!senderPerformer) {
      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // リクエストボディの検証
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "リクエスト形式が正しくありません" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "入力内容が正しくありません" },
        { status: 400 }
      );
    }

    const input = body as {
      recipientPerformerId?: unknown;
      amount?: unknown;
      description?: unknown;
      idempotencyKey?: unknown;
    };

    if (!isUuid(input.recipientPerformerId)) {
      return NextResponse.json(
        { error: "送金先のメンバーを選択してください" },
        { status: 400 }
      );
    }

    if (
      typeof input.amount !== "number" ||
      !Number.isSafeInteger(input.amount) ||
      input.amount <= 0 ||
      input.amount > 2147483647
    ) {
      return NextResponse.json(
        { error: "送金額は1以上の整数で指定してください" },
        { status: 400 }
      );
    }

    if (
      input.description !== undefined &&
      input.description !== null &&
      typeof input.description !== "string"
    ) {
      return NextResponse.json(
        { error: "送金メモの形式が正しくありません" },
        { status: 400 }
      );
    }

    const description =
      typeof input.description === "string"
        ? input.description.trim()
        : "";

    if (description.length > 100) {
      return NextResponse.json(
        { error: "送金メモは100文字以内で入力してください" },
        { status: 400 }
      );
    }

    // 再送時に同じキーを使用し、二重送金を防止する
    if (!isUuid(input.idempotencyKey)) {
      return NextResponse.json(
        { error: "送金リクエストIDが正しくありません" },
        { status: 400 }
      );
    }

    // 送金先の演奏者プロフィールを取得
    const { data: recipient, error: recipientError } =
      await supabase
        .from("performers")
        .select("id, user_id, name")
        .eq("id", input.recipientPerformerId)
        .maybeSingle();

    if (recipientError) {
      console.error("バンド送金の送金先取得エラー:", recipientError);

      return NextResponse.json(
        { error: "送金先の情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!recipient) {
      return NextResponse.json(
        { error: "送金先のメンバーが見つかりません" },
        { status: 404 }
      );
    }

    if (recipient.user_id === sender.id) {
      return NextResponse.json(
        { error: "自分自身には送金できません" },
        { status: 400 }
      );
    }

    // データベース関数内で、バンド所属・残高・予約コイン・
    // 二重送金を検証し、送受信の残高と履歴を一括処理する
    const { data: transferData, error: transferError } =
      await supabase.rpc("transfer_band_coins", {
        p_band_id: bandId,
        p_sender_user_id: sender.id,
        p_recipient_user_id: recipient.user_id,
        p_amount: input.amount,
        p_description: description || "メンバー間コイン送金",
        p_idempotency_key: `${bandId}:${input.idempotencyKey}`,
      });

    if (transferError) {
      console.error("バンド送金処理エラー:", transferError);

      return NextResponse.json(
        {
          error:
            "送金処理に失敗しました。時間をおいて再度お試しください",
        },
        { status: 500 }
      );
    }

    const transfer = Array.isArray(transferData)
      ? transferData[0]
      : transferData;

    if (!transfer || transfer.success !== true) {
      return NextResponse.json(
        {
          error:
            transfer?.error_message ||
            "送金できませんでした",
        },
        { status: 400 }
      );
    }

    // 成功後の送金者の最新残高を取得する
    const { data: latestSender, error: balanceError } =
      await supabase
        .from("users")
        .select("coin_balance")
        .eq("id", sender.id)
        .maybeSingle();

    if (balanceError) {
      console.error("送金後の残高取得エラー:", balanceError);
    }

    return NextResponse.json({
      success: true,
      message: `${recipient.name || "メンバー"}に${input.amount}コイン送金しました`,
      transfer: {
        bandId,
        recipientPerformerId: recipient.id,
        recipientName: recipient.name || "名前未設定",
        amount: input.amount,
        description: description || "メンバー間コイン送金",
      },
      senderBalance:
        latestSender?.coin_balance ??
        transfer.sender_balance_after,
    });
  } catch (error) {
    console.error("バンド送金APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
