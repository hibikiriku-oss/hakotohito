
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getJapanToday() {
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
    const lineUserId = request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        { error: "LINEユーザー情報を取得できません。" },
        { status: 401 }
      );
    }

    const today = getJapanToday();
    const performerId = await getCurrentPerformerId(lineUserId);

    if (!performerId) {
      return NextResponse.json(
        { error: "演奏者プロフィールが見つかりません。" },
        { status: 404 }
      );
    }

    // 自分が応募した演奏案件
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

    // 今日の演奏案件。自分が応募した案件も後で判定するため、
    // statusで絞り込まず取得する。
    const { data: performanceRequests, error: requestsError } =
      await supabase
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
        `)
        .eq("performance_date", today);

    if (requestsError) throw requestsError;

    const visiblePerformanceRequests = (performanceRequests || [])
      .filter((item) =>
        item.status === "open" ||
        applicationStatusByRequestId.has(item.id)
      )
      .map((item) => ({
        ...item,
        map_type: "performance",
        is_applied: applicationStatusByRequestId.has(item.id),
        application_status:
          applicationStatusByRequestId.get(item.id) ?? null,
	map_address: (() => {
 	 const facilityData: any = item.facilities;
	  const facility = Array.isArray(facilityData)
	    ? facilityData[0]
	    : facilityData;

	  return facility?.address ?? null;
	})(),
      }));

    // 自分が応募したレッスン
    const { data: lessonApplications, error: lessonApplicationsError } =
      await supabase
        .from("lesson_applications")
        .select("lesson_offer_id, status")
        .eq("applicant_performer_id", performerId);

    if (lessonApplicationsError) throw lessonApplicationsError;

    const lessonApplicationStatusByOfferId =
      new Map<string, string>();

    for (const application of lessonApplications || []) {
      lessonApplicationStatusByOfferId.set(
        application.lesson_offer_id,
        application.status
      );
    }

    // 今日の日付のレッスンと、日付未設定のレッスンを取得。
    // 日付未設定は、募集側が開催日を指定していないものとして扱う。
    const { data: lessonOffers, error: lessonOffersError } =
      await supabase
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
        `)
        .or(`lesson_date.eq.${today},lesson_date.is.null`);

    if (lessonOffersError) throw lessonOffersError;

    const visibleLessonOffers = (lessonOffers || [])
      .filter((item) =>
        item.status === "open" ||
        lessonApplicationStatusByOfferId.has(item.id)
      )
      .map((item) => ({
        ...item,
        map_type: "lesson",
        is_applied:
          lessonApplicationStatusByOfferId.has(item.id),
        application_status:
          lessonApplicationStatusByOfferId.get(item.id) ?? null,
        map_address: null,
      }));

    return NextResponse.json({
      success: true,
      date: today,
      performances: visiblePerformanceRequests,
      lessons: visibleLessonOffers,
      total:
        visiblePerformanceRequests.length +
        visibleLessonOffers.length,
    });
  } catch (error) {
    console.error("地図検索APIエラー:", error);

    return NextResponse.json(
      { error: "地図検索データの取得に失敗しました。" },
      { status: 500 }
    );
  }
}
