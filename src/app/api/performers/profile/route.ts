import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { normalizeRequiredStringArray } from "@/lib/profile-input";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return NextResponse.json(body, { ...init, headers });
}

// ========================================
// 演奏者プロフィール取得
// ========================================
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

    // LINEユーザー取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .eq("account_status", "active")
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return privateJson(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // 演奏者プロフィール取得
    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select(
        "id, user_id, name, instruments, genres, area, areas, bio, status_level"
      )
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error("演奏者プロフィール取得エラー:", performerError);

      return privateJson(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // 既存データで areas が空の場合は、従来の area を利用する
    const areas =
      Array.isArray(performer.areas) && performer.areas.length > 0
        ? performer.areas
        : performer.area
          ? [performer.area]
          : [];

    return privateJson({
      success: true,
      performer: {
        ...performer,
        areas,
      },
    });
  } catch (error) {
    console.error("プロフィール取得APIエラー:", error);

    return privateJson(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

// ========================================
// 演奏者プロフィール更新
// ========================================
export async function PATCH(request: NextRequest) {
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

    const body = await request.json();

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    // areas が送られた場合は複数エリアとして処理する。
    // 旧バージョンから area だけ送られた場合にも対応する。
    const rawAreas: unknown[] = Array.isArray(body.areas)
      ? body.areas
      : typeof body.area === "string"
        ? body.area.split(",")
        : [];

    const areas = rawAreas
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);

    // 従来の area カラムには先頭の活動エリアを保存する
    const area = areas[0] ?? "";

    const bio =
      typeof body.bio === "string" ? body.bio.trim() : "";

    const statusLevel =
      typeof body.statusLevel === "string"
        ? body.statusLevel.trim()
        : "";

    const instruments = normalizeRequiredStringArray(body.instruments);
    const genres = normalizeRequiredStringArray(body.genres);

    if (
      !name ||
      areas.length === 0 ||
      !instruments ||
      !genres ||
      !statusLevel
    ) {
      return privateJson(
        { error: "必須項目を入力してください" },
        { status: 400 }
      );
    }

    // 演奏レベルの値を厳密にチェック
    if (!["beginner", "amateur", "pro"].includes(statusLevel)) {
      return privateJson(
        { error: "演奏レベルの指定が正しくありません" },
        { status: 400 }
      );
    }

    // LINEユーザー取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .eq("account_status", "active")
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);

      return privateJson(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    // このLINEユーザーの演奏者プロフィールを取得
    const { data: performer, error: performerError } = await supabase
      .from("performers")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error("演奏者プロフィール取得エラー:", performerError);

      return privateJson(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    // プロフィール更新
    const { data: updatedPerformer, error: updateError } = await supabase
      .from("performers")
      .update({
        name,
        area,
        areas,
        instruments,
        genres,
        bio,
        status_level: statusLevel,
      })
      .eq("id", performer.id)
      .select(
        "id, user_id, name, instruments, genres, area, areas, bio, status_level"
      )
      .single();

    if (updateError) {
      console.error("プロフィール更新エラー:", updateError);

      return privateJson(
        { error: "プロフィールの更新に失敗しました" },
        { status: 500 }
      );
    }

    return privateJson({
      success: true,
      performer: updatedPerformer,
    });
  } catch (error) {
    console.error("プロフィール更新APIエラー:", error);

    return privateJson(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}