import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const OTHER_VALUE = "__OTHER__";

const STANDARD_INSTRUMENTS = [
  "ピアノ",
  "ギター",
  "ベース",
  "ドラム",
  "サックス",
  "バイオリン",
];

const STANDARD_GENRES = [
  "ポップス",
  "ロック",
  "ジャズ",
  "クラシック",
];

function getJapanToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseList(value: string | null): string[] {
  if (!value) return [];

  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function matchesCategory(
  itemValues: string[] | null | undefined,
  selectedValues: string[],
  standardValues: string[]
): boolean {
  if (selectedValues.length === 0) return true;

  const values = Array.isArray(itemValues)
    ? itemValues.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0
      )
    : [];

  if (values.length === 0) return false;

  // 「その他」と「__OTHER__」の両方に対応
  const normalSelections = selectedValues.filter(
    (value) => value !== OTHER_VALUE && value !== "その他"
  );

  const includeOther =
    selectedValues.includes(OTHER_VALUE) ||
    selectedValues.includes("その他");

  const matchesNormal =
    normalSelections.length > 0 &&
    values.some((value) => normalSelections.includes(value));

  const matchesOther =
    includeOther &&
    values.some((value) => !standardValues.includes(value));

  return matchesNormal || matchesOther;
}

async function getCurrentPerformerId(lineUserId: string) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (userError) throw userError;
  if (!user) return null;

  const { data: performer, error: performerError } = await supabase
    .from("performers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (performerError) throw performerError;

  return performer?.id ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!idToken) {
      return NextResponse.json(
        {
          success: false,
          error: "LINEの本人確認情報がありません。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        {
          success: false,
          error: "LINEの本人確認に失敗しました。再ログインしてください。",
        },
        { status: 401 }
      );
    }

    const params = request.nextUrl.searchParams;

    let startDate = params.get("startDate");
    const endDate = params.get("endDate");

    if (startDate && !isValidDate(startDate)) {
      return NextResponse.json(
        { success: false, error: "開始日が正しくありません。" },
        { status: 400 }
      );
    }

    if (endDate && !isValidDate(endDate)) {
      return NextResponse.json(
        { success: false, error: "終了日が正しくありません。" },
        { status: 400 }
      );
    }

    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json(
        {
          success: false,
          error: "終了日は開始日以降の日付を指定してください。",
        },
        { status: 400 }
      );
    }

    // 開始日・終了日とも未指定なら今日以降を対象にする
    if (!startDate && !endDate) {
      startDate = getJapanToday();
    }

    const startTime = params.get("startTime");
    const endTime = params.get("endTime");

    if (
      (startTime && !isValidTime(startTime)) ||
      (endTime && !isValidTime(endTime))
    ) {
      return NextResponse.json(
        { success: false, error: "時間帯の指定が正しくありません。" },
        { status: 400 }
      );
    }

    if (startTime && endTime && startTime >= endTime) {
      return NextResponse.json(
        {
          success: false,
          error: "終了時間は開始時間より後にしてください。",
        },
        { status: 400 }
      );
    }

    const useTimeFilter = Boolean(startTime && endTime);

    const instruments = parseList(params.get("instruments"));
    const genres = parseList(params.get("genres"));

    const performerId = await getCurrentPerformerId(verified.userId);

    if (!performerId) {
      return NextResponse.json(
        {
          success: false,
          error: "演奏者プロフィールが見つかりません。",
        },
        { status: 404 }
      );
    }

    // 自分が応募した演奏案件を取得
    const { data: applications, error: applicationsError } =
      await supabase
        .from("applications")
        .select("request_id, status")
        .eq("performer_id", performerId);

    if (applicationsError) throw applicationsError;

    const applicationStatusByRequestId = new Map<string, string>();

    for (const application of applications || []) {
      applicationStatusByRequestId.set(
        application.request_id,
        application.status
      );
    }

    // 演奏案件を取得
    let performanceQuery = supabase
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
        request_type,
        status,
        facilities (
          id,
          name,
          facility_type,
          address
        )
      `);

    if (startDate) {
      performanceQuery = performanceQuery.gte(
        "performance_date",
        startDate
      );
    }

    if (endDate) {
      performanceQuery = performanceQuery.lte(
        "performance_date",
        endDate
      );
    }

    if (useTimeFilter) {
      performanceQuery = performanceQuery
        .not("start_time", "is", null)
        .not("end_time", "is", null)
        .lt("start_time", endTime!)
        .gt("end_time", startTime!);
    }

    const {
      data: performanceRequests,
      error: requestsError,
    } = await performanceQuery.order("performance_date", {
      ascending: true,
    });

    if (requestsError) throw requestsError;

    const visiblePerformanceRequests = (performanceRequests || [])
      .filter(
        (item) =>
          item.status === "open" ||
          applicationStatusByRequestId.has(item.id)
      )
      .filter((item) => {
        const instrumentMatch = matchesCategory(
          item.instruments,
          instruments,
          STANDARD_INSTRUMENTS
        );

        const genreMatch = matchesCategory(
          item.genres,
          genres,
          STANDARD_GENRES
        );

        return instrumentMatch && genreMatch;
      })
      .map((item) => {
        const facilityData: any = item.facilities;
        const facility = Array.isArray(facilityData)
          ? facilityData[0]
          : facilityData;

        return {
          ...item,
          map_type: "performance",
          is_applied: applicationStatusByRequestId.has(item.id),
          application_status:
            applicationStatusByRequestId.get(item.id) ?? null,
          map_address: facility?.address ?? null,
        };
      });

    // 自分が応募したレッスン募集を取得
    const {
      data: lessonApplications,
      error: lessonApplicationsError,
    } = await supabase
      .from("lesson_applications")
      .select("lesson_offer_id, status")
      .eq("applicant_performer_id", performerId);

    if (lessonApplicationsError) throw lessonApplicationsError;

    const lessonApplicationStatusByOfferId = new Map<string, string>();

    for (const application of lessonApplications || []) {
      lessonApplicationStatusByOfferId.set(
        application.lesson_offer_id,
        application.status
      );
    }

    // レッスン募集を取得（日付未設定の募集も対象）
    let lessonQuery = supabase
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
        performers (
          id,
          name,
          area,
          areas
        )
      `);

    if (startDate && endDate && startDate === endDate) {
      lessonQuery = lessonQuery.or(
        `lesson_date.eq.${startDate},lesson_date.is.null`
      );
    } else if (startDate && endDate) {
      lessonQuery = lessonQuery.or(
        `lesson_date.is.null,and(lesson_date.gte.${startDate},lesson_date.lte.${endDate})`
      );
    } else if (startDate) {
      lessonQuery = lessonQuery.or(
        `lesson_date.is.null,lesson_date.gte.${startDate}`
      );
    } else if (endDate) {
      lessonQuery = lessonQuery.or(
        `lesson_date.is.null,lesson_date.lte.${endDate}`
      );
    }

    if (useTimeFilter) {
      lessonQuery = lessonQuery
        .not("start_time", "is", null)
        .not("end_time", "is", null)
        .lt("start_time", endTime!)
        .gt("end_time", startTime!);
    }

    const { data: lessonOffers, error: lessonOffersError } =
      await lessonQuery.order("lesson_date", {
        ascending: true,
        nullsFirst: false,
      });

    if (lessonOffersError) throw lessonOffersError;

    const visibleLessonOffers = (lessonOffers || [])
      .filter(
        (item) =>
          item.status === "open" ||
          lessonApplicationStatusByOfferId.has(item.id)
      )
      .filter((item) => {
        const instrumentMatch = matchesCategory(
          item.instruments,
          instruments,
          STANDARD_INSTRUMENTS
        );

        const genreMatch = matchesCategory(
          item.genres,
          genres,
          STANDARD_GENRES
        );

        return instrumentMatch && genreMatch;
      })
      .map((item) => ({
        ...item,
        map_type: "lesson",
        is_applied: lessonApplicationStatusByOfferId.has(item.id),
        application_status:
          lessonApplicationStatusByOfferId.get(item.id) ?? null,
        map_address: null,
      }));

    return NextResponse.json({
      success: true,
      date: startDate === endDate ? startDate : null,
      startDate,
      endDate,
      performances: visiblePerformanceRequests,
      lessons: visibleLessonOffers,
      total:
        visiblePerformanceRequests.length +
        visibleLessonOffers.length,
    });
  } catch (error) {
    console.error("地図検索APIエラー:", error);

    return NextResponse.json(
      {
        success: false,
        error: "地図検索データの取得に失敗しました。",
      },
      { status: 500 }
    );
  }
}