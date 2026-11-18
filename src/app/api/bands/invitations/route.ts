import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    .select("id, account_status, user_type")
    .eq("line_user_id", verified.userId)
    .eq("account_status", "active")
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

  if (user.account_status !== "active") {
    return {
      error: NextResponse.json(
        { error: "このアカウントは現在利用できません" },
        { status: 403 }
      ),
    };
  }

  if (user.user_type !== "performer") {
    return {
      error: NextResponse.json(
        { error: "演奏者アカウントでログインしてください" },
        { status: 403 }
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

  return { performerId: performer.id, lineUserId: verified.userId };
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

    return NextResponse.json(
      {
        performerId: auth.performerId,
        invitations: receivedInvitations,
        sentInvitations,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
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
      !UUID_PATTERN.test(input.bandId) ||
      typeof input.inviteePerformerId !== "string" ||
      !UUID_PATTERN.test(input.inviteePerformerId)
    ) {
      return NextResponse.json(
        { error: "バンドと招待相手を正しく選択してください" },
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

    // 招待を送信できるのは、アクティブなリーダーのみ
    const { data: membership, error: membershipError } = await supabase
      .from("band_members")
      .select("id, role")
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
        { error: "このバンドのメンバーではありません" },
        { status: 403 }
      );
    }

    if (membership.role !== "leader") {
      return NextResponse.json(
        { error: "バンド招待を送信できるのはリーダーのみです" },
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

    const { data: creation, error: insertError } = await supabase.rpc(
      "create_band_invitation_atomic",
      {
        p_inviter_performer_id: auth.performerId,
        p_band_id: band.id,
        p_invitee_performer_id: invitee.id,
        p_message: message || null,
        p_line_user_id: auth.lineUserId,
      }
    );

    if (insertError || !creation?.success) {
      const errorCode = creation?.errorCode;
      if (["already_member", "pending_invitation"].includes(errorCode)) {
        return NextResponse.json(
          { error: errorCode === "already_member" ? "この演奏者はすでにバンドのメンバーです" : "この演奏者には、すでに未回答の招待を送っています" },
          { status: 409 }
        );
      }
      if (errorCode === "not_active_leader") {
        return NextResponse.json(
          { error: "バンド招待を送信できるのは現在のリーダーのみです" },
          { status: 403 }
        );
      }
      if (errorCode === "band_not_active") {
        return NextResponse.json(
          { error: "活動中のバンドが見つかりません" },
          { status: 404 }
        );
      }
      if (errorCode === "invitee_not_found" || errorCode === "inviter_inactive") {
        return NextResponse.json(
          { error: "招待相手または招待者のアカウントを確認できませんでした" },
          { status: 403 }
        );
      }
      console.error("バンド招待登録エラー:", insertError?.message || errorCode);
      return NextResponse.json(
        { error: "招待を送信できませんでした" },
        { status: 500 }
      );
    }
    const invitation = creation.invitation;
    const createdBand = creation.band;

    // 招待登録と通知Outbox登録はINSERTトリガーで同一transaction内に確定済み。
    const creationDelivery = await drainLineNotificationOutbox(supabase, 20);
    const notificationSent = creationDelivery.sent > 0;

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
          id: createdBand.id,
          name: createdBand.name,
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
      !UUID_PATTERN.test(input.invitationId)
    ) {
      return NextResponse.json(
        { error: "回答する招待を正しく選択してください" },
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

    // 回答処理の前に、招待した側と対象バンドを取得する
    const {
      data: invitationContext,
      error: invitationContextError,
    } = await supabase
      .from("band_invitations")
      .select("id, band_id, inviter_performer_id")
      .eq("id", input.invitationId)
      .maybeSingle();

    if (invitationContextError) {
      console.error(
        "招待通知用データの取得エラー:",
        invitationContextError
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

    const responseDelivery = await drainLineNotificationOutbox(supabase, 20);
    const notificationSent = responseDelivery.sent > 0;

    return NextResponse.json({
      success: true,
      notificationSent,
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