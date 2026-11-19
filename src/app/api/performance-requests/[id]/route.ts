
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = {
  params: Promise<{ id: string }>;
};

async function getFacilityByLineUserId(lineUserId: string) {
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, user_type")
    .eq("line_user_id", lineUserId)
    .eq("account_status", "active")
    .maybeSingle();

  if (userError || !user || user.user_type !== "facility") {
    return null;
  }

  const { data: facility, error: facilityError } = await supabase
    .from("facilities")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (facilityError || !facility) {
    return null;
  }

  return facility;
}

// 案件詳細取得
export async function GET(
  request: NextRequest,
  context: Context
) {
  try {
    const authorization = request.headers.get("authorization");
    const idToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!idToken) {
      return NextResponse.json(
        { error: "ログインが必要です。LINEでログインしてください。" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const verified = await verifyLineIdToken(idToken);

    if (!verified) {
      return NextResponse.json(
        { error: "LINEの本人確認に失敗しました。再ログインしてください。" },
        {
          status: 401,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, user_type")
      .eq("line_user_id", verified.userId)
      .eq("account_status", "active")
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json(
        { error: "ユーザー情報が見つかりません" },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const { id } = await context.params;

    let query = supabase
      .from("performance_requests")
      .select(`
        *,
        facilities!inner (
          id,
          name,
          facility_type,
          description,
          users!inner(id)
        )
      `)
      .eq("facilities.users.account_status", "active")
      .eq("id", id);

    if (user.user_type === "performer") {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      query = query
        .eq("status", "open")
        .gte("application_deadline", today);
    } else if (user.user_type === "facility") {
      const facility = await getFacilityByLineUserId(verified.userId);

      if (!facility) {
        return NextResponse.json(
          { error: "施設プロフィールが見つかりません" },
          {
            status: 403,
            headers: { "Cache-Control": "no-store" },
          }
        );
      }

      query = query.eq("facility_id", facility.id);
    } else {
      return NextResponse.json(
        { error: "このユーザーには閲覧権限がありません" },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("案件詳細取得エラー:", error);

      return NextResponse.json(
        { error: "案件情報の取得に失敗しました" },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error:
            "案件が見つからないか、この案件を表示する権限がありません",
        },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const facilityRelation = data.facilities;
    const safeFacility = facilityRelation && typeof facilityRelation === "object"
      ? (() => {
          const { users: _ownerJoin, ...publicFacility } = facilityRelation as any;
          return publicFacility;
        })()
      : facilityRelation;

    return NextResponse.json(
      { request: { ...data, facilities: safeFacility } },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("案件詳細APIエラー:", error);

    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}

// 案件編集
export async function PATCH(
  request: NextRequest,
  context: Context
) {
  try {
    const { id } = await context.params;

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

    const facility = await getFacilityByLineUserId(verified.userId);

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

    const venueAddress =
      typeof body.venue_address === "string"
        ? body.venue_address.trim()
        : "";

    if (
      body.venue_address != null &&
      typeof body.venue_address !== "string"
    ) {
      return NextResponse.json(
        { error: "開催場所住所の形式が正しくありません" },
        { status: 400 }
      );
    }

    if (venueAddress.length > 500) {
      return NextResponse.json(
        { error: "開催場所住所は500文字以内で入力してください" },
        { status: 400 }
      );
    }

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
        venue_address: venueAddress || null,
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

// 案件削除
export async function DELETE(
  request: NextRequest,
  context: Context
) {
  try {
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: "案件IDが正しくありません" }, { status: 400 });
    }

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

    const facility = await getFacilityByLineUserId(verified.userId);

    if (!facility) {
      return NextResponse.json(
        { error: "施設ユーザーとして認証できません" },
        { status: 403 }
      );
    }

    const { data: deletion, error: deletionError } = await supabase.rpc(
      "delete_open_performance_request_atomic",
      {
        p_request_id: id,
        p_facility_id: facility.id,
        p_line_user_id: verified.userId,
      }
    );

    if (deletionError || !deletion?.success) {
      const errorCode = deletion?.errorCode;
      if (errorCode === "not_found") {
        return NextResponse.json({ error: "案件が見つかりません" }, { status: 404 });
      }
      if (errorCode === "not_owner") {
        return NextResponse.json({ error: "この案件を削除する権限がありません" }, { status: 403 });
      }
      if (errorCode === "facility_inactive") {
        return NextResponse.json({ error: "施設アカウントが現在利用できません" }, { status: 403 });
      }
      if (errorCode === "not_open") {
        return NextResponse.json({ error: "募集中の案件のみ削除できます。募集終了またはマッチング済みの案件は削除できません。" }, { status: 409 });
      }
      if (errorCode === "has_applications") {
        return NextResponse.json({ error: "応募履歴がある案件は削除できません。応募状況をご確認ください。" }, { status: 409 });
      }
      if (errorCode === "has_matches") {
        return NextResponse.json({ error: "マッチング履歴がある案件は削除できません。" }, { status: 409 });
      }
      if (errorCode === "has_application_attempts") {
        return NextResponse.json({ error: "応募試行履歴がある案件は削除できません。" }, { status: 409 });
      }
      if (errorCode === "unreviewed_dependency") {
        console.error("案件削除RPC: 未監査の依存関係またはDELETE triggerを検出しました");
        return NextResponse.json({ error: "案件の関連データ構造が未確認のため、安全のため削除を中止しました" }, { status: 409 });
      }
      console.error("案件削除RPCエラー:", deletionError?.message || errorCode);
      return NextResponse.json({ error: "案件の削除に失敗しました" }, { status: 500 });
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
