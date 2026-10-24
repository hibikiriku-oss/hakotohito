import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

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
    console.error("ユーザー取得エラー:", userError);
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
    console.error("演奏者取得エラー:", performerError);
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

    // view=disbanded の場合は解散済みバンドを取得する
    const showDisbanded =
      request.nextUrl.searchParams.get("view") === "disbanded";

    const { data: memberships, error } = await supabase
      .from("band_members")
      .select(
        "role, status, joined_at, bands(id, name, description, status, created_at)"
      )
      .eq("performer_id", auth.performerId)
      .order("joined_at", { ascending: false });

    if (error) {
      console.error("バンド一覧取得エラー:", error);
      return NextResponse.json(
        { error: "バンド一覧を取得できませんでした" },
        { status: 500 }
      );
    }

    const bands = (memberships ?? [])
      .filter((membership) => {
        const band = Array.isArray(membership.bands)
          ? membership.bands[0]
          : membership.bands;

        if (!band) {
          return false;
        }

        if (showDisbanded) {
          // 解散済みバンドかつ、過去に所属していたメンバーだけ表示
          return (
            membership.status === "left" &&
            band.status === "disbanded"
          );
        }

        // 通常の一覧には活動中のバンドだけ表示
        return (
          membership.status === "active" &&
          band.status === "active"
        );
      })
      .map((membership) => {
        const band = Array.isArray(membership.bands)
          ? membership.bands[0]
          : membership.bands;

        return {
          id: band!.id,
          name: band!.name,
          description: band!.description,
          status: band!.status,
          createdAt: band!.created_at,
          role: membership.role,
          joinedAt: membership.joined_at,
        };
      });

    return NextResponse.json({
      bands,
      view: showDisbanded ? "disbanded" : "active",
    });
  } catch (error) {
    console.error("バンド一覧APIエラー:", error);
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
      name?: unknown;
      description?: unknown;
    };

    if (
      typeof input.name !== "string" ||
      input.name.trim().length < 1 ||
      input.name.trim().length > 100
    ) {
      return NextResponse.json(
        { error: "バンド名は1〜100文字で入力してください" },
        { status: 400 }
      );
    }

    if (
      input.description !== undefined &&
      input.description !== null &&
      typeof input.description !== "string"
    ) {
      return NextResponse.json(
        { error: "紹介文の形式が正しくありません" },
        { status: 400 }
      );
    }

    const description =
      typeof input.description === "string"
        ? input.description.trim() || null
        : null;

    const { data: created, error: createError } = await supabase.rpc(
      "create_band_with_leader",
      {
        p_performer_id: auth.performerId,
        p_name: input.name.trim(),
        p_description: description,
      }
    );

    if (createError) {
      console.error("バンド作成エラー:", createError);
      return NextResponse.json(
        { error: "バンドを作成できませんでした" },
        { status: 500 }
      );
    }

    const band = Array.isArray(created) ? created[0] : null;

    if (!band?.band_id) {
      console.error("バンド作成結果が不正です:", created);
      return NextResponse.json(
        { error: "バンド作成結果を確認できませんでした" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        band: {
          id: band.band_id,
          name: band.band_name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("バンド作成APIエラー:", error);
    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}