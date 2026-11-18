import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "データベースの設定がありません" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await drainLineNotificationOutbox(supabase, 5);
  const success = !result.claimError && result.failedToRecord === 0;
  return NextResponse.json(
    { success, ...result },
    { status: success ? 200 : 500 },
  );
}
