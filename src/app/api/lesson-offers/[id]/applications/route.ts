import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyLineIdToken } from "@/lib/line-auth";
import { drainLineNotificationOutbox } from "@/lib/line-notification-outbox";

function privateJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return NextResponse.json(body, { ...init, headers });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const authorization = request.headers.get("authorization");
const idToken = authorization?.startsWith("Bearer ")
  ? authorization.slice("Bearer ".length)
  : "";

if (!idToken) {
  return privateJson(
    {
      success: false,
      error: "LINEの本人確認情報がありません。再ログインしてください。",
    },
    { status: 401 }
  );
}

const verified = await verifyLineIdToken(idToken);

if (!verified) {
  return privateJson(
    {
      success: false,
      error: "LINEの本人確認に失敗しました。再ログインしてください。",
    },
    { status: 401 }
  );
}

const lineUserId = verified.userId;

    const { id: lessonOfferId } = await context.params;

    if (!uuidPattern.test(lessonOfferId)) {
      return privateJson(
        {
          success: false,
          error: "レッスン募集IDが正しくありません",
        },
        { status: 400 }
      );
    }

    // LINEユーザーからアカウントを特定
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .eq("account_status", "active")
      .maybeSingle();

    if (userError) {
      console.error("応募一覧：ユーザー取得エラー", userError);

      return privateJson(
        {
          success: false,
          error: "ユーザー情報を取得できませんでした",
        },
        { status: 500 }
      );
    }

    if (!user) {
      return privateJson(
        {
          success: false,
          error: "ユーザー登録が見つかりません",
        },
        { status: 404 }
      );
    }

    const { data: currentPerformer, error: performerError } =
      await supabase
        .from("performers")
        .select("id, name")
        .eq("user_id", user.id)
        .maybeSingle();

    if (performerError) {
      console.error(
        "応募一覧：演奏者取得エラー",
        performerError
      );

      return privateJson(
        {
          success: false,
          error: "演奏者情報を取得できませんでした",
        },
        { status: 500 }
      );
    }

    if (!currentPerformer) {
      return privateJson(
        {
          success: false,
          error: "演奏者プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 募集者本人か確認
    const { data: offer, error: offerError } = await supabase
      .from("lesson_offers")
      .select(
        "id, performer_id, title, lesson_date, start_time, end_time"
      )
      .eq("id", lessonOfferId)
      .maybeSingle();

    if (offerError) {
      console.error("応募一覧：募集取得エラー", offerError);

      return privateJson(
        {
          success: false,
          error: "レッスン募集を取得できませんでした",
        },
        { status: 500 }
      );
    }

    if (!offer) {
      return privateJson(
        {
          success: false,
          error: "レッスン募集が見つかりません",
        },
        { status: 404 }
      );
    }

    if (offer.performer_id !== currentPerformer.id) {
      return privateJson(
        {
          success: false,
          error:
            "このレッスンの応募者を確認する権限がありません",
        },
        { status: 403 }
      );
    }

    // この募集への応募だけを取得
    const { data: applications, error: applicationsError } =
      await supabase
        .from("lesson_applications")
        .select(
          "id, lesson_offer_id, applicant_performer_id, message, status, matched_at, created_at"
        )
        .eq("lesson_offer_id", lessonOfferId)
        .order("created_at", { ascending: false });

    if (applicationsError) {
      console.error(
        "レッスン応募一覧取得エラー",
        applicationsError
      );

      return privateJson(
        {
          success: false,
          error: "応募一覧を取得できませんでした",
        },
        { status: 500 }
      );
    }

    const rows = applications ?? [];

    const applicantIds = [
      ...new Set(
        rows.map(
          (application) => application.applicant_performer_id
        )
      ),
    ];

    const performerMap = new Map<
      string,
      {
        id: string;
        user_id: string;
        name: string;
        instruments: string[] | null;
        genres: string[] | null;
        area: string | null;
        areas: string[] | null;
        status_level: string | null;
      }
    >();

    if (applicantIds.length > 0) {
      const { data: performers, error: applicantsError } =
        await supabase
          .from("performers")
          .select(
            "id, user_id, name, instruments, genres, area, areas, status_level"
          )
          .in("id", applicantIds);

      if (applicantsError) {
        console.error(
          "応募者プロフィール取得エラー",
          applicantsError
        );

        return privateJson(
          {
            success: false,
            error: "応募者情報を取得できませんでした",
          },
          { status: 500 }
        );
      }

      for (const performer of performers ?? []) {
        performerMap.set(performer.id, performer);
      }
    }

    const applicantUserIds = [
      ...new Set(
        [...performerMap.values()].map(
          (performer) => performer.user_id
        )
      ),
    ];

    const userMap = new Map<
      string,
      {
        display_name: string | null;
        picture_url: string | null;
      }
    >();

    if (applicantUserIds.length > 0) {
      const {
        data: applicantUsers,
        error: applicantUsersError,
      } = await supabase
        .from("users")
        .select("id, display_name, picture_url")
        .in("id", applicantUserIds);

      if (applicantUsersError) {
        console.error(
          "応募者アカウント取得エラー",
          applicantUsersError
        );

        return privateJson(
          {
            success: false,
            error:
              "応募者のアカウント情報を取得できませんでした",
          },
          { status: 500 }
        );
      }

      for (const applicantUser of applicantUsers ?? []) {
        userMap.set(applicantUser.id, {
          display_name: applicantUser.display_name,
          picture_url: applicantUser.picture_url,
        });
      }
    }

    const result = rows.map((application) => {
      const performer = performerMap.get(
        application.applicant_performer_id
      );

      const applicantUser = performer
        ? userMap.get(performer.user_id)
        : undefined;

      return {
        id: application.id,
        lessonOfferId: application.lesson_offer_id,
        message: application.message,
        status: application.status,
        matchedAt: application.matched_at,
        createdAt: application.created_at,
        applicant: performer
          ? {
              id: performer.id,
              name:
                performer.name ||
                applicantUser?.display_name ||
                "演奏者",
              instruments: performer.instruments ?? [],
              genres: performer.genres ?? [],
              area: performer.area,
              areas: performer.areas ?? [],
              statusLevel: performer.status_level,
              pictureUrl: applicantUser?.picture_url ?? null,
            }
          : null,
      };
    });

    return privateJson({
      success: true,
      offer: {
        id: offer.id,
        title: offer.title,
        lessonDate: offer.lesson_date,
        startTime: offer.start_time,
        endTime: offer.end_time,
      },
      applications: result,
    });
  } catch (error) {
    console.error("レッスン応募一覧APIエラー", error);

    return privateJson(
      {
        success: false,
        error: "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {

  try {
    const authorization = request.headers.get("authorization");
const idToken = authorization?.startsWith("Bearer ")
  ? authorization.slice("Bearer ".length)
  : "";

if (!idToken) {
  return privateJson(
    {
      success: false,
      error: "LINEの本人確認情報がありません。再ログインしてください。",
    },
    { status: 401 }
  );
}

const verified = await verifyLineIdToken(idToken);

if (!verified) {
  return privateJson(
    {
      success: false,
      error: "LINEの本人確認に失敗しました。再ログインしてください。",
    },
    { status: 401 }
  );
}

const lineUserId = verified.userId;

    const { id: lessonOfferId } = await context.params;

    if (!uuidPattern.test(lessonOfferId)) {
      return privateJson(
        {
          success: false,
          error: "レッスン募集IDが正しくありません",
        },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    if (message.length > 1000) {
      return privateJson(
        {
          success: false,
          error: "メッセージは1000文字以内で入力してください",
        },
        { status: 400 }
      );
    }

    // LINEユーザーIDからアカウントを特定
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .eq("account_status", "active")
      .maybeSingle();

    if (userError) {
      console.error(
        "レッスン申し込み：ユーザー取得エラー",
        userError
      );

      return privateJson(
        {
          success: false,
          error: "ユーザー情報の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    if (!user) {
      return privateJson(
        {
          success: false,
          error: "ユーザー登録が見つかりません",
        },
        { status: 404 }
      );
    }

    // 申し込む本人の演奏者プロフィールを特定
    const { data: performer, error: performerError } =
      await supabase
        .from("performers")
        .select("id, name")
        .eq("user_id", user.id)
        .maybeSingle();

    if (performerError) {
      console.error(
        "レッスン申し込み：演奏者取得エラー",
        performerError
      );

      return privateJson(
        {
          success: false,
          error: "演奏者プロフィールの取得に失敗しました",
        },
        { status: 500 }
      );
    }

    if (!performer) {
      return privateJson(
        {
          success: false,
          error:
            "演奏者プロフィールが見つかりません。先に演奏者登録をしてください。",
        },
        { status: 404 }
      );
    }

    // 既存のDB関数による応募・コイン精算処理を維持
    const { data, error } = await supabase.rpc(
      "apply_to_lesson_offer",
      {
        p_lesson_offer_id: lessonOfferId,
        p_applicant_performer_id: performer.id,
        p_message: message || null,
      }
    );

    if (error) {
      console.error("レッスン申し込みRPCエラー:", error);

      return privateJson(
        {
          success: false,
          error:
            "レッスンの申し込み処理に失敗しました。時間をおいて再度お試しください。",
        },
        { status: 500 }
      );
    }

    if (!data || data.success !== true) {
      const errorMessage =
        typeof data?.error === "string"
          ? data.error
          : typeof data?.message === "string"
            ? data.message
            : "レッスンに申し込めませんでした";

      return privateJson(
        {
          success: false,
          error: errorMessage,
          message: errorMessage,
        },
        { status: 400 }
      );
    }

    // lesson_applications INSERTトリガーが同一transaction内でOutbox登録済み。
    // ここでは即時配信を試し、失敗分はworkerの再試行へ委ねる。
    await drainLineNotificationOutbox(supabase, 20);

    return privateJson({
      success: true,
      application_id: data.application_id,
      coins_charged: data.coins_charged ?? 0,
      balance_after: data.balance_after,
      lesson_fee: data.lesson_fee,
      message:
        data.message || "レッスンの申し込みが成立しました",
    });
  } catch (error) {
    console.error("レッスン申し込みAPIエラー:", error);

    return privateJson(
      {
        success: false,
        error: "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}