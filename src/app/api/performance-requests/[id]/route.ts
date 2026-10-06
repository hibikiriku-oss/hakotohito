import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id } = await context.params;

    const { data, error } = await supabase
      .from("performance_requests")
      .select(`
        id,
        title,
        description,
        performance_date,
        start_time,
        end_time,
        area,
        instruments,
        genres,
        reward,
        status,
        facilities (
          name,
          facility_type,
          address,
          description
        )
      `)
      .eq("id", id)
      .single();

    if (error || !data) {
      console.error(
        "案件取得エラー:",
        error
      );

      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      request: data,
    });
  } catch (error) {
    console.error(
      "案件詳細APIエラー:",
      error
    );

    return NextResponse.json(
      { error: "サーバーエラー" },
      { status: 500 }
    );
  }
}