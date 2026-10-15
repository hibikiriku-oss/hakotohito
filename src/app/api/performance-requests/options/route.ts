import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("performance_requests")
      .select("area, instruments, genres")
      .eq("status", "open");

    if (error) {
      console.error("絞り込み候補の取得エラー:", error);

      return NextResponse.json(
        { error: "絞り込み候補の取得に失敗しました" },
        { status: 500 }
      );
    }

    const areas = Array.from(
      new Set(
        (data || [])
          .map((item) => item.area)
          .filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0
          )
      )
    ).sort((a, b) => a.localeCompare(b, "ja"));

    const instruments = Array.from(
      new Set(
        (data || []).flatMap((item) =>
          Array.isArray(item.instruments)
            ? item.instruments.filter(
                (value): value is string =>
                  typeof value === "string" && value.trim().length > 0
              )
            : []
        )
      )
    ).sort((a, b) => a.localeCompare(b, "ja"));

    const genres = Array.from(
      new Set(
        (data || []).flatMap((item) =>
          Array.isArray(item.genres)
            ? item.genres.filter(
                (value): value is string =>
                  typeof value === "string" && value.trim().length > 0
              )
            : []
        )
      )
    ).sort((a, b) => a.localeCompare(b, "ja"));

    return NextResponse.json({
      areas,
      instruments,
      genres,
    });
  } catch (error) {
    console.error("絞り込み候補APIエラー:", error);

    return NextResponse.json(
      { error: "絞り込み候補の取得中にエラーが発生しました" },
      { status: 500 }
    );
  }
}