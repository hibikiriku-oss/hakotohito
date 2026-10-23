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

  if (userError || !user || user.user_type !== "facility") {
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
        *,
        facilities (
          id,
          name,
          facility_type,
          address,
          description
        )
      `)
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "案件が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({ request: data });
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
        .select(
          "id, facility_id, status, request_type, participation_fee, rental_fee"
        )
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
        { status: 409 }
      );
    }

    const body = await request.json();

    const VALID_TARGET_LEVELS = ["beginner", "amateur", "pro"] as const;
    type TargetLevel = (typeof VALID_TARGET_LEVELS)[number];

    if (
      !Array.isArray(body.target_levels) ||
      body.target_levels.length === 0 ||
      !body.target_levels.every(
        (level: unknown): level is TargetLevel =>
          typeof level === "string" &&
          VALID_TARGET_LEVELS.includes(level as TargetLevel)
      )
    ) {
      return NextResponse.json(
        {
          error:
            "募集対象ランクを1つ以上選択してください。選択できるランクは初心者・アマチュア・プロです。",
        },
        { status: 400 }
      );
    }

    const normalizedTargetLevels = Array.from(
      new Set<TargetLevel>(body.target_levels)
    );

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

    const applicationDeadline =
      typeof body.application_deadline === "string"
        ? body.application_deadline
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
      typeof body.area === "string" ? body.area.trim() : "";

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

    const participationFee =
      body.participation_fee === null ||
      body.participation_fee === undefined ||
      body.participation_fee === ""
        ? null
        : Number(body.participation_fee);

    const rentalFee =
      body.rental_fee === null ||
      body.rental_fee === undefined ||
      body.rental_fee === ""
        ? null
        : Number(body.rental_fee);

    const requestType = existingRequest.request_type;

    if (
      participationFee !== null &&
      (
        !Number.isInteger(participationFee) ||
        participationFee < 0
      )
    ) {
      return NextResponse.json(
        { error: "参加費は0以上の整数で入力してください" },
        { status: 400 }
      );
    }

    if (
      rentalFee !== null &&
      (!Number.isInteger(rentalFee) || rentalFee < 0)
    ) {
      return NextResponse.json(
        { error: "レンタル利用料金は0以上の整数で入力してください" },
        { status: 400 }
      );
    }

    if (
      ["live", "festival", "session"].includes(requestType) &&
      rentalFee !== null
    ) {
      return NextResponse.json(
        { error: "この募集タイプではレンタル利用料金を設定できません" },
        { status: 400 }
      );
    }

    if (requestType === "rental" && participationFee !== null) {
      return NextResponse.json(
        { error: "レンタルでは参加費を設定できません" },
        { status: 400 }
      );
    }

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

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    if (!applicationDeadline) {
      return NextResponse.json(
        { error: "募集期限を入力してください" },
        { status: 400 }
      );
    }

    if (performanceDate <= today) {
      return NextResponse.json(
        { error: "演奏日は明日以降の日付を指定してください" },
        { status: 400 }
      );
    }

    if (applicationDeadline < today) {
      return NextResponse.json(
        { error: "募集期限は今日以降の日付を指定してください" },
        { status: 400 }
      );
    }

    if (applicationDeadline >= performanceDate) {
      return NextResponse.json(
        { error: "募集期限は演奏日の前日までに設定してください" },
        { status: 400 }
      );
    }

    if (!startTime || !endTime) {
      return NextResponse.json(
        { error: "開始時間と終了時間を入力してください" },
        { status: 400 }
      );
    }

    if (reward !== null && !Number.isFinite(reward)) {
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
        application_deadline: applicationDeadline,
        start_time: startTime,
        end_time: endTime,
        area: area || null,
        instruments,
        genres,
        reward,
        target_levels: normalizedTargetLevels,
        participation_fee:
          ["live", "festival", "session"].includes(requestType)
            ? participationFee
            : null,
        rental_fee:
          requestType === "rental" ? rentalFee : null,
      })
      .eq("id", id)
      .eq("facility_id", facility.id)
      .eq("status", "open")
      .select()
      .maybeSingle();

    if (error) {
      console.error("案件更新エラー:", error);

      return NextResponse.json(
        { error: "案件の更新に失敗しました" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error:
            "この案件は編集できません。マッチング済み、または募集終了している可能性があります。",
        },
        { status: 409 }
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
        .select(
          "id, facility_id, status, request_type, participation_fee, rental_fee"
        )
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
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("performance_requests")
      .delete()
      .eq("id", id)
      .eq("facility_id", facility.id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("案件削除エラー:", error);

      return NextResponse.json(
        { error: "案件の削除に失敗しました" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error:
            "この案件は削除できません。マッチング済み、または募集終了している可能性があります。",
        },
        { status: 409 }
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