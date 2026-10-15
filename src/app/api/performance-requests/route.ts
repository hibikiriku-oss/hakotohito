import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Holidays from "date-holidays";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE_MAX = 10;
const FETCH_BATCH_SIZE = 1000;

type DateType = "weekday" | "weekendHoliday" | "";

function normalizeTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "";
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function getJapanHolidayDates(years: number[]) {
  const holidayCalendar = new Holidays("JP");
  const holidayDates = new Set<string>();

  for (const year of Array.from(new Set(years))) {
    for (const holiday of holidayCalendar.getHolidays(year)) {
      if (holiday.type !== "public") continue;

      const date = String(holiday.date).slice(0, 10);

      if (isValidDate(date)) {
        holidayDates.add(date);
      }
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

  // 正午の日本時間として日付を解釈し、曜日のずれを防ぎます。
  const day = new Date(`${date}T12:00:00+09:00`).getDay();
  const isWeekend = day === 0 || day === 6;
  const isHoliday = holidayDates.has(date);

  if (dateType === "weekday") {
    return !isWeekend && !isHoliday;
  }

  if (dateType === "weekendHoliday") {
    return isWeekend || isHoliday;
  }

  return true;
}

function matchesTimeRange(
  requestStart: string,
  requestEnd: string,
  filterStart: string,
  filterEnd: string
) {
  if (!filterStart && !filterEnd) return true;

  // 指定時間と演奏案件の時間が重なっているか判定します。
  const start = normalizeTime(requestStart);
  const end = normalizeTime(requestEnd);

  if (filterStart && filterEnd) {
    return start < filterEnd && end > filterStart;
  }

  if (filterStart) {
    return end > filterStart;
  }

  return start < filterEnd;
}

// 演奏依頼一覧取得
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

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

    if (
      timeStart &&
      timeEnd &&
      timeStart >= timeEnd
    ) {
      return NextResponse.json(
        { error: "終了時刻は開始時刻より後にしてください" },
        { status: 400 }
      );
    }

    const escapedKeyword = keyword.replace(/[,%()]/g, " ");
    const allMatchingRequests: Record<string, any>[] = [];

    // 高度な日付・時間の絞り込みを正確に行うため、
    // DB側の条件に一致する案件をまとめて取得してからページ分割します。
    for (let offset = 0; ; offset += FETCH_BATCH_SIZE) {
      let query = supabase
        .from("performance_requests")
        .select(
          `
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
            created_at,
            facilities (
              name,
              facility_type,
              address
            )
          `
        )
        .eq("status", "open");

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

      if (batch.length < FETCH_BATCH_SIZE) {
        break;
      }
    }

    let filteredRequests = allMatchingRequests;

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
      startTime,
      endTime,
      area,
      instruments,
      genres,
      reward,
    } = body;

    if (!title || !performanceDate || !startTime || !endTime) {
      return NextResponse.json(
        { error: "必須項目が入力されていません" },
        { status: 400 }
      );
    }

    if (startTime >= endTime) {
      return NextResponse.json(
        { error: "終了時間は開始時間より後にしてください" },
        { status: 400 }
      );
    }

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
        title,
        description: description || null,
        performance_date: performanceDate,
        start_time: startTime,
        end_time: endTime,
        area: area || null,
        instruments: instruments || [],
        genres: genres || [],
        reward:
          reward !== "" && reward !== null ? Number(reward) : null,
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