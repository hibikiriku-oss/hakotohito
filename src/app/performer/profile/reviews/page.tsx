"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

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

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function renderStars(rating: number) {
  const safeRating = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(safeRating) + "☆".repeat(5 - safeRating);
}

export default function PerformerReviewsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);

  useEffect(() => {
    async function loadReviews() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("NEXT_PUBLIC_LIFF_IDが設定されていません");
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();

        const profileResponse = await fetch(
          "/api/performers/profile",
          {
            headers: {
              "x-line-user-id": profile.userId,
            },
          }
        );

        const profileData = await profileResponse.json();

        if (!profileResponse.ok || !profileData.performer?.id) {
          throw new Error(
            profileData.error || "演奏者プロフィールを取得できませんでした"
          );
        }

        const reviewsResponse = await fetch(
          `/api/performers/${profileData.performer.id}/reviews`
        );

        const reviewsData = await reviewsResponse.json();

        if (!reviewsResponse.ok) {
          throw new Error(
            reviewsData.error || "評価情報を取得できませんでした"
          );
        }

        setReviewData(reviewsData);
      } catch (err) {
        console.error("評価画面の取得エラー:", err);
        setError(
          err instanceof Error
            ? err.message
            : "評価情報の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    loadReviews();
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">
        <button
          type="button"
          onClick={() => router.push("/performer/profile/edit")}
          className="text-sm text-gray-500"
        >
          ← プロフィール編集へ戻る
        </button>

        <header className="mt-6 mb-6">
          <p className="text-sm font-bold text-gray-500">🎸 演奏者ホーム</p>
          <h1 className="text-2xl font-bold mt-1">受け取った評価</h1>
          <p className="text-sm text-gray-500 mt-2">
            施設から受け取った評価とコメントを確認できます。
          </p>
        </header>

        {loading ? (
          <section className="bg-white rounded-2xl p-6 text-center">
            <p className="text-gray-500">評価を読み込んでいます...</p>
          </section>
        ) : error ? (
          <section className="bg-white border border-red-200 rounded-2xl p-5">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => router.push("/performer/profile/edit")}
              className="mt-4 w-full rounded-xl bg-black text-white p-3 font-bold"
            >
              プロフィール編集へ戻る
            </button>
          </section>
        ) : !reviewData || reviewData.review_count === 0 ? (
          <section className="bg-white rounded-2xl p-6 text-center">
            <div className="text-4xl">⭐</div>
            <h2 className="font-bold mt-3">まだ評価はありません</h2>
            <p className="text-sm text-gray-500 mt-2 leading-6">
              演奏を重ねると、施設から評価やコメントが届きます。
            </p>
          </section>
        ) : (
          <>
            <section className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
              <p className="text-xs font-bold text-gray-400">YOUR RATING</p>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-4xl font-bold">
                  {Number(reviewData.average_rating).toFixed(1)}
                </span>
                <div>
                  <p className="text-yellow-500 text-xl tracking-wide">
                    {renderStars(reviewData.average_rating)}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {reviewData.review_count}件の評価
                  </p>
                </div>
              </div>
            </section>

            <div className="space-y-3">
              {reviewData.reviews.map((review) => (
                <article
                  key={review.id}
                  className="bg-white border border-gray-200 rounded-2xl p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold truncate">
                        {review.reviewer_name || "匿名ユーザー"}
                      </p>
                      <p className="text-yellow-500 tracking-wide mt-1">
                        {renderStars(review.rating)}
                      </p>
                    </div>
                    <time className="text-xs text-gray-400 shrink-0">
                      {formatDate(review.created_at)}
                    </time>
                  </div>

                  <p className="text-sm text-gray-700 leading-6 mt-3 whitespace-pre-wrap break-words">
                    {review.comment?.trim() || "コメントはありません。"}
                  </p>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}