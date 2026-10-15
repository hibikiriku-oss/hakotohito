import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 演奏依頼一覧取得


export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(
      1,
      Number.parseInt(searchParams.get("page") || "1", 10) || 1
    );

    const limit = Math.min(
      10,
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
    const rewardOnly = searchParams.get("rewardOnly") === "true";
    const sort = searchParams.get("sort") || "newest";

    const from = (page - 1) * limit;
    const to = from + limit - 1;

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
        `,
        { count: "exact" }
      )
      .eq("status", "open");

    if (keyword) {
      const escapedKeyword = keyword.replace(/[,%()]/g, " ");
      query = query.or(
        `title.ilike.%${escapedKeyword}%,description.ilike.%${escapedKeyword}%`
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

    if (rewardOnly) {
      query = query.gt("reward", 0);
    }

    if (sort === "date") {
      query = query
        .order("performance_date", { ascending: true })
        .order("created_at", { ascending: false });
    } else {
      query = query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
    }

    const { data, error, count } = await query.range(from, to);

    if (error) {
      console.error("演奏依頼一覧取得エラー:", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const total = count || 0;

    return NextResponse.json({
      requests: data || [],
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
export async function POST(
  request: NextRequest
) {
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

    if (
      !title ||
      !performanceDate ||
      !startTime ||
      !endTime
    ) {
      return NextResponse.json(
        {
          error:
            "必須項目が入力されていません",
        },
        { status: 400 }
      );
    }

    if (startTime >= endTime) {
      return NextResponse.json(
        {
          error:
            "終了時間は開始時間より後にしてください",
        },
        { status: 400 }
      );
    }

    const lineUserId =
      request.headers.get(
        "x-line-user-id"
      );

    if (!lineUserId) {
      return NextResponse.json(
        {
          error:
            "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    const { data: user, error: userError } =
      await supabase
        .from("users")
        .select("id")
        .eq("line_user_id", lineUserId)
        .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        {
          error:
            "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    const {
      data: facility,
      error: facilityError,
    } = await supabase
      .from("facilities")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (
      facilityError ||
      !facility
    ) {
      console.error(
        "施設取得エラー:",
        facilityError
      );

      return NextResponse.json(
        {
          error:
            "施設プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    const { data, error } =
      await supabase
        .from("performance_requests")
        .insert({
          facility_id: facility.id,
          title,
          description:
            description || null,
          performance_date:
            performanceDate,
          start_time: startTime,
          end_time: endTime,
          area: area || null,
          instruments:
            instruments || [],
          genres:
            genres || [],
          reward:
            reward !== "" &&
            reward !== null
              ? Number(reward)
              : null,
          status: "open",
        })
        .select()
        .single();

    if (error) {
      console.error(
        "演奏依頼登録エラー:",
        error
      );

      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      request: data,
    });
  } catch (error) {
    console.error(
      "演奏依頼APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error:
          "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}