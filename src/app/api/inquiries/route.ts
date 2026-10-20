import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_CATEGORIES = [
  "bug",
  "account",
  "coins",
  "suggestion",
  "other",
] as const;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const idToken =
      typeof body.idToken === "string" ? body.idToken : "";
    const category =
      typeof body.category === "string" ? body.category : "";
    const subject =
      typeof body.subject === "string" ? body.subject.trim() : "";
    const message =
      typeof body.message === "string" ? body.message.trim() : "";

    if (!idToken) {
      return NextResponse.json(
        { error: "LINEの本人確認情報がありません。再ログインしてください。" },
        { status: 401 }
      );
    }

    if (
      !ALLOWED_CATEGORIES.includes(
        category as (typeof ALLOWED_CATEGORIES)[number]
      ) ||
      subject.length < 1 ||
      subject.length > 100 ||
      message.length < 1 ||
      message.length > 5000
    ) {
      return NextResponse.json(
        { error: "カテゴリ・件名・問い合わせ内容を確認してください。" },
        { status: 400 }
      );
    }

    // LINE公式の検証APIで本人確認
    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
        { status: 401 }
      );
    }

    // 検証済みのLINEユーザーIDからDB上のユーザーを取得
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", verified.userId)
      .maybeSingle();

    if (userError) {
      console.error("問い合わせユーザー取得エラー:", userError.message);

      return NextResponse.json(
        { error: "ユーザー情報を取得できませんでした。" },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { error: "ユーザー登録が見つかりません。先にホーム画面から登録してください。" },
        { status: 403 }
      );
    }

    const { data: inquiry, error: insertError } = await supabase
      .from("inquiries")
      .insert({
        user_id: user.id,
        category,
        subject,
        message,
      })
      .select("id, category, subject, message, status, created_at")
      .single();

    if (insertError) {
      console.error("問い合わせ保存エラー:", insertError.message);

      return NextResponse.json(
        { error: "問い合わせを保存できませんでした。" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        inquiry,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("問い合わせ送信APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました。" },
      { status: 500 }
    );
  }
}