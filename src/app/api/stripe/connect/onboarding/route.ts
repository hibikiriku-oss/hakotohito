import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST() {
  return NextResponse.json({ error: "Stripe Connect登録は今回の限定公開では利用できません。" }, { status: 403, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
