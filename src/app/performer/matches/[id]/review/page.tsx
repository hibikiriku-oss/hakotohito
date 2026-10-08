"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();

  const matchId = params.id as string;

  const [lineUserId, setLineUserId] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const init = async () => {
      try {
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineUserId(profile.userId);

        const response = await fetch(
          `/api/reviews?match_id=${matchId}`,
          {
            headers: {
              "x-line-user-id": profile.userId,
            },
          }
        );

        if (!response.ok) {
          throw new Error("評価情報の取得に失敗しました");
        }

        const data = await response.json();

        setReviewed(data.reviewed);

        if (data.reviewed) {
          setRating(data.review?.rating ?? 5);
          setComment(data.review?.comment ?? "");
        }
      } catch (error) {
        console.error(error);
        setError("評価情報を取得できませんでした。");
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [matchId]);

  const handleSubmit = async () => {
    if (!lineUserId) {
      setError("LINEユーザー情報を取得できませんでした。");
      return;
    }

    if (reviewed) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-user-id": lineUserId,
        },
        body: JSON.stringify({
          match_id: matchId,
          rating,
          comment,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "評価の送信に失敗しました");
      }

      setReviewed(true);

      alert("評価を送信しました！");

      router.push(`/performer/matches/${matchId}`);
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("評価の送信に失敗しました。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <p className="text-center text-gray-500">
              読み込み中...
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() =>
              router.push(`/performer/matches/${matchId}`)
            }
            className="text-gray-600 font-bold"
          >
            ← 戻る
          </button>

          <h1 className="text-lg font-bold">
            施設を評価
          </h1>

          <div className="w-12" />
        </div>

        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-xl font-bold text-center">
            ⭐ 施設を評価してください
          </h2>

          {reviewed ? (
            <div className="mt-6">
              <div className="bg-gray-50 rounded-xl p-5 text-center">
                <p className="text-lg font-bold text-gray-700">
                  評価済みです
                </p>

                <div className="mt-4 flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      className="text-3xl"
                    >
                      {star <= rating ? "⭐" : "☆"}
                    </span>
                  ))}
                </div>

                {comment && (
                  <p className="mt-4 text-left text-gray-600 whitespace-pre-wrap">
                    {comment}
                  </p>
                )}
              </div>

              <button
                onClick={() =>
                  router.push(`/performer/matches/${matchId}`)
                }
                className="w-full mt-5 bg-gray-700 text-white rounded-xl p-4 font-bold"
              >
                マッチング詳細へ戻る
              </button>
            </div>
          ) : (
            <>
              <div className="mt-6">
                <p className="font-bold text-gray-700 text-center">
                  評価
                </p>

                <div className="flex justify-center gap-2 mt-4">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className="text-4xl"
                      aria-label={`${star}点`}
                    >
                      {star <= rating ? "⭐" : "☆"}
                    </button>
                  ))}
                </div>

                <p className="text-center mt-2 text-sm text-gray-500">
                  {rating} / 5
                </p>
              </div>

              <div className="mt-6">
                <label className="block font-bold text-gray-700 mb-2">
                  コメント
                </label>

                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="施設についての感想を入力してください"
                  rows={5}
                  className="w-full border border-gray-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              {error && (
                <div className="mt-4 bg-red-50 text-red-600 rounded-xl p-4 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full mt-6 bg-yellow-500 text-white rounded-xl p-4 font-bold disabled:opacity-50"
              >
                {submitting ? "送信中..." : "⭐ 評価を送信"}
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}