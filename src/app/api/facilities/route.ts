import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getIdToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

async function getFacilityUser(request: NextRequest) {
  const idToken = getIdToken(request);

  if (!idToken) {
    return {
      error: "LINEの本人確認情報がありません。再ログインしてください。",
      status: 401,
      user: null,
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      error: "LINEの本人確認に失敗しました。再ログインしてください。",
      status: 401,
      user: null,
    };
  }

  const { data: user, error } = await supabase
    .from("users")
    .select("id, user_type, avatar_type, avatar_emoji")
    .eq("line_user_id", verified.userId)
    .single();

  if (error || !user) {
    return {
      error: "ユーザー情報が見つかりません",
      status: 404,
      user: null,
    };
  }

  if (user.user_type !== "facility") {
    return {
      error: "施設ユーザーとして認証できません",
      status: 403,
      user: null,
    };
  }

  return {
    error: null,
    status: 200,
    user,
  };
}

// ========================================
// 施設プロフィール取得
// ========================================
export async function GET(request: NextRequest) {
  try {
    const auth = await getFacilityUser(request);

    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error },
        {
          status: auth.status,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const { data: facility, error } = await supabase
      .from("facilities")
      .select("id, user_id, name, facility_type, address, description")
      .eq("user_id", auth.user.id)
      .single();

    if (error || !facility) {
      console.error("施設プロフィール取得エラー:", error);

      return NextResponse.json(
        { error: "施設プロフィールが見つかりません" },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        facility: {
          ...facility,
          avatar_type: auth.user.avatar_type ?? "line",
          avatar_emoji: auth.user.avatar_emoji ?? null,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("施設プロフィール取得APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

// ========================================
// 施設プロフィール登録
// ========================================
export async function POST(request: NextRequest) {
  try {
    const auth = await getFacilityUser(request);

    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const body = await request.json();

    const {
      name,
      facilityType,
      address,
      description,
      avatarType,
      avatarEmoji,
    } = body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof facilityType !== "string" ||
      !facilityType.trim() ||
      typeof address !== "string" ||
      !address.trim()
    ) {
      return NextResponse.json(
        { error: "必須項目が入力されていません" },
        { status: 400 }
      );
    }

    const normalizedAvatarType = avatarType ?? "line";

    if (
      normalizedAvatarType !== "line" &&
      normalizedAvatarType !== "emoji"
    ) {
      return NextResponse.json(
        { error: "プロフィールアイコンの設定が正しくありません" },
        { status: 400 }
      );
    }

    if (
      normalizedAvatarType === "emoji" &&
      (typeof avatarEmoji !== "string" || !avatarEmoji.trim())
    ) {
      return NextResponse.json(
        { error: "絵文字アイコンを選択してください" },
        { status: 400 }
      );
    }

    const { error: avatarError } = await supabase
      .from("users")
      .update({
        avatar_type: normalizedAvatarType,
        avatar_emoji:
          normalizedAvatarType === "emoji"
            ? avatarEmoji.trim()
            : null,
      })
      .eq("id", auth.user.id);

    if (avatarError) {
      console.error("プロフィールアイコン保存エラー:", avatarError);

      return NextResponse.json(
        { error: "プロフィールアイコンの保存に失敗しました" },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from("facilities")
      .upsert(
        {
          user_id: auth.user.id,
          name: name.trim(),
          facility_type: facilityType.trim(),
          address: address.trim(),
          description:
            typeof description === "string"
              ? description.trim()
              : "",
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("施設登録エラー:", error);

      return NextResponse.json(
        { error: "施設プロフィールの登録に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      facility: data,
    });
  } catch (error) {
    console.error("施設登録APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

// ========================================
// 施設プロフィール更新
// ========================================
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getFacilityUser(request);

    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const body = await request.json();

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    const facilityType =
      typeof body.facilityType === "string"
        ? body.facilityType.trim()
        : "";

    const address =
      typeof body.address === "string"
        ? body.address.trim()
        : "";

    const description =
      typeof body.description === "string"
        ? body.description.trim()
        : "";

    const avatarType = body.avatarType;
    const avatarEmoji =
      typeof body.avatarEmoji === "string"
        ? body.avatarEmoji.trim()
        : "";

    if (!name || !facilityType || !address) {
      return NextResponse.json(
        { error: "施設名・施設種類・住所は必須項目です" },
        { status: 400 }
      );
    }

    if (avatarType !== "line" && avatarType !== "emoji") {
      return NextResponse.json(
        { error: "プロフィールアイコンの設定が正しくありません" },
        { status: 400 }
      );
    }

    if (avatarType === "emoji" && !avatarEmoji) {
      return NextResponse.json(
        { error: "絵文字アイコンを選択してください" },
        { status: 400 }
      );
    }

    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .update({
        name,
        facility_type: facilityType,
        address,
        description,
      })
      .eq("user_id", auth.user.id)
      .select("id, user_id, name, facility_type, address, description")
      .single();

    if (facilityError || !facility) {
      console.error("施設プロフィール更新エラー:", facilityError);

      return NextResponse.json(
        { error: "施設プロフィールの更新に失敗しました" },
        { status: 500 }
      );
    }

    const { error: avatarError } = await supabase
      .from("users")
      .update({
        avatar_type: avatarType,
        avatar_emoji: avatarType === "emoji" ? avatarEmoji : null,
      })
      .eq("id", auth.user.id);

    if (avatarError) {
      console.error("プロフィールアイコン更新エラー:", avatarError);

      return NextResponse.json(
        { error: "プロフィールアイコンの更新に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      facility: {
        ...facility,
        avatar_type: avatarType,
        avatar_emoji: avatarType === "emoji" ? avatarEmoji : null,
      },
    });
  } catch (error) {
    console.error("施設プロフィール更新APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}