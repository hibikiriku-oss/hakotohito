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

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function jsonResponse(
  body: Record<string, unknown>
) {
  return NextResponse.json(body, {
    headers: NO_STORE_HEADERS,
  });
}

function emptyAnnouncement() {
  return {
    message: "",
    isActive: false,
    updatedAt: null,
  };
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("admin_announcements")
      .select("message, is_active, updated_at")
      .eq("id", 1)
      .single();

    if (error || !data) {
      console.error("Public announcement GET error:", {
        code: error?.code ?? "NO_DATA",
      });

      return jsonResponse(emptyAnnouncement());
    }

    const rawMessage =
      typeof data.message === "string" ? data.message.trim() : "";

    const message =
      data.is_active && rawMessage ? rawMessage : "";

    return jsonResponse({
      message,
      isActive: message.length > 0,
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error("Public announcement GET exception:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });

    return jsonResponse(emptyAnnouncement());
  }
}