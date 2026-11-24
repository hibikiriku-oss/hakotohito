import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return NextResponse.json(body, { ...init, headers });
}

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return privateJson(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const { bandId } = await context.params;

    if (!isUuid(bandId)) {
      return privateJson(
        { error: "バンドIDが正しくありません" },
        { status: 400 }
      );
    }

    // LINE IDトークンを検証
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim();

    if (!idToken) {
      return privateJson(
        {
          error: "LINEの認証情報がありません。再ログインしてください",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return privateJson(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください",
        },
        { status: 401 }
      );
    }

    // ログイン中のユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .eq("account_status", "active")
      .maybeSingle();

    if (userError) {
      console.error("バンド詳細のユーザー取得エラー:", userError);

      return privateJson(
        { error: "ユーザー情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!user) {
      return privateJson(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者プロフィールを取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (performerError) {
      console.error(
        "バンド詳細の演奏者取得エラー:",
        performerError
      );

      return privateJson(
        { error: "演奏者情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!performer) {
      return privateJson(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // バンド情報を取得
    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("id, name, description, status, created_at")
      .eq("id", bandId)
      .maybeSingle();

    if (bandError) {
      console.error("バンド詳細取得エラー:", bandError);

      return privateJson(
        { error: "バンド情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!band || band.status !== "active") {
      return privateJson(
        { error: "活動中のバンドが見つかりません" },
        { status: 404 }
      );
    }

    // 閲覧者が現在のアクティブメンバーか確認
    const { data: myMembership, error: membershipError } =
      await supabase
        .from("band_members")
        .select("role, joined_at")
        .eq("band_id", bandId)
        .eq("performer_id", performer.id)
        .eq("status", "active")
        .maybeSingle();

    if (membershipError) {
      console.error("バンド所属確認エラー:", membershipError);

      return privateJson(
        { error: "バンドへの所属を確認できませんでした" },
        { status: 500 }
      );
    }

    if (!myMembership) {
      return privateJson(
        { error: "このバンドのメンバーだけが閲覧できます" },
        { status: 403 }
      );
    }

    // アクティブメンバー一覧を取得
    const { data: memberships, error: membersError } =
      await supabase
        .from("band_members")
        .select("performer_id, role, joined_at")
        .eq("band_id", bandId)
        .eq("status", "active")
        .order("joined_at", { ascending: true });

    if (membersError) {
      console.error("バンドメンバー取得エラー:", membersError);

      return privateJson(
        { error: "バンドメンバーを取得できませんでした" },
        { status: 500 }
      );
    }

    const memberIds = [
      ...new Set(
        (memberships ?? []).map((membership) => membership.performer_id)
      ),
    ];

    let performers: {
      id: string;
      name: string | null;
    }[] = [];

    if (memberIds.length > 0) {
      const { data: performerData, error: performersError } =
        await supabase
          .from("performers")
          .select("id, name")
          .in("id", memberIds);

      if (performersError) {
        console.error(
          "バンドメンバープロフィール取得エラー:",
          performersError
        );

        return privateJson(
          { error: "メンバーのプロフィールを取得できませんでした" },
          { status: 500 }
        );
      }

      performers = performerData ?? [];
    }

    const members = (memberships ?? [])
      .map((membership) => {
        const member = performers.find(
          (item) => item.id === membership.performer_id
        );

        return {
          performerId: membership.performer_id,
          name: member?.name || "名前未設定",
          role: membership.role,
          joinedAt: membership.joined_at,
          isMe: membership.performer_id === performer.id,
        };
      })
      .sort((a, b) => {
        if (a.role === "leader" && b.role !== "leader") return -1;
        if (a.role !== "leader" && b.role === "leader") return 1;

        return a.name.localeCompare(b.name, "ja");
      });

    return privateJson({
      band: {
        id: band.id,
        name: band.name,
        description: band.description,
        createdAt: band.created_at,
        role: myMembership.role,
        joinedAt: myMembership.joined_at,
      },
      members,
    });
  } catch (error) {
    console.error("バンド詳細APIエラー:", error);

    return privateJson(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return privateJson({ error: "サーバーの設定に問題があります" }, { status: 500 });
    }

    const { bandId } = await context.params;
    if (!isUuid(bandId)) {
      return privateJson({ error: "バンドIDが正しくありません" }, { status: 400 });
    }

    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim();
    if (!idToken) {
      return privateJson({ error: "LINEの認証情報がありません。再ログインしてください" }, { status: 401 });
    }

    const verified = await verifyLineIdToken(idToken);
    if (!verified) {
      return privateJson({ error: "LINEの本人確認に失敗しました。再ログインしてください" }, { status: 401 });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .eq("account_status", "active")
      .maybeSingle();
    if (userError) {
      console.error("バンド編集ユーザー取得エラー:", userError.code ?? "UNKNOWN");
      return privateJson({ error: "ユーザー情報を取得できませんでした" }, { status: 500 });
    }
    if (!user) return privateJson({ error: "有効なユーザーが見つかりません" }, { status: 404 });

    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (performerError) {
      console.error("バンド編集演奏者取得エラー:", performerError.code ?? "UNKNOWN");
      return privateJson({ error: "演奏者プロフィールを取得できませんでした" }, { status: 500 });
    }
    if (!performer) return privateJson({ error: "演奏者プロフィールが見つかりません" }, { status: 404 });

    const { data: membership, error: membershipError } = await supabase
      .from("band_members")
      .select("role")
      .eq("band_id", bandId)
      .eq("performer_id", performer.id)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError) {
      console.error("バンド編集権限確認エラー:", membershipError.code ?? "UNKNOWN");
      return privateJson({ error: "バンドの編集権限を確認できませんでした" }, { status: 500 });
    }
    if (membership?.role !== "leader") {
      return privateJson({ error: "バンド名・紹介文を編集できるのはリーダーだけです" }, { status: 403 });
    }

    let body: unknown;
    try { body = await request.json(); } catch {
      return privateJson({ error: "入力内容の形式が正しくありません" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return privateJson({ error: "入力内容が正しくありません" }, { status: 400 });
    }
    const input = body as { name?: unknown; description?: unknown };
    if (typeof input.name !== "string" || input.name.trim().length < 1 || input.name.trim().length > 100) {
      return privateJson({ error: "バンド名は1〜100文字で入力してください" }, { status: 400 });
    }
    if (input.description !== undefined && input.description !== null && typeof input.description !== "string") {
      return privateJson({ error: "紹介文の形式が正しくありません" }, { status: 400 });
    }
    const description = typeof input.description === "string" ? input.description.trim() || null : null;
    if (description && description.length > 1000) {
      return privateJson({ error: "紹介文は1000文字以内で入力してください" }, { status: 400 });
    }

    const { data: updateResult, error: updateError } = await supabase.rpc(
      "update_band_profile",
      {
        p_band_id: bandId,
        p_performer_id: performer.id,
        p_name: input.name.trim(),
        p_description: description,
      }
    );
    if (updateError) {
      console.error("バンド編集エラー:", updateError.code ?? "UNKNOWN");
      return privateJson({ error: "バンド情報を更新できませんでした" }, { status: 500 });
    }
    const result = Array.isArray(updateResult) ? updateResult[0] : updateResult;
    if (!result?.success) {
      return privateJson({ error: result?.error ?? "バンド情報を更新できませんでした" }, { status: 409 });
    }

    return privateJson({ success: true, band: result.band, message: "バンド情報を更新しました" });
  } catch (error) {
    console.error("バンド編集APIエラー:", error instanceof Error ? error.name : "UNKNOWN");
    return privateJson({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    if (!supabase) {
      return privateJson(
        { error: "サーバーの設定に問題があります" },
        { status: 500 }
      );
    }

    const { bandId } = await context.params;

    if (!isUuid(bandId)) {
      return privateJson(
        { error: "バンドIDが正しくありません" },
        { status: 400 }
      );
    }

    // LINE IDトークンを検証
    const authorization = request.headers.get("authorization");
    const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const idToken = tokenMatch?.[1]?.trim();

    if (!idToken) {
      return privateJson(
        {
          error: "LINEの認証情報がありません。再ログインしてください",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return privateJson(
        {
          error: "LINEの本人確認に失敗しました。再ログインしてください",
        },
        { status: 401 }
      );
    }

    // 認証されたLINEユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .eq("account_status", "active")
      .maybeSingle();

    if (userError) {
      console.error("バンド解散のユーザー取得エラー:", userError);

      return privateJson(
        { error: "ユーザー情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!user) {
      return privateJson(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者プロフィールを取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (performerError) {
      console.error("バンド解散の演奏者取得エラー:", performerError);

      return privateJson(
        { error: "演奏者情報を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!performer) {
      return privateJson(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // データベース関数側でもリーダー権限を確認する
    const { data: resultData, error: disbandError } =
      await supabase.rpc("disband_band", {
        p_band_id: bandId,
        p_performer_id: performer.id,
      });

    if (disbandError) {
      console.error("バンド解散処理エラー:", disbandError);

      return privateJson(
        { error: "バンドの解散処理に失敗しました" },
        { status: 500 }
      );
    }

    const result = Array.isArray(resultData)
      ? resultData[0]
      : resultData;

    if (!result || result.success !== true) {
      const message =
        result?.error_message || "バンドを解散できませんでした";

      const statusCode =
        message.includes("リーダーだけ")
          ? 403
          : message.includes("見つかりません")
            ? 404
            : 400;

      return privateJson(
        { error: message },
        { status: statusCode }
      );
    }

    return privateJson({
      success: true,
      message: "バンドを解散しました。",
    });
  } catch (error) {
    console.error("バンド解散APIエラー:", error);

    return privateJson(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}