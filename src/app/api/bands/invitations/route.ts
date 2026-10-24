import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { sendLinePushMessage, type LineMessage } from "@/lib/line";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;

async function getAuthenticatedPerformer(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1]?.trim();

  if (!idToken) {
    return {
      error: NextResponse.json(
        { error: "LINEの認証情報がありません。再ログインしてください" },
        { status: 401 }
      ),
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      error: NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください" },
        { status: 401 }
      ),
    };
  }

  if (!supabase) {
    return {
      error: NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      ),
    };
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", verified.userId)
    .maybeSingle();

  if (userError) {
    console.error("招待APIのユーザー取得エラー:", userError);

    return {
      error: NextResponse.json(
        { error: "ユーザー情報の取得に失敗しました" },
        { status: 500 }
      ),
    };
  }

  if (!user) {
    return {
      error: NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      ),
    };
  }

  const { data: performer, error: performerError } = await supabase
    .from("performers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (performerError) {
    console.error("招待APIの演奏者取得エラー:", performerError);

    return {
      error: NextResponse.json(
        { error: "演奏者プロフィールの取得に失敗しました" },
        { status: 500 }
      ),
    };
  }

  if (!performer) {
    return {
      error: NextResponse.json(
        { error: "先に演奏者プロフィールを登録してください" },
        { status: 404 }
      ),
    };
  }

  return { performerId: performer.id };
}

export async function GET(request: NextRequest) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const auth = await getAuthenticatedPerformer(request);

    if ("error" in auth) {
      return auth.error;
    }

    const selectFields =
      "id, band_id, inviter_performer_id, invitee_performer_id, message, status, created_at, responded_at";

    // 自分宛ての未回答の招待を取得
    const { data: receivedRows, error: receivedError } =
      await supabase
        .from("band_invitations")
        .select(selectFields)
        .eq("invitee_performer_id", auth.performerId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100);

    if (receivedError) {
      console.error("受信招待一覧取得エラー:", receivedError);

      return NextResponse.json(
        { error: "受信した招待を取得できませんでした" },
        { status: 500 }
      );
    }

    // 自分が送信した招待を、回答状態にかかわらず取得
    const { data: sentRows, error: sentError } = await supabase
      .from("band_invitations")
      .select(selectFields)
      .eq("inviter_performer_id", auth.performerId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (sentError) {
      console.error("送信招待一覧取得エラー:", sentError);

      return NextResponse.json(
        { error: "送信した招待を取得できませんでした" },
        { status: 500 }
      );
    }

    const received = receivedRows ?? [];
    const sent = sentRows ?? [];
    const allRows = [...received, ...sent];

    const bandIds = [
      ...new Set(allRows.map((item) => item.band_id)),
    ];

    const performerIds = [
      ...new Set(
        allRows.flatMap((item) => [
          item.inviter_performer_id,
          item.invitee_performer_id,
        ])
      ),
    ];

    const bandMap = new Map<
      string,
      { name: string; status: string }
    >();

    const performerMap = new Map<string, string>();

    if (bandIds.length > 0) {
      const { data: bandRows, error: bandsError } = await supabase
        .from("bands")
        .select("id, name, status")
        .in("id", bandIds);

      if (bandsError) {
        console.error("招待履歴のバンド取得エラー:", bandsError);

        return NextResponse.json(
          { error: "バンド情報を取得できませんでした" },
          { status: 500 }
        );
      }

      for (const band of bandRows ?? []) {
        bandMap.set(band.id, {
          name: band.name,
          status: band.status,
        });
      }
    }

    if (performerIds.length > 0) {
      const { data: performerRows, error: performersError } =
        await supabase
          .from("performers")
          .select("id, name")
          .in("id", performerIds);

      if (performersError) {
        console.error(
          "招待履歴の演奏者取得エラー:",
          performersError
        );

        return NextResponse.json(
          { error: "演奏者情報を取得できませんでした" },
          { status: 500 }
        );
      }

      for (const performer of performerRows ?? []) {
        performerMap.set(performer.id, performer.name);
      }
    }

    const receivedInvitations = received.map((invitation) => {
      const band = bandMap.get(invitation.band_id);

      return {
        id: invitation.id,
        bandId: invitation.band_id,
        bandName: band?.name ?? "不明なバンド",
        bandStatus: band?.status ?? "unknown",
        inviterPerformerId: invitation.inviter_performer_id,
        inviterName:
          performerMap.get(invitation.inviter_performer_id) ??
          "不明な演奏者",
        message: invitation.message,
        status: invitation.status,
        createdAt: invitation.created_at,
      };
    });

    const sentInvitations = sent.map((invitation) => {
      const band = bandMap.get(invitation.band_id);

      return {
        id: invitation.id,
        bandId: invitation.band_id,
        bandName: band?.name ?? "不明なバンド",
        bandStatus: band?.status ?? "unknown",
        inviteePerformerId: invitation.invitee_performer_id,
        inviteeName:
          performerMap.get(invitation.invitee_performer_id) ??
          "不明な演奏者",
        message: invitation.message,
        status: invitation.status,
        createdAt: invitation.created_at,
        respondedAt: invitation.responded_at,
      };
    });

    return NextResponse.json({
      performerId: auth.performerId,
      invitations: receivedInvitations,
      sentInvitations,
    });
  } catch (error) {
    console.error("招待一覧APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const auth = await getAuthenticatedPerformer(request);

    if ("error" in auth) {
      return auth.error;
    }

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
      bandId?: unknown;
      inviteePerformerId?: unknown;
      message?: unknown;
    };

    if (
      typeof input.bandId !== "string" ||
      typeof input.inviteePerformerId !== "string"
    ) {
      return NextResponse.json(
        { error: "バンドと招待相手を選択してください" },
        { status: 400 }
      );
    }

    if (
      input.message !== undefined &&
      input.message !== null &&
      typeof input.message !== "string"
    ) {
      return NextResponse.json(
        { error: "招待メッセージの形式が正しくありません" },
        { status: 400 }
      );
    }

    const message =
      typeof input.message === "string" ? input.message.trim() : "";

    if (message.length > 500) {
      return NextResponse.json(
        { error: "招待メッセージは500文字以内で入力してください" },
        { status: 400 }
      );
    }

    if (input.inviteePerformerId === auth.performerId) {
      return NextResponse.json(
        { error: "自分自身を招待することはできません" },
        { status: 400 }
      );
    }

    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("id, name, status")
      .eq("id", input.bandId)
      .maybeSingle();

    if (bandError) {
      console.error("招待対象バンドの取得エラー:", bandError);

      return NextResponse.json(
        { error: "バンド情報を確認できませんでした" },
        { status: 500 }
      );
    }

    if (!band || band.status !== "active") {
      return NextResponse.json(
        { error: "活動中のバンドが見つかりません" },
        { status: 404 }
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("band_members")
      .select("id")
      .eq("band_id", band.id)
      .eq("performer_id", auth.performerId)
      .eq("status", "active")
      .maybeSingle();

    if (membershipError) {
      console.error("バンド所属確認エラー:", membershipError);

      return NextResponse.json(
        { error: "バンドの所属情報を確認できませんでした" },
        { status: 500 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        { error: "このバンドのメンバーだけが招待を送信できます" },
        { status: 403 }
      );
    }

    const { data: invitee, error: inviteeError } = await supabase
      .from("performers")
      .select("id, user_id")
      .eq("id", input.inviteePerformerId)
      .maybeSingle();

    if (inviteeError) {
      console.error("招待先の取得エラー:", inviteeError);

      return NextResponse.json(
        { error: "招待相手を確認できませんでした" },
        { status: 500 }
      );
    }

    if (!invitee) {
      return NextResponse.json(
        { error: "招待相手の演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    const { data: existingMember, error: existingMemberError } =
      await supabase
        .from("band_members")
        .select("id")
        .eq("band_id", band.id)
        .eq("performer_id", invitee.id)
        .eq("status", "active")
        .maybeSingle();

    if (existingMemberError) {
      console.error("既存メンバー確認エラー:", existingMemberError);

      return NextResponse.json(
        { error: "メンバー情報を確認できませんでした" },
        { status: 500 }
      );
    }

    if (existingMember) {
      return NextResponse.json(
        { error: "この演奏者はすでにバンドのメンバーです" },
        { status: 409 }
      );
    }

    const { data: pendingInvitation, error: pendingError } =
      await supabase
        .from("band_invitations")
        .select("id")
        .eq("band_id", band.id)
        .eq("invitee_performer_id", invitee.id)
        .eq("status", "pending")
        .maybeSingle();

    if (pendingError) {
      console.error("既存招待確認エラー:", pendingError);

      return NextResponse.json(
        { error: "既存の招待情報を確認できませんでした" },
        { status: 500 }
      );
    }

    if (pendingInvitation) {
      return NextResponse.json(
        { error: "この演奏者には、すでに未回答の招待を送っています" },
        { status: 409 }
      );
    }

    const { data: invitation, error: insertError } = await supabase
      .from("band_invitations")
      .insert({
        band_id: band.id,
        inviter_performer_id: auth.performerId,
        invitee_performer_id: invitee.id,
        message: message || null,
        status: "pending",
      })
      .select("id, status, created_at")
      .single();

    if (insertError) {
      console.error("バンド招待登録エラー:", insertError);

      return NextResponse.json(
        { error: "招待を送信できませんでした" },
        { status: 500 }
      );
    }

        // 招待先のLINEユーザーIDを取得
    let notificationSent = false;

    const { data: inviteeUser, error: inviteeUserError } =
      await supabase
        .from("users")
        .select("line_user_id")
        .eq("id", invitee.user_id)
        .maybeSingle();

    if (inviteeUserError) {
      console.error(
        "バンド参加依頼の通知先取得エラー:",
        inviteeUserError
      );
    } else if (inviteeUser?.line_user_id) {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

      const requestUrl = liffId
        ? `https://liff.line.me/${liffId}/performer/bands?view=requests`
        : null;

      const notificationMessages: LineMessage[] = requestUrl
        ? [
            {
              type: "flex",
              altText: "🎸 バンドへの参加依頼が届きました",
              contents: {
                type: "bubble",
                size: "kilo",
                header: {
                  type: "box",
                  layout: "vertical",
                  backgroundColor: "#6D28D9",
                  paddingAll: "16px",
                  contents: [
                    {
                      type: "text",
                      text: "🎸 バンド参加依頼",
                      color: "#FFFFFF",
                      weight: "bold",
                      size: "lg",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text: "あなたに新しい招待が届きました",
                      color: "#EDE9FE",
                      size: "xs",
                      wrap: true,
                      margin: "sm",
                    },
                  ],
                },
                body: {
                  type: "box",
                  layout: "vertical",
                  paddingAll: "16px",
                  spacing: "md",
                  contents: [
                    {
                      type: "text",
                      text: "招待されたバンド",
                      size: "xs",
                      color: "#6B7280",
                    },
                    {
                      type: "text",
                      text: band.name || "バンド名未設定",
                      size: "lg",
                      weight: "bold",
                      color: "#111827",
                      wrap: true,
                    },
                    {
                      type: "separator",
                      margin: "sm",
                    },
                    {
                      type: "text",
                      text: "参加依頼が届いています。依頼内容を確認して、参加するかどうかを選んでください。",
                      size: "sm",
                      color: "#374151",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text: message || "招待メッセージはありません。",
                      size: "sm",
                      color: "#6B7280",
                      wrap: true,
                    },
                  ],
                },
                footer: {
                  type: "box",
                  layout: "vertical",
                  paddingAll: "16px",
                  contents: [
                    {
                      type: "button",
                      style: "primary",
                      color: "#6D28D9",
                      height: "md",
                      action: {
                        type: "uri",
                        label: "参加依頼を確認する",
                        uri: requestUrl,
                      },
                    },
                  ],
                },
              },
            },
          ]
        : [
            {
              type: "text",
              text:
                `🎸 バンド参加依頼が届きました。\n` +
                `バンド名：${band.name || "未設定"}\n` +
                `参加依頼をアプリから確認してください。`,
            },
          ];

      try {
        const notificationResult = await sendLinePushMessage(
          inviteeUser.line_user_id,
          notificationMessages
        );

        notificationSent = notificationResult.success;

        if (!notificationResult.success) {
          console.error(
            "バンド参加依頼のLINE通知送信エラー:",
            notificationResult.error
          );
        }
      } catch (notificationError) {
        // 通知に失敗しても、登録済みの招待は取り消さない
        console.error(
          "バンド参加依頼のLINE通知例外:",
          notificationError
        );
      }
    } else {
      console.warn(
        "バンド参加依頼の通知先LINEユーザーIDがありません:",
        invitee.id
      );
    }

    return NextResponse.json(
      {
        success: true,
        notificationSent,
        invitation: {
          id: invitation.id,
          status: invitation.status,
          createdAt: invitation.created_at,
        },
        band: {
          id: band.id,
          name: band.name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("バンド招待APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!supabase) {
      return NextResponse.json(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const auth = await getAuthenticatedPerformer(request);

    if ("error" in auth) {
      return auth.error;
    }

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
      invitationId?: unknown;
      decision?: unknown;
    };

    if (
      typeof input.invitationId !== "string" ||
      !input.invitationId.trim()
    ) {
      return NextResponse.json(
        { error: "回答する招待を選択してください" },
        { status: 400 }
      );
    }

    if (
      input.decision !== "accepted" &&
      input.decision !== "rejected"
    ) {
      return NextResponse.json(
        { error: "承認または拒否を指定してください" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc(
      "respond_to_band_invitation",
      {
        p_invitation_id: input.invitationId,
        p_performer_id: auth.performerId,
        p_decision: input.decision,
      }
    );

    if (error) {
      console.error("招待回答処理エラー:", error);

      const message = error.message || "";

      if (message.includes("invitation_not_found")) {
        return NextResponse.json(
          { error: "招待が見つかりません" },
          { status: 404 }
        );
      }

      if (message.includes("not_invitee")) {
        return NextResponse.json(
          { error: "この招待に回答する権限がありません" },
          { status: 403 }
        );
      }

      if (message.includes("invitation_not_pending")) {
        return NextResponse.json(
          { error: "この招待にはすでに回答済みです" },
          { status: 409 }
        );
      }

      if (message.includes("band_not_active")) {
        return NextResponse.json(
          { error: "このバンドは現在活動していません" },
          { status: 409 }
        );
      }

      if (message.includes("invalid_decision")) {
        return NextResponse.json(
          { error: "回答内容が正しくありません" },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "招待への回答を保存できませんでした" },
        { status: 500 }
      );
    }

    const result = Array.isArray(data) ? data[0] : null;

    return NextResponse.json({
      success: true,
      invitation: result
        ? {
            id: result.invitation_id,
            bandId: result.band_id,
            status: result.status,
          }
        : {
            id: input.invitationId,
            status: input.decision,
          },
    });
  } catch (error) {
    console.error("招待回答APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}