import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { verifyLineIdToken } from "@/lib/line-auth";

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
      response: NextResponse.json(
        { error: "管理者設定がありません" },
        { status: 500 }
      ),
    };
  }

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1];

  if (!idToken) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "認証が必要です" },
        { status: 401 }
      ),
    };
  }

  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "LINEの本人確認に失敗しました" },
        { status: 401 }
      ),
    };
  }

  if (verified.userId !== adminLineUserId) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "管理者権限がありません" },
        { status: 403 }
      ),
    };
  }

  return {
    authorized: true,
    userId: verified.userId,
  };
}