import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate" };

function disabled() {
  return NextResponse.json(
    { error: "バンド間のコイン送金機能は現在停止しています。" },
    { status: 403, headers: noStore },
  );
}

export async function GET() {
  return disabled();
}

export async function POST() {
  return disabled();
}
