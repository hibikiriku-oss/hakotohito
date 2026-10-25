import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("admin_announcements")
      .select("message, is_active, updated_at")
      .eq("id", 1)
      .single();

    if (error || !data) {
      console.error("Public announcement GET error:", error);

      return NextResponse.json(
        { message: "", isActive: false, updatedAt: null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const message =
      data.is_active && data.message.trim()
        ? data.message.trim()
        : "";

    return NextResponse.json(
      {
        message,
        isActive: message.length > 0,
        updatedAt: data.updated_at,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Public announcement GET exception:", error);

    return NextResponse.json(
      { message: "", isActive: false, updatedAt: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}