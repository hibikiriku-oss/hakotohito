import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Holidays from "date-holidays";
import { areaMatches } from "@/lib/area-matching";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE_MAX = 10;
const FETCH_BATCH_SIZE = 1000;

const VALID_TARGET_LEVELS = ["beginner", "amateur", "pro"] as const;

type TargetLevel = (typeof VALID_TARGET_LEVELS)[number];
type DateType = "weekday" | "weekendHoliday" | "";

function normalizeTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "";
}

// 日本時間で今日の日付を YYYY-MM-DD 形式で取得
function getJapanToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

// 実在する日付かどうかも検証
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

function getJapanHolidayDates(years: number[]) {
  const holidayCalendar = new Holidays("JP");
  const holidayDates = new Set<string>();

  for (const year of Array.from(new Set(years))) {
    for (const holiday of holidayCalendar.getHolidays(year)) {
      if (holiday.type !== "public") continue;

      const date = String(holiday.date).slice(0, 10);
      if (isValidDate(date)) holidayDates.add(date);
    }
  }

  return holidayDates;
}

function matchesDateType(
  date: string,
  dateType: DateType,
  holidayDates: Set<string>
) {
  if (!dateType) return true;

  const day = new Date(`${date}T12:00:00+09:00`).getDay();
  const isWeekend = day === 0 || day === 6;
  const isHoliday = holidayDates.has(date);

  if (dateType === "weekday") return !isWeekend && !isHoliday;
  if (dateType === "weekendHoliday") return isWeekend || isHoliday;

  return true;
}

function matchesTimeRange(
  requestStart: string,
  requestEnd: string,
  filterStart: string,
  filterEnd: string
) {
  if (!filterStart && !filterEnd) return true;

  const start = normalizeTime(requestStart);
  const end = normalizeTime(requestEnd);

  if (filterStart && filterEnd) {
    return start < filterEnd && end > filterStart;
  }

  if (filterStart) return end > filterStart;

  return start < filterEnd;
}

/**
 * LINEログイン中の演奏者の活動エリアを取得します。
 * areas が未設定の旧データは、従来の area を使用します。
 */
async function getPerformerAreas(lineUserId: string): Promise<string[]> {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (userError) {
    throw new Error(`ユーザー取得エラー: ${userError.message}`);
  }

  if (!user) return [];

  const { data: performer, error: performerError } = await supabase
    .from("performers")
    .select("area, areas")
    .eq("user_id", user.id)
    .maybeSingle();

  if (performerError) {
    throw new Error(`演奏者プロフィール取得エラー: ${performerError.message}`);
  }

  if (!performer) return [];

  const savedAreas = Array.isArray(performer.areas)
    ? performer.areas
    : [];

  return Array.from(
    new Set(
      [...savedAreas, performer.area]
        .filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0
        )
        .map((value) => value.trim())
    )
  );
}

// 演奏依頼一覧取得
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const today = getJapanToday();

    const page = Math.max(
      1,
      Number.parseInt(searchParams.get("page") || "1", 10) || 1
    );

    const limit = Math.min(
      PAGE_SIZE_MAX,
      Math.max(
        1,
        Number.parseInt(searchParams.get("limit") || "10", 10) || 10
      )
    );

    const keyword = (searchParams.get("keyword") || "").trim();
    const area = searchParams.get("area") || "";
    const instrument = searchParams.get("instrument") || "";
    const genre = searchParams.get("genre") || "";
    const date = searchParams.get("date") || "";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";
    const dateType = (searchParams.get("dateType") || "") as DateType;
    const timePreset = searchParams.get("timePreset") || "";
    const requestedTimeStart = searchParams.get("timeStart") || "";
    const requestedTimeEnd = searchParams.get("timeEnd") || "";
    const rewardOnly = searchParams.get("rewardOnly") === "true";
    const sort = searchParams.get("sort") || "newest";

    if (
      dateType &&
      dateType !== "weekday" &&
      dateType !== "weekendHoliday"
    ) {
      return NextResponse.json(
        { error: "開催日の指定が正しくありません" },
        { status: 400 }
      );
    }

    if (date && !isValidDate(date)) {
      return NextResponse.json(
        { error: "開催日の形式が正しくありません" },
        { status: 400 }
      );
    }

    if (
      (dateFrom && !isValidDate(dateFrom)) ||
      (dateTo && !isValidDate(dateTo))
    ) {
      return NextResponse.json(
        { error: "日付範囲の形式が正しくありません" },
        { status: 400 }
      );
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json(
        { error: "開始日は終了日以前の日付にしてください" },
        { status: 400 }
      );
    }

    if (
      (requestedTimeStart && !isValidTime(requestedTimeStart)) ||
      (requestedTimeEnd && !isValidTime(requestedTimeEnd))
    ) {
      return NextResponse.json(
        { error: "時刻の形式が正しくありません" },
        { status: 400 }
      );
    }

    let timeStart = requestedTimeStart;
    let timeEnd = requestedTimeEnd;

    if (timePreset === "morning") {
      timeStart = "06:00";
      timeEnd = "12:00";
    } else if (timePreset === "afternoon") {
      timeStart = "12:00";
      timeEnd = "17:00";
    } else if (timePreset === "evening") {
      timeStart = "17:00";
      timeEnd = "23:59";
    }

    if (timeStart && timeEnd && timeStart >= timeEnd) {
      return NextResponse.json(
        { error: "終了時刻は開始時刻より後にしてください" },
        { status: 400 }
      );
    }

    // LINEユーザーIDが送信された場合は、活動エリアを自動適用します。
    const lineUserId = request.headers.get("x-line-user-id");
    const performerAreas = lineUserId
      ? await getPerformerAreas(lineUserId)
      : null;

    const escapedKeyword = keyword.replace(/[,%()]/g, " ");
    const allMatchingRequests: Record<string, any>[] = [];

    for (let offset = 0; ; offset += FETCH_BATCH_SIZE) {
      let query = supabase
        .from("performance_requests")
        .select(`
          id,
          title,
          description,
          performance_date,
          application_deadline,
          start_time,
          end_time,
          area,
          instruments,
          genres,
          reward,
          target_levels,
          status,
          created_at,
          facilities (
            name,
            facility_type,
            address
          )
        `)
        .eq("status", "open")
        // 応募期限当日は表示。日本時間で翌日になったら除外。
        .gte("application_deadline", today);

      if (escapedKeyword.trim()) {
        query = query.or(
          `title.ilike.%${escapedKeyword.trim()}%,description.ilike.%${escapedKeyword.trim()}%`
        );
      }

      if (area) {
        query = query.eq("area", area);
      }

      if (instrument) {
        query = query.contains("instruments", [instrument]);
      }

      if (genre) {
        query = query.contains("genres", [genre]);
      }

      if (date) {
        query = query.eq("performance_date", date);
      }

      if (dateFrom) {
        query = query.gte("performance_date", dateFrom);
      }

      if (dateTo) {
        query = query.lte("performance_date", dateTo);
      }

      if (rewardOnly) {
        query = query.gt("reward", 0);
      }

      query = query
        .order("created_at", { ascending: false })
        .range(offset, offset + FETCH_BATCH_SIZE - 1);

      const { data, error } = await query;

      if (error) {
        console.error("演奏依頼一覧取得エラー:", error);
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }

      const batch = data || [];
      allMatchingRequests.push(...batch);

      if (batch.length < FETCH_BATCH_SIZE) break;
    }

    let filteredRequests = allMatchingRequests;

    // 活動エリアの自動絞り込み。エリア未設定の案件は除外しません。
    if (performerAreas !== null && performerAreas.length > 0) {
      filteredRequests = filteredRequests.filter((item) => {
        const requestArea =
          typeof item.area === "string" ? item.area.trim() : "";

        if (!requestArea) return true;

        return performerAreas.some((performerArea) =>
          areaMatches(performerArea, requestArea)
        );
      });
    }

    if (dateType) {
      const years = filteredRequests.map((item) =>
        Number(String(item.performance_date).slice(0, 4))
      );

      const holidayDates = getJapanHolidayDates(years);

      filteredRequests = filteredRequests.filter((item) =>
        matchesDateType(
          String(item.performance_date).slice(0, 10),
          dateType,
          holidayDates
        )
      );
    }

    if (timeStart || timeEnd) {
      filteredRequests = filteredRequests.filter((item) =>
        matchesTimeRange(
          item.start_time,
          item.end_time,
          timeStart,
          timeEnd
        )
      );
    }

    if (sort === "date") {
      filteredRequests.sort((a, b) => {
        const dateComparison = String(a.performance_date).localeCompare(
          String(b.performance_date)
        );

        if (dateComparison !== 0) return dateComparison;

        return String(b.created_at).localeCompare(String(a.created_at));
      });
    } else {
      filteredRequests.sort((a, b) => {
        const createdComparison = String(b.created_at).localeCompare(
          String(a.created_at)
        );

        if (createdComparison !== 0) return createdComparison;

        return String(b.id).localeCompare(String(a.id));
      });
    }

    const total = filteredRequests.length;
    const from = (page - 1) * limit;
    const requests = filteredRequests.slice(from, from + limit);

    return NextResponse.json({
      requests,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("演奏依頼一覧APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}

// 演奏依頼登録
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      title,
      description,
      performanceDate,
      applicationDeadline,
      startTime,
      endTime,
      area,
      instruments,
      genres,
      reward,
      targetLevels,
      requestType = "performance",
      maxParticipants,
      participationFee,
      rentalFee,
    } = body;

    if (
      !title ||
      !performanceDate ||
      !applicationDeadline ||
      !startTime ||
      !endTime
    ) {
      return NextResponse.json(
        { error: "必須項目が入力されていません" },
        { status: 400 }
      );
    }

    if (
      typeof performanceDate !== "string" ||
      !isValidDate(performanceDate) ||
      typeof applicationDeadline !== "string" ||
      !isValidDate(applicationDeadline)
    ) {
      return NextResponse.json(
        { error: "演奏日または応募期限の日付が正しくありません" },
        { status: 400 }
      );
    }

    const validRequestTypes = [
      "performance",
      "live",
      "festival",
      "session",
      "rental",
    ];

    if (
      typeof requestType !== "string" ||
      !validRequestTypes.includes(requestType)
    ) {
      return NextResponse.json(
        { error: "募集タイプが正しくありません" },
        { status: 400 }
      );
    }

    if (
      requestType !== "performance" &&
      (!Number.isInteger(Number(maxParticipants)) ||
        Number(maxParticipants) < 1)
    ) {
      return NextResponse.json(
        { error: "最大参加人数は1人以上で入力してください" },
        { status: 400 }
      );
    }

    if (
      participationFee != null &&
      participationFee !== "" &&
      (!Number.isInteger(Number(participationFee)) ||
        Number(participationFee) < 0)
    ) {
      return NextResponse.json(
        { error: "参加費は0円以上の整数で入力してください" },
        { status: 400 }
      );
    }

    if (
      rentalFee != null &&
      rentalFee !== "" &&
      (!Number.isInteger(Number(rentalFee)) ||
        Number(rentalFee) < 0)
    ) {
      return NextResponse.json(
        { error: "レンタル利用料金は0円以上の整数で入力してください" },
        { status: 400 }
      );
    }

    if (
      reward != null &&
      reward !== "" &&
      (!Number.isInteger(Number(reward)) || Number(reward) < 0)
    ) {
      return NextResponse.json(
        { error: "謝礼は0円以上の整数で入力してください" },
        { status: 400 }
      );
    }

    if (
      ["performance", "live", "festival", "session"].includes(requestType) &&
      rentalFee != null &&
      rentalFee !== ""
    ) {
      return NextResponse.json(
        { error: "レンタル以外では利用料金を設定できません" },
        { status: 400 }
      );
    }

    if (
      requestType !== "rental" &&
      participationFee != null &&
      participationFee !== ""
    ) {
      return NextResponse.json(
        { error: "参加費を設定できるのはライブ・フェス・セッションです" },
        { status: 400 }
      );
    }

    const today = getJapanToday();

    if (performanceDate <= today) {
      return NextResponse.json(
        { error: "演奏日は日本時間で明日以降の日付を選択してください" },
        { status: 400 }
      );
    }

    if (applicationDeadline < today) {
      return NextResponse.json(
        { error: "応募期限は日本時間で今日以降の日付を選択してください" },
        { status: 400 }
      );
    }

    if (applicationDeadline >= performanceDate) {
      return NextResponse.json(
        { error: "応募期限は演奏日の前日までに設定してください" },
        { status: 400 }
      );
    }

    if (
      typeof startTime !== "string" ||
      !isValidTime(startTime) ||
      typeof endTime !== "string" ||
      !isValidTime(endTime)
    ) {
      return NextResponse.json(
        { error: "演奏時間の形式が正しくありません" },
        { status: 400 }
      );
    }

    if (startTime >= endTime) {
      return NextResponse.json(
        { error: "終了時間は開始時間より後にしてください" },
        { status: 400 }
      );
    }

    if (
      !Array.isArray(targetLevels) ||
      targetLevels.length === 0 ||
      !targetLevels.every(
        (level: unknown): level is TargetLevel =>
          typeof level === "string" &&
          VALID_TARGET_LEVELS.includes(level as TargetLevel)
      )
    ) {
      return NextResponse.json(
        {
          error:
            "募集対象レベルを1つ以上選択してください。選択できるレベルは初心者・アマチュア・プロです。",
        },
        { status: 400 }
      );
    }

    const normalizedTargetLevels = Array.from(
      new Set<TargetLevel>(targetLevels)
    );

    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報がありません" },
        { status: 400 }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error("ユーザー取得エラー:", userError);
      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        { status: 404 }
      );
    }

    const { data: facility, error: facilityError } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (facilityError || !facility) {
      console.error("施設取得エラー:", facilityError);
      return NextResponse.json(
        { error: "施設プロフィールが見つかりません" },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("performance_requests")
      .insert({
        facility_id: facility.id,
        title: title.trim(),
        description: description || null,
        performance_date: performanceDate,
        application_deadline: applicationDeadline,
        start_time: startTime,
        end_time: endTime,
        area: area || null,
        instruments: Array.isArray(instruments) ? instruments : [],
        genres: Array.isArray(genres) ? genres : [],
        reward:
          reward !== "" && reward !== null && reward !== undefined
            ? Number(reward)
            : null,
        request_type: requestType,
        max_participants:
          requestType !== "performance" ? Number(maxParticipants) : null,
        participation_fee:
          ["live", "festival", "session"].includes(requestType) &&
          participationFee !== "" &&
          participationFee != null
            ? Number(participationFee)
            : null,
        rental_fee:
          requestType === "rental" &&
          rentalFee !== "" &&
          rentalFee != null
            ? Number(rentalFee)
            : null,        
            target_levels: normalizedTargetLevels,
        status: "open",
      })
      .select()
      .single();

    if (error) {
      console.error("演奏依頼登録エラー:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      request: data,
    });
  } catch (error) {
    console.error("演奏依頼APIエラー:", error);
    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}