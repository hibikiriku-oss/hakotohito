import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const USER_FIELDS =
  "id, display_name, picture_url, avatar_type, avatar_emoji, user_type, account_status";

// ログイン中の本人の有効なユーザー情報を取得
export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!idToken) {
      return NextResponse.json(
        { error: "LINEの本人確認情報がありません。再ログインしてください。" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified?.userId) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const { data: user, error } = await supabase
      .from("users")
      .select(USER_FIELDS)
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (error) {
      console.error("ユーザー情報取得エラー:", error);

      return NextResponse.json(
        { error: "ユーザー情報の取得に失敗しました" },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    if (!user || !["active", "pending_approval"].includes(user.account_status)) {
      return NextResponse.json(
        { error: "有効なユーザー情報が見つかりません" },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    return NextResponse.json(
      { user },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("ユーザー情報取得APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}

// 新規登録・退会後の再登録
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { idToken, displayName, pictureUrl, userType } = body;

    if (
      typeof idToken !== "string" ||
      !idToken ||
      typeof userType !== "string"
    ) {
      return NextResponse.json(
        { error: "必要な情報がありません" },
        { status: 400 }
      );
    }

    if (
      userType !== "performer" &&
      userType !== "facility"
    ) {
      return NextResponse.json(
        { error: "ユーザー種別が不正です" },
        { status: 400 }
      );
    }

    // LINE公式の検証APIで本人確認
    const verified = await verifyLineIdToken(idToken);

    if (!verified?.userId) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
        { status: 401 }
      );
    }

    // 既に有効なアカウントがある場合は変更しない
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select(USER_FIELDS)
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (fetchError) {
      console.error("既存ユーザー確認エラー:", fetchError);

      return NextResponse.json(
        { error: "ユーザー情報の確認に失敗しました" },
        { status: 500 }
      );
    }

    if (existingUser && ["active", "pending_approval"].includes(existingUser.account_status)) {
      return NextResponse.json(
        { user: existingUser },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 退会済みレコードは再利用せず、新しいアカウント登録へ進む。
    // 退会時のLINE連携情報匿名化により、過去レコードとは別に登録できる。
    if (existingUser && existingUser.account_status !== "withdrawn") {
      return NextResponse.json(
        { error: "このアカウントは現在利用できません。管理者にお問い合わせください。" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 新規登録。退会済みアカウントの履歴は引き継がない。
    // 初期コイン付与の可否はDBトリガーが登録履歴で判定する。
    const { data: insertedUser, error: insertError } = await supabase
      .from("users")
      .insert({
        line_user_id: verified.userId,
        display_name:
          typeof displayName === "string"
            ? displayName
            : "",
        picture_url:
          typeof pictureUrl === "string"
            ? pictureUrl
            : null,
        user_type: userType,
        account_status: "pending_approval",
        coin_balance: 0,
      })
      .select(USER_FIELDS)
      .single();

    if (insertError) {
      // 同時登録などで一意制約に当たった場合は、
      // 有効なアカウントを再取得する。
      if (insertError.code === "23505") {
        const { data: racedUser, error: racedFetchError } =
          await supabase
            .from("users")
            .select(USER_FIELDS)
            .eq("line_user_id", verified.userId)
            .maybeSingle();

        if (!racedFetchError && racedUser && ["active", "pending_approval"].includes(racedUser.account_status)) {
          return NextResponse.json(
            { user: racedUser },
            { headers: { "Cache-Control": "no-store" } }
          );
        }
      }

      console.error("ユーザー登録DBエラー:", insertError);

      return NextResponse.json(
        { error: "ユーザー登録に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { user: insertedUser },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("ユーザー登録APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}