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

    // ログイン中のユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (userError) {
      console.error("バンド詳細のユーザー取得エラー:", userError);

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

    // バンド情報を取得
    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("id, name, description, status, created_at")
      .eq("id", bandId)
      .maybeSingle();

    if (bandError) {
      console.error("バンド詳細取得エラー:", bandError);

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

      return NextResponse.json(
        { error: "バンドへの所属を確認できませんでした" },
        { status: 500 }
      );
    }

    if (!myMembership) {
      return NextResponse.json(
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

      return NextResponse.json(
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

        return NextResponse.json(
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

    return NextResponse.json({
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

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    // 認証されたLINEユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (userError) {
      console.error("バンド解散のユーザー取得エラー:", userError);

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

    // 演奏者プロフィールを取得
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (performerError) {
      console.error("バンド解散の演奏者取得エラー:", performerError);

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

    // データベース関数側でもリーダー権限を確認する
    const { data: resultData, error: disbandError } =
      await supabase.rpc("disband_band", {
        p_band_id: bandId,
        p_performer_id: performer.id,
      });

    if (disbandError) {
      console.error("バンド解散処理エラー:", disbandError);

      return NextResponse.json(
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

      return NextResponse.json(
        { error: message },
        { status: statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      message: "バンドを解散しました。",
    });
  } catch (error) {
    console.error("バンド解散APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}