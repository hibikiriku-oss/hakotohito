import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validTargetLevels = ["初心者", "アマ", "プロ"];

async function getCurrentPerformer(lineUserId: string) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (userError) {
    throw new Error(`ユーザー取得エラー: ${userError.message}`);
  }

  if (!user) return null;

  const { data: performer, error: performerError } = await supabase
    .from("performers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (performerError) {
    throw new Error(
      `演奏者プロフィール取得エラー: ${performerError.message}`
    );
  }

  return performer;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "string")) return null;

  return Array.from(
    new Set(value.map((item) => item.trim()).filter(Boolean))
  );
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
}

// レッスン募集の詳細取得
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!uuidPattern.test(id)) {
      return NextResponse.json(
        { error: "レッスン募集IDが正しくありません" },
        { status: 400 }
      );
    }

    const lineUserId = request.headers.get("x-line-user-id");
    let currentPerformerId: string | null = null;

    if (lineUserId) {
      const performer = await getCurrentPerformer(lineUserId);
      currentPerformerId = performer?.id ?? null;
    }

    const { data: offer, error } = await supabase
      .from("lesson_offers")
      .select(`
        id,
        performer_id,
        title,
        description,
        instruments,
        genres,
        area,
        lesson_date,
        start_time,
        end_time,
        lesson_fee,
        capacity,
        target_levels,
        status,
        created_at,
        reserved_coins,
        performers (
          id,
          user_id,
          name,
          area,
          areas,
          instruments,
          genres,
          bio,
          status_level,
          users (
            display_name,
            picture_url
          )
        )
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("レッスン募集詳細取得エラー:", error);
      return NextResponse.json(
        { error: "レッスン募集の詳細を取得できませんでした" },
        { status: 500 }
      );
    }

    if (!offer) {
      return NextResponse.json(
        { error: "レッスン募集が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      offer: {
        ...offer,
        is_mine: Boolean(
          currentPerformerId &&
            offer.performer_id === currentPerformerId
        ),
      },
    });
  } catch (error) {
    console.error("レッスン募集詳細APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

// レッスン募集の編集保存
export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!uuidPattern.test(id)) {
      return NextResponse.json(
        { error: "レッスン募集IDが正しくありません" },
        { status: 400 }
      );
    }

    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "ログイン情報を確認できません。再度お試しください。" },
        { status: 401 }
      );
    }

    const performer = await getCurrentPerformer(lineUserId);

    if (!performer) {
      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません" },
        { status: 403 }
      );
    }

    const body = await request.json();

    const {
      title,
      description,
      instruments,
      genres,
      targetLevels,
      area,
      lessonDate,
      startTime,
      endTime,
      lessonFee,
      capacity,
    } = body;

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.trim().length > 120
    ) {
      return NextResponse.json(
        { error: "募集タイトルは1〜120文字で入力してください" },
        { status: 400 }
      );
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      return NextResponse.json(
        { error: "募集説明の形式が正しくありません" },
        { status: 400 }
      );
    }

    const normalizedInstruments = normalizeStringArray(instruments);
    const normalizedGenres = normalizeStringArray(genres);
    const normalizedTargetLevels = normalizeStringArray(targetLevels);

    if (
      !normalizedInstruments ||
      !normalizedGenres ||
      !normalizedTargetLevels
    ) {
      return NextResponse.json(
        { error: "楽器・ジャンル・対象ランクの指定が正しくありません" },
        { status: 400 }
      );
    }

    if (
      normalizedTargetLevels.length === 0 ||
      normalizedTargetLevels.some(
        (level) => !validTargetLevels.includes(level)
      )
    ) {
      return NextResponse.json(
        { error: "対象ランクを1つ以上選択してください" },
        { status: 400 }
      );
    }

    if (
      typeof lessonFee !== "number" ||
      !Number.isSafeInteger(lessonFee) ||
      lessonFee < 0
    ) {
      return NextResponse.json(
        { error: "レッスン料金は0以上の整数で入力してください" },
        { status: 400 }
      );
    }

    if (
      typeof capacity !== "number" ||
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      capacity > 100
    ) {
      return NextResponse.json(
        { error: "定員は1〜100人で入力してください" },
        { status: 400 }
      );
    }

    const date = lessonDate || null;
    const start = startTime || null;
    const end = endTime || null;

    if (
      (date === null && (start !== null || end !== null)) ||
      (date !== null && (start === null || end === null))
    ) {
      return NextResponse.json(
        { error: "日時を設定する場合は日付・開始時間・終了時間が必要です" },
        { status: 400 }
      );
    }

    if (
      (date !== null && typeof date !== "string") ||
      (start !== null && typeof start !== "string") ||
      (end !== null && typeof end !== "string") ||
      (date !== null && !isValidDate(date)) ||
      (start !== null && !isValidTime(start)) ||
      (end !== null && !isValidTime(end))
    ) {
      return NextResponse.json(
        { error: "日付または時間の形式が正しくありません" },
        { status: 400 }
      );
    }

    if (start !== null && end !== null && end <= start) {
      return NextResponse.json(
        { error: "終了時間は開始時間より後に設定してください" },
        { status: 400 }
      );
    }

    if (
      area !== undefined &&
      area !== null &&
      typeof area !== "string"
    ) {
      return NextResponse.json(
        { error: "開催エリアの形式が正しくありません" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc(
      "update_lesson_offer_with_levels",
      {
        p_offer_id: id,
        p_performer_id: performer.id,
        p_title: title.trim(),
        p_description: description ?? "",
        p_instruments: normalizedInstruments,
        p_genres: normalizedGenres,
        p_area: typeof area === "string" ? area.trim() : "",
        p_lesson_date: date,
        p_start_time: start,
        p_end_time: end,
        p_lesson_fee: lessonFee,
        p_capacity: capacity,
        p_target_levels: normalizedTargetLevels,
      }
    );

    if (error) {
      console.error("レッスン募集更新RPCエラー:", error);

      return NextResponse.json(
        { error: "募集内容の保存に失敗しました。時間をおいて再度お試しください。" },
        { status: 500 }
      );
    }

    if (!data?.success) {
      return NextResponse.json(
        {
          error: data?.error || "募集内容を更新できませんでした",
          required_coins: data?.required_coins,
          available_coins: data?.available_coins,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: data.message || "募集内容を更新しました",
      reserved_coins: data.reserved_coins,
    });
  } catch (error) {
    console.error("レッスン募集更新APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}