import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function privateError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

export async function requireAdmin(
  request: NextRequest
): Promise<
  | { authorized: true; userId: string }
  | { authorized: false; response: NextResponse }
> {
  const adminLineUserId = process.env.ADMIN_LINE_USER_ID;

  if (!adminLineUserId) {
    console.error("ADMIN_LINE_USER_ID が設定されていません");

    return {
      authorized: false,
      response: privateError("管理者設定がありません", 500),
    };
  }

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1];

  if (!idToken) {
    return {
      authorized: false,
      response: privateError("認証が必要です", 401),
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      authorized: false,
      response: privateError("LINEの本人確認に失敗しました", 401),
    };
  }

  if (verified.userId !== adminLineUserId) {
    return {
      authorized: false,
      response: privateError("管理者権限がありません", 403),
    };
  }

  // LINE IDの一致だけでなく、DB上の管理者アカウントが現在も
  // activeであることを確認する。退会・停止後のトークン再利用を拒否。
  const { data: adminUser, error: adminUserError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", verified.userId)
    .eq("account_status", "active")
    .maybeSingle();

  if (adminUserError) {
    console.error("管理者アカウント状態確認エラー:", adminUserError);
    return {
      authorized: false,
      response: privateError("管理者アカウントを確認できません", 500),
    };
  }

  if (!adminUser) {
    return {
      authorized: false,
      response: privateError("有効な管理者アカウントがありません", 403),
    };
  }

  return {
    authorized: true,
    userId: verified.userId,
  };
}