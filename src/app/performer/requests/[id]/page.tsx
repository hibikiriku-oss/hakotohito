"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Facility = {
  id: string;
  name: string;
  facility_type: string;
  address: string;
  description: string | null;
};

type FacilityReview = {
  rating: number;
  comment: string | null;
  created_at: string;
};

type PerformanceRequest = {
  id: string;
  title: string;
  description: string | null;
  performance_date: string;
  start_time: string;
  end_time: string;
  area: string | null;
  instruments: string[];
  genres: string[];
  reward: number | null;
  status: string;
  facilities: Facility | null;
};

export default function PerformerRequestDetailPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [request, setRequest] =
    useState<PerformanceRequest | null>(null);

  const [lineUserId, setLineUserId] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [applying, setApplying] =
    useState(false);

  const [error, setError] =
    useState("");

  const [showFacilityProfile, setShowFacilityProfile] =
    useState(false);

  const [facilityRating, setFacilityRating] =
    useState<number | null>(null);

  const [facilityReviewCount, setFacilityReviewCount] =
    useState(0);

  const [facilityReviews, setFacilityReviews] =
    useState<FacilityReview[]>([]);

  const [facilityReviewsLoading, setFacilityReviewsLoading] =
    useState(false);

  useEffect(() => {
    async function initialize() {
      try {
        const liffId =
          process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "NEXT_PUBLIC_LIFF_IDが設定されていません"
          );
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile =
          await liff.getProfile();

        setLineUserId(profile.userId);

        const response = await fetch(
          `/api/performance-requests/${requestId}`
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "案件の取得に失敗しました"
          );
        }

        setRequest(data.request);

        if (data.request.facilities?.id) {
          setFacilityReviewsLoading(true);

          try {
            const facilityResponse = await fetch(
              `/api/facilities/${data.request.facilities.id}`
            );

            const facilityData =
              await facilityResponse.json();

            if (facilityResponse.ok) {
              setFacilityRating(
                facilityData.rating ?? null
              );

              setFacilityReviewCount(
                facilityData.review_count ?? 0
              );

              setFacilityReviews(
                facilityData.reviews ?? []
              );
            }
          } catch (facilityError) {
            console.error(
              "施設レビュー取得エラー:",
              facilityError
            );
          } finally {
            setFacilityReviewsLoading(false);
          }
        }
      } catch (error) {
        console.error(error);

        setError(
          error instanceof Error
            ? error.message
            : "エラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [requestId]);

  const handleApply = async () => {
    if (!lineUserId) {
      alert(
        "LINEユーザー情報を取得できていません"
      );
      return;
    }

    if (!request) {
      return;
    }

    if (request.status !== "open") {
      alert(
        "この案件には現在応募できません"
      );
      return;
    }

    const confirmed =
      window.confirm(
        "この案件に応募しますか？"
      );

    if (!confirmed) {
      return;
    }

    try {
      setApplying(true);

      const response = await fetch(
        "/api/applications",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "x-line-user-id":
              lineUserId,
          },
          body: JSON.stringify({
            requestId,
            message,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        alert(
          data.error ||
            "応募に失敗しました"
        );
        return;
      }

      alert(
        "応募しました！"
      );

      router.push(
        "/performer/home"
      );
    } catch (error) {
      console.error(
        "応募エラー:",
        error
      );

      alert(
        "通信エラーが発生しました"
      );
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            案件詳細
          </h1>

          <p className="mt-8 text-center text-gray-500">
            案件を読み込んでいます...
          </p>
        </div>
      </main>
    );
  }

  if (error || !request) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            案件詳細
          </h1>

          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">
              {error ||
                "案件が見つかりません"}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/performer/requests"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← 案件一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <button
          onClick={() =>
            router.push(
              "/performer/requests"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← 案件一覧へ戻る
        </button>

        <div className="bg-white rounded-2xl p-5 shadow-sm">

          <h1 className="text-2xl font-bold">
            {request.title}
          </h1>

          {request.facilities && (
            <div className="mt-5 bg-gray-50 rounded-xl p-4">

              <p className="text-sm text-gray-500">
                施設
              </p>

              <p className="font-bold mt-1 text-lg">
                {request.facilities.name}
              </p>

              <p className="text-sm text-gray-600 mt-1">
                {request.facilities.facility_type}
              </p>

              <p className="text-sm text-gray-600 mt-1">
                {request.facilities.address}
              </p>

              <button
                onClick={() =>
                  setShowFacilityProfile(true)
                }
                className="w-full mt-4 bg-white border border-gray-300 rounded-xl p-3 font-bold"
              >
                施設プロフィールを見る
              </button>

            </div>
          )}

          <div className="mt-5 space-y-2">

            <p>
              📅 {request.performance_date}
            </p>

            <p>
              🕐{" "}
              {request.start_time.slice(0, 5)}
              {" ～ "}
              {request.end_time.slice(0, 5)}
            </p>

            {request.area && (
              <p>
                📍 {request.area}
              </p>
            )}

            {request.reward !== null && (
              <p className="font-bold">
                💰 報酬{" "}
                {request.reward.toLocaleString()}
                円
              </p>
            )}

          </div>

          {request.instruments?.length > 0 && (
            <div className="mt-5">
              <p className="text-sm text-gray-500 mb-2">
                演奏してほしい楽器
              </p>

              <div className="flex flex-wrap gap-2">
                {request.instruments.map(
                  (instrument) => (
                    <span
                      key={instrument}
                      className="bg-gray-100 rounded-full px-3 py-1 text-sm"
                    >
                      🎵 {instrument}
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {request.genres?.length > 0 && (
            <div className="mt-5">
              <p className="text-sm text-gray-500 mb-2">
                演奏してほしいジャンル
              </p>

              <div className="flex flex-wrap gap-2">
                {request.genres.map(
                  (genre) => (
                    <span
                      key={genre}
                      className="bg-gray-100 rounded-full px-3 py-1 text-sm"
                    >
                      🎼 {genre}
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {request.description && (
            <div className="mt-5">
              <p className="text-sm text-gray-500">
                案件内容
              </p>

              <p className="mt-2 whitespace-pre-wrap">
                {request.description}
              </p>
            </div>
          )}

        </div>

        {request.status === "open" ? (
          <div className="mt-6 bg-white rounded-2xl p-5 shadow-sm">

            <h2 className="font-bold text-lg">
              この案件に応募する
            </h2>

            <p className="text-sm text-gray-500 mt-2">
              施設に伝えたいことがあれば入力してください。
            </p>

            <textarea
              value={message}
              onChange={(e) =>
                setMessage(e.target.value)
              }
              placeholder="過去の演奏経験などを入力してください"
              rows={5}
              className="w-full border rounded-xl p-3 bg-white mt-4"
            />

            <button
              onClick={handleApply}
              disabled={applying}
              className="w-full mt-4 bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
            >
              {applying
                ? "応募中..."
                : "この案件に応募する"}
            </button>

          </div>
        ) : (
          <div className="mt-6 bg-gray-100 rounded-xl p-4 text-center">
            <p className="text-gray-500">
              この案件は現在募集していません。
            </p>
          </div>
        )}

      </div>

      {showFacilityProfile &&
        request.facilities && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">

            <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">

              <div className="p-5">

                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold">
                    施設プロフィール
                  </h2>

                  <button
                    onClick={() =>
                      setShowFacilityProfile(false)
                    }
                    className="text-gray-500 text-2xl"
                  >
                    ×
                  </button>
                </div>

                <div className="mt-6">

                  <p className="text-sm text-gray-500">
                    施設名
                  </p>

                  <p className="text-xl font-bold mt-1">
                    {request.facilities.name}
                  </p>

                </div>

                <div className="mt-5">

                  <p className="text-sm text-gray-500">
                    施設種別
                  </p>

                  <p className="mt-1">
                    {request.facilities.facility_type}
                  </p>

                </div>

                <div className="mt-5">

                  <p className="text-sm text-gray-500">
                    住所
                  </p>

                  <p className="mt-1">
                    {request.facilities.address}
                  </p>

                </div>

                {request.facilities.description && (
                  <div className="mt-5">

                    <p className="text-sm text-gray-500">
                      施設紹介
                    </p>

                    <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                      {request.facilities.description}
                    </p>

                  </div>
                )}

                <div className="mt-6 border-t pt-5">

                  <p className="text-sm text-gray-500">
                    施設のレビュー
                  </p>

                  {facilityReviewsLoading ? (
                    <p className="mt-3 text-sm text-gray-500">
                      レビューを読み込んでいます...
                    </p>
                  ) : facilityReviewCount > 0 ? (
                    <>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-2xl font-bold">
                          ⭐ {facilityRating?.toFixed(1)}
                        </span>

                        <span className="text-sm text-gray-500">
                          （{facilityReviewCount}件）
                        </span>
                      </div>

                      <div className="mt-4 space-y-4">
                        {facilityReviews.map(
                          (review, index) => (
                            <div
                              key={`${review.created_at}-${index}`}
                              className="bg-gray-50 rounded-xl p-4"
                            >
                              <div className="flex items-center justify-between">
                                <p className="font-bold">
                                  {"★".repeat(review.rating)}
                                  {"☆".repeat(5 - review.rating)}
                                </p>

                                <p className="text-xs text-gray-400">
                                  {new Date(
                                    review.created_at
                                  ).toLocaleDateString(
                                    "ja-JP"
                                  )}
                                </p>
                              </div>

                              {review.comment && (
                                <p className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">
                                  {review.comment}
                                </p>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-gray-500">
                      まだレビューはありません。
                    </p>
                  )}

                </div>

                <button
                  onClick={() =>
                    setShowFacilityProfile(false)
                  }
                  className="w-full mt-8 bg-black text-white rounded-xl p-4 font-bold"
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