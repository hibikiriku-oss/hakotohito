
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type User = {
  display_name: string | null;
  picture_url?: string | null;
  avatar_type?: string | null;
  avatar_emoji?: string | null;
};

type Relation<T> = T | T[] | null;

type Performer = {
  id: string;
  name: string | null;
  area?: string | null;
  areas?: string[];
  instruments: string[];
  genres: string[];
  bio: string | null;
  users?: User | null;
};

type ApiPerformer = Omit<Performer, "users"> & {
  users?: Relation<User>;
};

type BandMember = {
  id: string;
  name: string | null;
  role?: string | null;
  instruments?: string[];
  genres?: string[];
  users?: Relation<User>;
};

type BandInfo = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  members: BandMember[];
};

type Application = {
  id: string;
  message: string | null;
  status: string;
  source?: string;
  created_at: string;
  performers: Performer | null;
  band_id?: string | null;
  applicationType?: "band" | "individual";
  band: BandInfo | null;
};

type ApiApplication = Omit<
  Application,
  "performers" | "band"
> & {
  performers: Relation<ApiPerformer>;
  band: BandInfo | null;
};

type PerformanceRequest = {
  id: string;
  title: string;
};

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_name: string;
};

type ReviewData = {
  average_rating: number;
  review_count: number;
  reviews: Review[];
};

type ApplicationsResponse = {
  request?: PerformanceRequest;
  performanceRequest?: PerformanceRequest;
  applications?: ApiApplication[];
  hasMore?: boolean;
  acceptedParticipantCount?: number;
  error?: string;
};

function getOne<T>(
  value: Relation<T> | undefined
): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizePerformer(
  value: Relation<ApiPerformer>
): Performer | null {
  const performer = getOne(value);

  if (!performer) {
    return null;
  }

  return {
    ...performer,
    users: getOne(performer.users),
    instruments: performer.instruments ?? [],
    genres: performer.genres ?? [],
    areas: performer.areas ?? [],
  };
}

function normalizeApplications(
  rows: ApiApplication[]
): Application[] {
  return rows.map((application) => ({
    ...application,
    performers: normalizePerformer(
      application.performers
    ),
    band: application.band
      ? {
          ...application.band,
          members: (application.band.members ?? []).map(
            (member) => ({
              ...member,
              users: getOne(member.users),
            })
          ),
        }
      : null,
  }));
}

function PerformerAvatar({
  user,
  size = "w-16 h-16",
  textSize = "text-3xl",
}: {
  user?: User | null;
  size?: string;
  textSize?: string;
}) {
  if (
    user?.avatar_type === "emoji" &&
    user.avatar_emoji
  ) {
    return (
      <div
        className={`${size} rounded-full bg-gray-100 flex items-center justify-center ${textSize} shrink-0`}
      >
        {user.avatar_emoji}
      </div>
    );
  }

  if (
    user?.avatar_type !== "emoji" &&
    user?.picture_url
  ) {
    return (
      <img
        src={user.picture_url}
        alt=""
        className={`${size} rounded-full object-cover shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${size} rounded-full bg-gray-100 flex items-center justify-center ${textSize} shrink-0`}
    >
      🎸
    </div>
  );
}

export default function FacilityRequestApplicationsPage() {
  const params = useParams();
  const requestId = params.id as string;
  const navigation = useRouter();

  const router = {
    back: () =>
      navigation.push(`/facility/requests/${requestId}`),
    push: (path: string) => navigation.push(path),
  };

  const [performanceRequest, setPerformanceRequest] =
    useState<PerformanceRequest | null>(null);

  const [applications, setApplications] =
    useState<Application[]>([]);

  const [hasMoreApplications, setHasMoreApplications] =
    useState(false);

  const [acceptedParticipantCount, setAcceptedParticipantCount] =
    useState(0);

  const [loading, setLoading] = useState(true);

  const [acceptingApplicationId, setAcceptingApplicationId] =
    useState<string | null>(null);

  const [selectedPerformer, setSelectedPerformer] =
    useState<Performer | null>(null);

  const [reviewData, setReviewData] =
    useState<ReviewData | null>(null);

  const [reviewLoading, setReviewLoading] =
    useState(false);

  const [error, setError] = useState("");

  const loadApplications = async () => {
    try {
      setLoading(true);
      setError("");

      const idToken = liff.getIDToken();

      if (!idToken) {
        throw new Error(
          "LINEの本人確認情報を取得できません。再ログインしてください。"
        );
      }

      const response = await fetch(
        `/api/facility/requests/${requestId}/applications`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          cache: "no-store",
        }
      );

      const result =
        (await response.json()) as ApplicationsResponse;

      if (!response.ok) {
        throw new Error(
          result.error || "応募者一覧の取得に失敗しました"
        );
      }

      setPerformanceRequest(
        result.request ?? result.performanceRequest ?? null
      );

      setApplications(
        normalizeApplications(result.applications ?? [])
      );

      setHasMoreApplications(result.hasMore === true);

      setAcceptedParticipantCount(
        Number.isInteger(result.acceptedParticipantCount)
          ? Math.max(
              0,
              result.acceptedParticipantCount ?? 0
            )
          : 0
      );
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "応募者一覧の取得に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "NEXT_PUBLIC_LIFF_ID が設定されていません"
          );
        }

        await liff.init({ liffId });

        if (cancelled) {
          return;
        }

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        await loadApplications();
      } catch (err) {
        if (cancelled) {
          return;
        }

        console.error(err);

        setError(
          err instanceof Error
            ? err.message
            : "LINEログインの初期化に失敗しました"
        );

        setLoading(false);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const loadReviews = async (
    performerId: string,
    idToken: string
  ) => {
    try {
      setReviewLoading(true);
      setReviewData(null);

      const response = await fetch(
        `/api/performers/${performerId}/reviews`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          cache: "no-store",
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "評価情報の取得に失敗しました"
        );
      }

      setReviewData({
        average_rating: result.average_rating || 0,
        review_count: result.review_count || 0,
        reviews: result.reviews || [],
      });
    } catch (err) {
      console.error(err);

      setReviewData({
        average_rating: 0,
        review_count: 0,
        reviews: [],
      });
    } finally {
      setReviewLoading(false);
    }
  };

  const handleSelectPerformer = (
    performer: Performer
  ) => {
    setSelectedPerformer(performer);

    const idToken = liff.getIDToken();

    if (!idToken) {
      setError(
        "LINEの本人確認情報を取得できません。再ログインしてください。"
      );
      return;
    }

    loadReviews(performer.id, idToken);
  };

  const handleAccept = async (
    application: Application
  ) => {
    if (acceptingApplicationId !== null) {
      return;
    }

    if (application.status !== "pending") {
      return;
    }

    const isBandApplication =
      application.applicationType === "band" ||
      application.source === "band_apply" ||
      Boolean(application.band_id);

    const band = application.band;

    if (isBandApplication && !band) {
      setError(
        "バンド情報を取得できません。画面を再読み込みしてください。"
      );
      return;
    }

    if (!isBandApplication && !application.performers) {
      setError(
        "演奏者情報を取得できません。画面を再読み込みしてください。"
      );
      return;
    }

    const applicantName = isBandApplication
      ? band?.name || "バンド名未設定"
      : application.performers?.name ||
        application.performers?.users?.display_name ||
        "この演奏者";

    const memberNames =
      band?.members
        .map(
          (member) =>
member.name ||
getOne(member.users)?.display_name ||
"名前未登録"
        )
        .join("、") || "メンバー情報なし";

    const confirmed = window.confirm(
      isBandApplication
        ? `バンド「${applicantName}」をこの案件の出演者として採用しますか？\n\nメンバー：${memberNames}`
        : `${applicantName} さんをこの案件の演奏者として採用しますか？`
    );

    if (!confirmed) {
      return;
    }

    try {
      setAcceptingApplicationId(application.id);
      setError("");

      const idToken = liff.getIDToken();

      if (!idToken) {
        throw new Error(
          "LINEの本人確認情報を取得できません。画面を再読み込みして、もう一度お試しください。"
        );
      }

      const response = await fetch(
        `/api/facility/requests/${requestId}/applications/${application.id}/accept`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "応募の採用に失敗しました"
        );
      }

      if (isBandApplication) {
        window.alert(
          result.notificationSent === true
            ? `バンド「${applicantName}」を採用しました。\nバンドメンバーへのLINE通知も送信しました。`
            : `バンド「${applicantName}」を採用しました。\nLINE通知の送信状況を確認してください。`
        );
      } else {
        window.alert(
          result.notificationSent === true
            ? "採用しました。\n演奏者にLINE通知を送信しました。"
            : "採用しました。\nLINE通知の送信状況を確認してください。"
        );
      }

      await loadApplications();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "応募の採用に失敗しました"
      );
    } finally {
      setAcceptingApplicationId(null);
    }
  };

  const formatReviewDate = (
    dateString: string
  ) => {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const renderStars = (rating: number) => {
    const safeRating = Math.max(
      0,
      Math.min(5, Math.round(rating))
    );

    return (
      "★".repeat(safeRating) +
      "☆".repeat(5 - safeRating)
    );
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500"
          >
            ← 戻る
          </button>

          <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-8 text-center">
            <div className="text-3xl">👥</div>
            <p className="mt-3 text-sm text-gray-500">
              応募者を読み込んでいます...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500"
          >
            ← 戻る
          </button>

          <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-6">
            <div className="text-3xl">⚠️</div>

            <h1 className="text-xl font-bold text-gray-900 mt-3">
              応募者を取得できませんでした
            </h1>

            <p className="mt-3 text-sm text-red-600 whitespace-pre-wrap leading-relaxed">
              {error}
            </p>

            <button
              onClick={loadApplications}
              className="w-full mt-6 bg-black text-white rounded-2xl p-4 font-bold"
            >
              再読み込み
            </button>

            <button
              onClick={() => router.back()}
              className="w-full mt-3 bg-white border border-gray-200 text-gray-600 rounded-2xl p-4 font-bold"
            >
              戻る
            </button>
          </div>
        </div>
      </main>
    );
  }

  const pendingCount = applications.filter(
    (application) => application.status === "pending"
  ).length;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">
        <header>
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500"
          >
            ← 案件詳細に戻る
          </button>

          <div className="mt-5">
            <p className="text-sm font-medium text-gray-500">
              応募者管理
            </p>

            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              👥 応募者一覧
            </h1>

            {performanceRequest && (
              <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                {performanceRequest.title}
              </p>
            )}
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <p className="text-xs text-gray-500">
              応募件数
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {applications.length}
              <span className="text-sm font-medium ml-1">
                件
              </span>
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <p className="text-xs text-gray-500">
              応募中
            </p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {pendingCount}
              <span className="text-sm font-medium ml-1">
                件
              </span>
            </p>
          </div>
        </div>

        {hasMoreApplications && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            応募者が200件を超えているため、最新200件を表示しています。
          </p>
        )}

        {acceptedParticipantCount > 0 && (
          <div className="mt-3 bg-green-50 border border-green-100 rounded-2xl px-4 py-3">
            <p className="text-sm text-green-700">
              ✓ {acceptedParticipantCount}人の演奏者を採用済みです。
            </p>
          </div>
        )}

        {applications.length === 0 ? (
          <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-7 text-center">
            <div className="text-4xl">🎸</div>
            <h2 className="font-bold text-gray-900 mt-4">
              まだ応募者はいません
            </h2>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              演奏者から応募があると、
              ここに表示されます。
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {applications.map((application) => {
              const isBandApplication =
                application.applicationType === "band" ||
                application.source === "band_apply" ||
                Boolean(application.band_id);

              const isPending =
                application.status === "pending";

              const isAccepted =
                application.status === "accepted";

              const isRejected =
                application.status === "rejected";

              const performer = application.performers;

              const isAccepting =
                acceptingApplicationId === application.id;

              if (isBandApplication) {
                const band = application.band;
                const members = band?.members ?? [];

                return (
                  <article
                    key={application.id}
                    className="bg-white border border-purple-100 rounded-2xl overflow-hidden shadow-sm"
                  >
                    <div className="p-5">
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-16 rounded-2xl bg-purple-50 flex items-center justify-center text-3xl shrink-0">
                          🎸
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-purple-700">
                            バンド応募
                          </p>

                          <h2 className="text-lg font-bold text-gray-900 mt-1">
                            {band?.name || "バンド名未設定"}
                          </h2>

                          {isPending && (
                            <span className="inline-block mt-2 text-xs font-bold bg-yellow-50 text-yellow-700 border border-yellow-100 px-2.5 py-1 rounded-full">
                              応募中
                            </span>
                          )}

                          {isAccepted && (
                            <span className="inline-block mt-2 text-xs font-bold bg-green-50 text-green-700 border border-green-100 px-2.5 py-1 rounded-full">
                              採用
                            </span>
                          )}

                          {isRejected && (
                            <span className="inline-block mt-2 text-xs font-bold bg-gray-100 text-gray-500 border border-gray-200 px-2.5 py-1 rounded-full">
                              見送り
                            </span>
                          )}
                        </div>
                      </div>

                      {band?.description && (
                        <p className="mt-4 text-sm leading-6 text-gray-600 whitespace-pre-wrap">
                          {band.description}
                        </p>
                      )}

                      <div className="mt-4 rounded-xl bg-purple-50 p-4">
                        <p className="text-sm font-bold text-purple-900">
                          参加メンバー（{members.length}人）
                        </p>

                        {members.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {members.map((member) => (
                              <div
                                key={member.id}
                                className="flex items-center gap-3 rounded-lg bg-white px-3 py-2"
                              >
                                <PerformerAvatar
                                  user={getOne(member.users)}
                                  size="w-10 h-10"
                                  textSize="text-xl"
                                />

                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-700 truncate">
                                    {member.name ||
                                      getOne(member.users)?.display_name ||
                                      "名前未登録"}
                                  </p>

                                  {member.role && (
                                    <p className="text-xs text-gray-400">
                                      {member.role}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-gray-500">
                            メンバー情報を確認できません。
                          </p>
                        )}
                      </div>

                      {application.message && (
                        <div className="mt-4">
                          <p className="text-xs font-bold text-gray-400">
                            応募メッセージ
                          </p>
                          <p className="mt-1 text-sm leading-6 text-gray-700 whitespace-pre-wrap">
                            {application.message}
                          </p>
                        </div>
                      )}
                    </div>

                    {isPending && (
                      <div className="border-t border-gray-100 bg-gray-50/70 p-4">
                        <button
                          onClick={() =>
                            handleAccept(application)
                          }
                          disabled={
                            acceptingApplicationId !== null
                          }
                          className="w-full bg-purple-700 text-white rounded-xl p-3.5 font-bold disabled:opacity-50 active:scale-[0.99] transition"
                        >
                          {isAccepting
                            ? "採用処理中..."
                            : "🎸 このバンドを採用する"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              }

              if (!performer) {
                return null;
              }

              const performerName =
                performer.name ||
                performer.users?.display_name ||
                "名前未登録";

              return (
                <article
                  key={application.id}
                  className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"
                >
                  <div className="p-5">
                    <div className="flex items-start gap-3">
                      <PerformerAvatar
                        user={performer.users}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="text-lg font-bold text-gray-900 truncate">
                            {performerName}
                          </h2>

                          {isPending && (
                            <span className="shrink-0 text-xs font-bold bg-yellow-50 text-yellow-700 border border-yellow-100 px-2.5 py-1 rounded-full">
                              応募中
                            </span>
                          )}

                          {isAccepted && (
                            <span className="shrink-0 text-xs font-bold bg-green-50 text-green-700 border border-green-100 px-2.5 py-1 rounded-full">
                              採用
                            </span>
                          )}

                          {isRejected && (
                            <span className="shrink-0 text-xs font-bold bg-gray-100 text-gray-500 border border-gray-200 px-2.5 py-1 rounded-full">
                              見送り
                            </span>
                          )}
                        </div>

                        {(performer.areas?.length
                          ? performer.areas.join("、")
                          : performer.area) && (
                          <p className="text-sm text-gray-500 mt-1">
                            📍{" "}
                            {performer.areas?.length
                              ? performer.areas.join("、")
                              : performer.area}
                          </p>
                        )}
                      </div>
                    </div>

                    {performer.instruments?.length > 0 && (
                      <div className="mt-5">
                        <p className="text-xs font-bold text-gray-400">
                          楽器
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {performer.instruments.map(
                            (instrument) => (
                              <span
                                key={instrument}
                                className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1"
                              >
                                🎸 {instrument}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {performer.genres?.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-bold text-gray-400">
                          ジャンル
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {performer.genres.map((genre) => (
                            <span
                              key={genre}
                              className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1"
                            >
                              🎵 {genre}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {performer.bio && (
                      <div className="mt-5">
                        <p className="text-xs font-bold text-gray-400">
                          自己紹介
                        </p>
                        <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {performer.bio}
                        </p>
                      </div>
                    )}

                    {application.message && (
                      <div className="mt-5 bg-gray-50 rounded-xl p-4">
                        <p className="text-xs font-bold text-gray-500">
                          💬 応募メッセージ
                        </p>
                        <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {application.message}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-100 bg-gray-50/70 p-4">
                    <button
                      onClick={() =>
                        handleSelectPerformer(performer)
                      }
                      className="w-full bg-white border border-gray-200 text-gray-800 rounded-xl p-3.5 font-bold active:scale-[0.99] transition"
                    >
                      👤 プロフィール・評価を見る
                    </button>

                    {isPending && (
                      <button
                        onClick={() =>
                          handleAccept(application)
                        }
                        disabled={
                          acceptingApplicationId !== null
                        }
                        className="w-full mt-2 bg-black text-white rounded-xl p-3.5 font-bold disabled:opacity-50 active:scale-[0.99] transition"
                      >
                        {isAccepting
                          ? "採用処理中..."
                          : "🎵 この演奏者に依頼する"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <button
          onClick={() =>
            router.push(
              `/facility/requests/${requestId}`
            )
          }
          className="w-full mt-6 bg-white border border-gray-200 rounded-2xl p-4 font-medium text-gray-600"
        >
          ← 案件詳細へ戻る
        </button>

        <p className="text-center text-xs text-gray-400 mt-6 pb-4">
          演奏者と施設をつなぐ、演奏マッチング
        </p>
      </div>

      {selectedPerformer && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center"
          onClick={() => {
            setSelectedPerformer(null);
            setReviewData(null);
          }}
        >
          <div
            className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                演奏者プロフィール
              </h2>

              <button
                onClick={() => {
                  setSelectedPerformer(null);
                  setReviewData(null);
                }}
                className="w-9 h-9 rounded-full bg-gray-100 text-gray-500 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-5">
              <div className="flex flex-col items-center">
                <PerformerAvatar
                  user={selectedPerformer.users}
                  size="w-24 h-24"
                  textSize="text-4xl"
                />

                <h3 className="mt-4 text-xl font-bold text-gray-900 text-center">
                  {selectedPerformer.name ||
                    selectedPerformer.users?.display_name ||
                    "名前未登録"}
                </h3>

                {(selectedPerformer.areas?.length
                  ? selectedPerformer.areas.join("、")
                  : selectedPerformer.area) && (
                  <p className="mt-2 text-sm text-gray-500">
                    📍{" "}
                    {selectedPerformer.areas?.length
                      ? selectedPerformer.areas.join("、")
                      : selectedPerformer.area}
                  </p>
                )}
              </div>

              <div className="mt-6 bg-yellow-50 border border-yellow-100 rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-gray-900">
                    ⭐ 評価
                  </h3>

                  {reviewData &&
                    reviewData.review_count > 0 && (
                      <span className="text-xs text-gray-500">
                        {reviewData.review_count}件
                      </span>
                    )}
                </div>

                {reviewLoading ? (
                  <p className="mt-4 text-sm text-gray-500">
                    評価を読み込み中...
                  </p>
                ) : reviewData &&
                  reviewData.review_count > 0 ? (
                  <div className="mt-4 flex items-center gap-3">
                    <span className="text-3xl font-bold text-gray-900">
                      {reviewData.average_rating.toFixed(1)}
                    </span>

                    <div>
                      <p className="text-yellow-500 text-xl tracking-wide">
                        {renderStars(
                          reviewData.average_rating
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        平均評価
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 bg-white rounded-xl p-4">
                    <p className="text-sm text-gray-600">
                      まだ評価はありません。
                    </p>
                  </div>
                )}
              </div>

              {selectedPerformer.instruments?.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-bold text-gray-500">
                    🎸 楽器
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedPerformer.instruments.map(
                      (instrument) => (
                        <span
                          key={instrument}
                          className="text-sm bg-gray-100 text-gray-700 rounded-full px-3 py-1.5"
                        >
                          {instrument}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}

              {selectedPerformer.genres?.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-bold text-gray-500">
                    🎵 ジャンル
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedPerformer.genres.map((genre) => (
                      <span
                        key={genre}
                        className="text-sm bg-gray-100 text-gray-700 rounded-full px-3 py-1.5"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedPerformer.bio && (
                <div className="mt-6">
                  <h3 className="text-sm font-bold text-gray-500">
                    📝 自己紹介
                  </h3>
                  <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {selectedPerformer.bio}
                  </p>
                </div>
              )}

              {reviewData &&
                reviewData.reviews.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-lg font-bold text-gray-900">
                      💬 評価コメント
                    </h3>

                    <div className="space-y-3 mt-3">
                      {reviewData.reviews.map((review) => (
                        <div
                          key={review.id}
                          className="bg-gray-50 border border-gray-100 rounded-xl p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-yellow-500 font-bold tracking-wide">
                              {renderStars(review.rating)}
                            </p>
                            <p className="text-xs text-gray-400">
                              {formatReviewDate(
                                review.created_at
                              )}
                            </p>
                          </div>

                          <p className="text-xs text-gray-500 mt-2">
                            {review.reviewer_name}
                          </p>

                          {review.comment && (
                            <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap leading-relaxed">
                              {review.comment}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              <button
                onClick={() => {
                  setSelectedPerformer(null);
                  setReviewData(null);
                }}
                className="w-full mt-6 bg-black text-white rounded-2xl p-4 font-bold"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
