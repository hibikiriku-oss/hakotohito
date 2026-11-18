import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error("CRON_SECRET が設定されていません");
      return NextResponse.json(
        { error: "応募期限処理の設定がありません" },
        { status: 500 }
      );
    }

    if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase の環境変数が設定されていません");
      return NextResponse.json(
        { error: "データベースの設定がありません" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase.rpc(
      "expire_pending_application_attempts",
      { p_limit: 5000 }
    );

    if (error) {
      console.error("応募期限処理RPCエラー:", error);
      return NextResponse.json(
        { error: "応募期限の更新に失敗しました" },
        { status: 500 }
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    const expiredCount = Number(result?.expired_count ?? 0);

    return NextResponse.json({
      success: true,
      expiredCount,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("応募期限処理エラー:", error);
    return NextResponse.json(
      { error: "応募期限処理に失敗しました" },
      { status: 500 }
    );
  }
}
