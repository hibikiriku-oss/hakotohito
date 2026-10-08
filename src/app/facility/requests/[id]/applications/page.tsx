"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type User = {
  display_name: string | null;
  picture_url: string | null;
};

type Performer = {
  id: string;
  name: string | null;
  area: string | null;
  instruments: string[];
  genres: string[];
  bio: string | null;
  users: User | null;
};

type Application = {
  id: string;
  message: string | null;
  status: string;
  created_at: string;
  performers: Performer | null;
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

export default function FacilityRequestApplicationsPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [lineUserId, setLineUserId] = useState("");
  const [performanceRequest, setPerformanceRequest] =
    useState<PerformanceRequest | null>(null);
  const [applications, setApplications] =
    useState<Application[]>([]);
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

  const loadApplications = async (userId: string) => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        "/api/facility/requests/" +
          requestId +
          "/applications",
        {
          headers: {
            "x-line-user-id": userId,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "応募者一覧の取得に失敗しました"
        );
      }

      setPerformanceRequest(
        result.performanceRequest
      );
      setApplications(result.applications || []);
    } catch (err) {
      console.error(err);

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(
          "応募者一覧の取得に失敗しました"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const liffId =
          process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "NEXT_PUBLIC_LIFF_ID が設定されていません"
          );
        }

        await liff.init({
          liffId,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();

        setLineUserId(profile.userId);

        await loadApplications(profile.userId);
      } catch (err) {
        console.error(err);

        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(
            "LINEログインの初期化に失敗しました"
          );
        }

        setLoading(false);
      }
    };

    init();
  }, [requestId]);

  const loadReviews = async (
    performerId: string
  ) => {
    try {
      setReviewLoading(true);
      setReviewData(null);

      const response = await fetch(
        "/api/performers/" +
          performerId +
          "/reviews"
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "評価情報の取得に失敗しました"
        );
      }

      setReviewData({
        average_rating:
          result.average_rating || 0,
        review_count:
          result.review_count || 0,
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
    loadReviews(performer.id);
  };

  const handleAccept = async (
    application: Application
  ) => {
    if (!application.performers) {
      return;
    }

    const performerName =
      application.performers.name ||
      application.performers.users?.display_name ||
      "この演奏者";

    const confirmed = window.confirm(
      performerName +
        " さんをこの案件の演奏者として採用しますか？"
    );

    if (!confirmed) {
      return;
    }

    try {
      setAcceptingApplicationId(application.id);
      setError("");

      const response = await fetch(
        "/api/facility/requests/" +
          requestId +
          "/applications/" +
          application.id +
          "/accept",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-user-id": lineUserId,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            "演奏者の採用に失敗しました"
        );
      }

      alert(
        "採用しました。\n演奏者にLINE通知を送信しました。"
      );

      await loadApplications(lineUserId);
    } catch (err) {
      console.error(err);

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(
          "演奏者の採用に失敗しました"
        );
      }
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

    return date.toLocaleDateString(
      "ja-JP",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
      }
    );
  };

  const renderStars = (rating: number) => {
    return "★".repeat(rating) +
      "☆".repeat(5 - rating);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-center text-gray-600">
            読み込み中...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h1 className="text-xl font-bold mb-4">
              エラー
            </h1>

            <p className="text-red-600 whitespace-pre-wrap">
              {error}
            </p>

            <button
              onClick={() => router.back()}
              className="w-full mt-6 bg-black text-white rounded-xl p-4 font-bold"
            >
              戻る
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">
        <button
          onClick={() => router.back()}
          className="text-gray-600 mb-4"
        >
          ← 戻る
        </button>

        <h1 className="text-2xl font-bold mb-2">
          👥 応募者一覧
        </h1>

        {performanceRequest && (
          <p className="text-gray-600 mb-6">
            {performanceRequest.title}
          </p>
        )}

        {applications.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <p className="text-center text-gray-600">
              まだ応募者はいません。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {applications.map((application) => {
              const performer =
                application.performers;

              if (!performer) {
                return null;
              }

              const performerName =
                performer.name ||
                performer.users?.display_name ||
                "名前未登録";

              const isPending =
                application.status === "pending";

              const isAccepted =
                application.status === "accepted";

              const isRejected =
                application.status === "rejected";

              return (
                <div
                  key={application.id}
                  className="bg-white rounded-2xl p-5 shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    {performer.users?.picture_url ? (
                      <img
                        src={
                          performer.users.picture_url
                        }
                        alt=""
                        className="w-16 h-16 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-3xl">
                        🎸
                      </div>
                    )}

                    <div className="flex-1">
                      <h2 className="text-lg font-bold">
                        {performerName}
                      </h2>

                      {performer.area && (
                        <p className="text-sm text-gray-600 mt-1">
                          📍 {performer.area}
                        </p>
                      )}
                    </div>

                    <div>
                      {isPending && (
                        <span className="inline-block bg-yellow-100 text-yellow-800 text-xs font-bold px-3 py-1 rounded-full">
                          応募中
                        </span>
                      )}

                      {isAccepted && (
                        <span className="inline-block bg-green-100 text-green-800 text-xs font-bold px-3 py-1 rounded-full">
                          採用
                        </span>
                      )}

                      {isRejected && (
                        <span className="inline-block bg-gray-100 text-gray-600 text-xs font-bold px-3 py-1 rounded-full">
                          見送り
                        </span>
                      )}
                    </div>
                  </div>

                  {performer.instruments &&
                    performer.instruments.length > 0 && (
                      <div className="mt-5">
                        <h3 className="font-bold text-sm mb-2">
                          🎸 楽器
                        </h3>

                        <div className="flex flex-wrap gap-2">
                          {performer.instruments.map(
                            (instrument) => (
                              <span
                                key={instrument}
                                className="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full"
                              >
                                {instrument}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {performer.genres &&
                    performer.genres.length > 0 && (
                      <div className="mt-5">
                        <h3 className="font-bold text-sm mb-2">
                          🎵 ジャンル
                        </h3>

                        <div className="flex flex-wrap gap-2">
                          {performer.genres.map(
                            (genre) => (
                              <span
                                key={genre}
                                className="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full"
                              >
                                {genre}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {performer.bio && (
                    <div className="mt-5">
                      <h3 className="font-bold text-sm mb-2">
                        📝 自己紹介
                      </h3>

                      <p className="text-gray-700 whitespace-pre-wrap">
                        {performer.bio}
                      </p>
                    </div>
                  )}

                  {application.message && (
                    <div className="mt-5">
                      <h3 className="font-bold text-sm mb-2">
                        💬 応募メッセージ
                      </h3>

                      <p className="text-gray-700 whitespace-pre-wrap">
                        {application.message}
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() =>
                      handleSelectPerformer(
                        performer
                      )
                    }
                    className="w-full mt-5 bg-white border border-gray-300 text-gray-800 rounded-xl p-4 font-bold"
                  >
                    👤 プロフィールを見る
                  </button>

                  {isPending && (
                    <button
                      onClick={() =>
                        handleAccept(application)
                      }
                      disabled={
                        acceptingApplicationId ===
                        application.id
                      }
                      className="w-full mt-3 bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
                    >
                      {acceptingApplicationId ===
                      application.id
                        ? "採用処理中..."
                        : "🎵 この演奏者に依頼する"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedPerformer && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-5"
          onClick={() => {
            setSelectedPerformer(null);
            setReviewData(null);
          }}
        >
          <div
            className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-white rounded-2xl p-6"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">
                👤 演奏者プロフィール
              </h2>

              <button
                onClick={() => {
                  setSelectedPerformer(null);
                  setReviewData(null);
                }}
                className="text-gray-500 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="mt-6 flex flex-col items-center">
              {selectedPerformer.users
                ?.picture_url ? (
                <img
                  src={
                    selectedPerformer.users
                      .picture_url
                  }
                  alt=""
                  className="w-24 h-24 rounded-full object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center text-4xl">
                  🎸
                </div>
              )}

              <h3 className="mt-4 text-xl font-bold text-center">
                {selectedPerformer.name ||
                  selectedPerformer.users
                    ?.display_name ||
                  "名前未登録"}
              </h3>

              {selectedPerformer.area && (
                <p className="mt-2 text-gray-600">
                  📍 {selectedPerformer.area}
                </p>
              )}
            </div>

            {/* 評価 */}
            <div className="mt-6 bg-yellow-50 rounded-2xl p-5">
              <h3 className="font-bold text-lg">
                ⭐ 評価
              </h3>

              {reviewLoading ? (
                <p className="mt-4 text-sm text-gray-500">
                  評価を読み込み中...
                </p>
              ) : reviewData &&
                reviewData.review_count > 0 ? (
                <>
                  <div className="mt-4 flex items-center gap-3">
                    <span className="text-3xl font-bold">
                      {reviewData.average_rating.toFixed(
                        1
                      )}
                    </span>

                    <div>
                      <p className="text-yellow-500 text-xl tracking-wide">
                        {renderStars(
                          Math.round(
                            reviewData.average_rating
                          )
                        )}
                      </p>

                      <p className="text-sm text-gray-600 mt-1">
                        {reviewData.review_count}
                        件の評価
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-4 bg-white rounded-xl p-4">
                  <p className="text-gray-600">
                    まだ評価はありません。
                  </p>
                </div>
              )}
            </div>

            {selectedPerformer.instruments &&
              selectedPerformer.instruments.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-bold text-sm mb-2">
                    🎸 楽器
                  </h3>

                  <div className="flex flex-wrap gap-2">
                    {selectedPerformer.instruments.map(
                      (instrument) => (
                        <span
                          key={instrument}
                          className="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full"
                        >
                          {instrument}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}

            {selectedPerformer.genres &&
              selectedPerformer.genres.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-bold text-sm mb-2">
                    🎵 ジャンル
                  </h3>

                  <div className="flex flex-wrap gap-2">
                    {selectedPerformer.genres.map(
                      (genre) => (
                        <span
                          key={genre}
                          className="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full"
                        >
                          {genre}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}

            {selectedPerformer.bio && (
              <div className="mt-6">
                <h3 className="font-bold text-sm mb-2">
                  📝 自己紹介
                </h3>

                <p className="text-gray-700 whitespace-pre-wrap">
                  {selectedPerformer.bio}
                </p>
              </div>
            )}

            {/* 評価コメント */}
            {reviewData &&
              reviewData.reviews.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-bold text-lg mb-3">
                    💬 評価コメント
                  </h3>

                  <div className="space-y-3">
                    {reviewData.reviews.map(
                      (review) => (
                        <div
                          key={review.id}
                          className="bg-gray-50 rounded-xl p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-yellow-500 font-bold">
                              {renderStars(
                                review.rating
                              )}
                            </p>

                            <p className="text-xs text-gray-400">
                              {formatReviewDate(
                                review.created_at
                              )}
                            </p>
                          </div>

                          <p className="mt-2 text-sm text-gray-500">
                            {review.reviewer_name}
                          </p>

                          {review.comment && (
                            <p className="mt-2 text-gray-700 whitespace-pre-wrap">
                              {review.comment}
                            </p>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

            <button
              onClick={() => {
                setSelectedPerformer(null);
                setReviewData(null);
              }}
              className="w-full mt-6 bg-black text-white rounded-xl p-4 font-bold"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </main>
  );
}