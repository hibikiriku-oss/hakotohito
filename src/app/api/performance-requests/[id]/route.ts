import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Context = {
  params: Promise<{ id: string }>;
};

async function getFacilityByLineUserId(lineUserId: string) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, user_type")
    .eq("line_user_id", lineUserId)
    .single();

  if (userError || !user) {
    return null;
  }

  if (user.user_type !== "facility") {
    return null;
  }

  const { data: facility, error: facilityError } = await supabase
    .from("facilities")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (facilityError || !facility) {
    return null;
  }

  return facility;
}

export async function GET(
  request: NextRequest,
  context: Context
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
          id,
          user_id,
          name,
          facility_type,
          address,
          description
        )
      `)
      .eq("id", id)
      .single();

    if (error || !data) {
      console.error("案件詳細取得エラー:", error);

      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      request: data,
    });
  } catch (error) {
    console.error("案件詳細APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: Context
) {
  try {
    const { id } = await context.params;

    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 401 }
      );
    }

    const facility = await getFacilityByLineUserId(lineUserId);

    if (!facility) {
      return NextResponse.json(
        { error: "施設ユーザーとして認証できません" },
        { status: 403 }
      );
    }

    const { data: existingRequest, error: existingError } =
      await supabase
        .from("performance_requests")
        .select("id, facility_id, status")
        .eq("id", id)
        .single();

    if (existingError || !existingRequest) {
      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    if (existingRequest.facility_id !== facility.id) {
      return NextResponse.json(
        { error: "この案件を編集する権限がありません" },
        { status: 403 }
      );
    }

    if (existingRequest.status !== "open") {
      return NextResponse.json(
        {
          error:
            "募集終了またはマッチング済みの案件は編集できません",
        },
        { status: 400 }
      );
    }

    const body = await request.json();

    const title =
      typeof body.title === "string" ? body.title.trim() : "";

    const description =
      typeof body.description === "string"
        ? body.description.trim()
        : "";

    const performanceDate =
      typeof body.performance_date === "string"
        ? body.performance_date
        : "";

    const startTime =
      typeof body.start_time === "string"
        ? body.start_time
        : "";

    const endTime =
      typeof body.end_time === "string"
        ? body.end_time
        : "";

    const area =
      typeof body.area === "string"
        ? body.area.trim()
        : "";

    const instruments = Array.isArray(body.instruments)
      ? body.instruments
          .filter((item: unknown) => typeof item === "string")
          .map((item: string) => item.trim())
          .filter(Boolean)
      : [];

    const genres = Array.isArray(body.genres)
      ? body.genres
          .filter((item: unknown) => typeof item === "string")
          .map((item: string) => item.trim())
          .filter(Boolean)
      : [];

    const reward =
      body.reward === null ||
      body.reward === undefined ||
      body.reward === ""
        ? null
        : Number(body.reward);

    if (!title) {
      return NextResponse.json(
        { error: "案件タイトルを入力してください" },
        { status: 400 }
      );
    }

    if (!performanceDate) {
      return NextResponse.json(
        { error: "演奏日を入力してください" },
        { status: 400 }
      );
    }

    if (!startTime || !endTime) {
      return NextResponse.json(
        { error: "開始時間と終了時間を入力してください" },
        { status: 400 }
      );
    }

    if (Number.isNaN(reward)) {
      return NextResponse.json(
        { error: "報酬は数値で入力してください" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("performance_requests")
      .update({
        title,
        description: description || null,
        performance_date: performanceDate,
        start_time: startTime,
        end_time: endTime,
        area: area || null,
        instruments,
        genres,
        reward,
      })
      .eq("id", id)
      .eq("facility_id", facility.id)
      .select()
      .single();

    if (error || !data) {
      console.error("案件更新エラー:", error);

      return NextResponse.json(
        { error: "案件の更新に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "案件を更新しました",
      request: data,
    });
  } catch (error) {
    console.error("案件更新APIエラー:", error);

    return NextResponse.json(
      { error: "案件の更新中にエラーが発生しました" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context
) {
  try {
    const { id } = await context.params;

    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 401 }
      );
    }

    const facility = await getFacilityByLineUserId(lineUserId);

    if (!facility) {
      return NextResponse.json(
        { error: "施設ユーザーとして認証できません" },
        { status: 403 }
      );
    }

    const { data: existingRequest, error: existingError } =
      await supabase
        .from("performance_requests")
        .select("id, facility_id, status")
        .eq("id", id)
        .single();

    if (existingError || !existingRequest) {
      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    if (existingRequest.facility_id !== facility.id) {
      return NextResponse.json(
        { error: "この案件を削除する権限がありません" },
        { status: 403 }
      );
    }

    if (existingRequest.status !== "open") {
      return NextResponse.json(
        {
          error:
            "募集終了またはマッチング済みの案件は削除できません",
        },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("performance_requests")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.id);

    if (error) {
      console.error("案件削除エラー:", error);

      return NextResponse.json(
        { error: "案件の削除に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "案件を削除しました",
    });
  } catch (error) {
    console.error("案件削除APIエラー:", error);

    return NextResponse.json(
      { error: "案件の削除中にエラーが発生しました" },
      { status: 500 }
    );
  }
}