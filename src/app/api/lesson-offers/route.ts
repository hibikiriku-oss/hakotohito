import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VALID_TARGET_LEVELS = ["初心者", "アマ", "プロ"];

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;

  const [hours, minutes] = value.split(":").map(Number);

  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (value == null) return [];

  if (
    !Array.isArray(value) ||
    !value.every(
      (item) => typeof item === "string" && item.trim().length > 0
    )
  ) {
    return null;
  }

  return Array.from(new Set(value.map((item: string) => item.trim())));
}

function normalizeTargetLevels(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  if (
    !value.every(
      (item) =>
        typeof item === "string" &&
        VALID_TARGET_LEVELS.includes(item)
    )
  ) {
    return null;
  }

  return Array.from(new Set(value));
}

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
    .select(
      "id, user_id, name, area, areas, instruments, genres, bio, status_level"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (performerError) {
    throw new Error(
      `演奏者プロフィール取得エラー: ${performerError.message}`
    );
  }

  return performer;
}

// レッスン募集一覧。自分の募集も含めて返します。
export async function GET(request: NextRequest) {
  try {
    let currentPerformerId: string | null = null;

const authorization = request.headers.get("authorization");
const idToken = authorization?.startsWith("Bearer ")
  ? authorization.slice("Bearer ".length)
  : "";

if (idToken) {
  const verified = await verifyLineIdToken(idToken);

  if (!verified) {
    return NextResponse.json(
      {
        error: "LINEの本人確認に失敗しました。再ログインしてください。",
      },
      { status: 401 }
    );
  }

  const performer = await getCurrentPerformer(verified.userId);
  currentPerformerId = performer?.id ?? null;
}

    const { searchParams } = new URL(request.url);
    const keyword = (searchParams.get("keyword") || "").trim();
    const area = (searchParams.get("area") || "").trim();
    const instrument = (searchParams.get("instrument") || "").trim();
    const genre = (searchParams.get("genre") || "").trim();

    let query = supabase
      .from("lesson_offers")
      .select(`
        id,
        performer_id,
        title,
        description,
        instruments,
        genres,
        area,
        address,
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
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (keyword) {
      const safeKeyword = keyword.replace(/[,%()]/g, " ").trim();

      if (safeKeyword) {
        query = query.or(
          `title.ilike.%${safeKeyword}%,description.ilike.%${safeKeyword}%`
        );
      }
    }

    if (area) {
      query = query.ilike("area", `%${area}%`);
    }

    if (instrument) {
      query = query.contains("instruments", [instrument]);
    }

    if (genre) {
      query = query.contains("genres", [genre]);
    }

    const { data, error } = await query;

    if (error) {
      console.error("レッスン募集一覧取得エラー:", error);

      return NextResponse.json(
        { error: "レッスン募集の取得に失敗しました" },
        { status: 500 }
      );
    }

    const offers = (data || []).map((offer: any) => ({
      ...offer,
      is_mine: Boolean(
        currentPerformerId &&
          offer.performer_id === currentPerformerId
      ),
    }));

    return NextResponse.json({
      success: true,
      offers,
      total: offers.length,
    });
  } catch (error) {
    console.error("レッスン募集一覧APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

// レッスン募集登録。対象ランクを保存し、定員分のコインを仮押さえします。
export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
const idToken = authorization?.startsWith("Bearer ")
  ? authorization.slice("Bearer ".length)
  : "";

if (!idToken) {
  return NextResponse.json(
    {
      error: "LINEの本人確認情報がありません。再ログインしてください。",
    },
    { status: 401 }
  );
}

const verified = await verifyLineIdToken(idToken);

if (!verified) {
  return NextResponse.json(
    {
      error: "LINEの本人確認に失敗しました。再ログインしてください。",
    },
    { status: 401 }
  );
}

const performer = await getCurrentPerformer(verified.userId);

    if (!performer) {
      return NextResponse.json(
        {
          error:
            "演奏者プロフィールが見つかりません。先に演奏者登録をしてください。",
        },
        { status: 404 }
      );
    }

    const body = await request.json();

    const title =
      typeof body.title === "string" ? body.title.trim() : "";

    const description =
      typeof body.description === "string"
        ? body.description.trim()
        : "";

    const area =
      typeof body.area === "string" ? body.area.trim() : "";

    const address =
      typeof body.address === "string" ? body.address.trim() : "";

    if (address.length > 500) {
      return NextResponse.json(
        { error: "住所は500文字以内で入力してください" },
        { status: 400 }
      );
    }

    const instruments = normalizeStringArray(body.instruments);
    const genres = normalizeStringArray(body.genres);
    const targetLevels = normalizeTargetLevels(body.targetLevels);

    const lessonDate =
      body.lessonDate === "" || body.lessonDate == null
        ? null
        : body.lessonDate;

    const startTime =
      body.startTime === "" || body.startTime == null
        ? null
        : body.startTime;

    const endTime =
      body.endTime === "" || body.endTime == null
        ? null
        : body.endTime;

    const lessonFee =
      body.lessonFee === "" || body.lessonFee == null
        ? 0
        : Number(body.lessonFee);

    const capacity =
      body.capacity === "" || body.capacity == null
        ? 5
        : Number(body.capacity);

    if (!title) {
      return NextResponse.json(
        { error: "レッスンタイトルを入力してください" },
        { status: 400 }
      );
    }

    if (title.length > 120) {
      return NextResponse.json(
        { error: "タイトルは120文字以内で入力してください" },
        { status: 400 }
      );
    }

    if (instruments === null || genres === null) {
      return NextResponse.json(
        { error: "楽器・ジャンルの指定が正しくありません" },
        { status: 400 }
      );
    }

    if (targetLevels === null) {
      return NextResponse.json(
        {
          error:
            "対象ランクを1つ以上選択してください（初心者・アマ・プロ）",
        },
        { status: 400 }
      );
    }

    if (!Number.isSafeInteger(lessonFee) || lessonFee < 0) {
      return NextResponse.json(
        { error: "レッスン料は0円以上の整数で入力してください" },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 100
    ) {
      return NextResponse.json(
        { error: "定員は1〜100人で入力してください" },
        { status: 400 }
      );
    }

    const hasAnyDateTime =
      lessonDate !== null ||
      startTime !== null ||
      endTime !== null;

    if (hasAnyDateTime) {
      if (
        typeof lessonDate !== "string" ||
        !isValidDate(lessonDate) ||
        typeof startTime !== "string" ||
        !isValidTime(startTime) ||
        typeof endTime !== "string" ||
        !isValidTime(endTime)
      ) {
        return NextResponse.json(
          {
            error:
              "日時を設定する場合は、日付・開始時間・終了時間をすべて正しく入力してください",
          },
          { status: 400 }
        );
      }

      if (startTime >= endTime) {
        return NextResponse.json(
          { error: "終了時間は開始時間より後にしてください" },
          { status: 400 }
        );
      }
    }

    // 対象ランク・住所の保存とコイン仮押さえをDB関数で処理
    const { data: result, error } = await supabase.rpc(
      "create_lesson_offer_with_levels_and_address",
      {
        p_performer_id: performer.id,
        p_title: title,
        p_description: description || null,
        p_instruments: instruments,
        p_genres: genres,
        p_area: area || null,
        p_lesson_date: lessonDate,
        p_start_time: startTime,
        p_end_time: endTime,
        p_lesson_fee: lessonFee,
        p_capacity: capacity,
        p_target_levels: targetLevels,
        p_address: address || null,
      }
    );

    if (error) {
      console.error("レッスン募集登録RPCエラー:", error);

      return NextResponse.json(
        {
          error:
            "レッスン募集の登録に失敗しました。時間をおいて再度お試しください。",
        },
        { status: 500 }
      );
    }

    if (!result || result.success !== true) {
      const errorMessage =
        typeof result?.error === "string"
          ? result.error
          : "レッスン募集を登録できませんでした";

      return NextResponse.json(
        {
          success: false,
          error: errorMessage,
          required_coins: result?.required_coins,
          available_coins: result?.available_coins,
        },
        { status: 400 }
      );
    }

    // 登録された募集の詳細を取得して返す
    const { data: offer, error: offerError } = await supabase
      .from("lesson_offers")
      .select(`
        id,
        performer_id,
        title,
        description,
        instruments,
        genres,
        area,
        address,
        lesson_date,
        start_time,
        end_time,
        lesson_fee,
        capacity,
        target_levels,
        status,
        created_at,
        reserved_coins
      `)
      .eq("id", result.offer_id)
      .single();

    if (offerError || !offer) {
      console.error("登録済みレッスン募集の再取得エラー:", offerError);

      // 登録自体は成功しているため、RPC結果から最低限の情報を返します。
      return NextResponse.json({
        success: true,
        offer: {
          id: result.offer_id,
          area: area || null,
          address: address || null,
          target_levels: targetLevels,
          reserved_coins: result.reserved_coins,
        },
        reserved_coins: result.reserved_coins,
        message: result.message,
      });
    }

    return NextResponse.json({
      success: true,
      offer,
      reserved_coins: result.reserved_coins,
      message: result.message,
    });
  } catch (error) {
    console.error("レッスン募集登録APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}