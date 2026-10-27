"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

export default function FacilityReviewPage() {
  const params = useParams();
  const router = useRouter();

  const matchId = params.id as string;

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rewardAmount, setRewardAmount] = useState<number | null>(null);

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

        const idToken = liff.getIDToken();

        if (!idToken) {
          throw new Error(
            "LINEの本人確認トークンを取得できませんでした"
          );
        }

        const response = await fetch(
          `/api/reviews?match_id=${encodeURIComponent(matchId)}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error("評価情報の取得に失敗しました");
        }

        const data = await response.json();

        setReviewed(data.reviewed);
        setCanReview(data.can_review === true);

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
    if (reviewed) {
      return;
    }

    const idToken = liff.getIDToken();

    if (!idToken) {
      setError(
        "LINEの本人確認トークンを取得できませんでした。画面を再読み込みしてください。"
      );
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          match_id: matchId,
          rating,
          comment,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "評価の送信に失敗しました"
        );
      }

      setReviewed(true);
      setRewardAmount(
        typeof data.rewardAmount === "number"
          ? data.rewardAmount
          : 0
      );
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
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <div className="animate-pulse">
            <div className="h-4 w-16 bg-gray-200 rounded" />

            <div className="mt-8 bg-white rounded-2xl border border-gray-100 p-6">
              <div className="mx-auto h-8 w-48 bg-gray-200 rounded" />

              <div className="mt-8 flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <div
                    key={star}
                    className="h-10 w-10 rounded bg-gray-200"
                  />
                ))}
              </div>

              <div className="mt-8 h-32 bg-gray-100 rounded-xl" />
              <div className="mt-5 h-12 bg-gray-200 rounded-xl" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 pb-10">
        <header className="pt-6">
          <button
            onClick={() =>
              router.push(`/facility/matches/${matchId}`)
            }
            className="inline-flex items-center text-sm font-medium text-gray-500"
          >
            ← マッチング詳細へ戻る
          </button>

          <div className="mt-6">
            <p className="text-xs font-bold tracking-wider text-gray-400">
              REVIEW
            </p>

            <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
              演奏者を評価
            </h1>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              今回の演奏について、
              演奏者への評価をお願いします。
            </p>
          </div>
        </header>

        <section className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          {reviewed ? (
            <>
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-2xl">
                  ✓
                </div>

                <h2 className="mt-4 text-lg font-bold text-gray-900">
                  評価済みです
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  このマッチングへの評価は送信済みです。
                </p>

                {rewardAmount !== null && (
                  <div className="mt-5 rounded-2xl border border-yellow-200 bg-yellow-50 p-4">
                    <p className="text-sm font-bold text-gray-700">
                      演奏者への評価報酬
                    </p>

                    <p className="mt-2 text-2xl font-bold text-yellow-700">
                      🪙 {rewardAmount} コイン
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      演奏者に評価報酬を付与しました。
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-7 rounded-2xl bg-gray-50 p-5 text-center">
                <p className="text-xs font-bold tracking-wide text-gray-400">
                  評価
                </p>

                <div className="mt-3 flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span key={star} className="text-3xl">
                      {star <= rating ? "⭐" : "☆"}
                    </span>
                  ))}
                </div>

                <p className="mt-2 text-sm font-bold text-gray-600">
                  {rating} / 5
                </p>

                {comment && (
                  <div className="mt-5 border-t border-gray-200 pt-5 text-left">
                    <p className="text-xs font-bold tracking-wide text-gray-400">
                      コメント
                    </p>

                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                      {comment}
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={() =>
                  router.push(`/facility/matches/${matchId}`)
                }
                className="mt-5 w-full rounded-xl bg-black px-4 py-3.5 text-sm font-bold text-white"
              >
                マッチング詳細へ戻る
              </button>
            </>
          ) : !canReview ? (
            <div className="py-6 text-center">
              <div className="text-3xl">⏳</div>

              <h2 className="mt-4 text-lg font-bold text-gray-900">
                演奏完了後に評価できます
              </h2>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                演奏が完了すると、演奏者への評価を投稿できるようになります。
              </p>

              <button
                type="button"
                onClick={() =>
                  router.push(`/facility/matches/${matchId}`)
                }
                className="mt-6 w-full rounded-xl bg-black px-4 py-3.5 text-sm font-bold text-white"
              >
                マッチング詳細へ戻る
              </button>
            </div>
          ) : (
            <>
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-2xl">
                  ⭐
                </div>

                <h2 className="mt-4 text-lg font-bold text-gray-900">
                  演奏者を評価してください
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  演奏や当日の対応について評価できます。
                </p>
              </div>

              <div className="mt-8 rounded-2xl bg-gray-50 p-5">
                <p className="text-center text-xs font-bold tracking-wide text-gray-400">
                  評価
                </p>

                <div className="mt-4 flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className="flex h-12 w-12 items-center justify-center rounded-xl text-3xl transition active:scale-95"
                      aria-label={`${star}点`}
                    >
                      {star <= rating ? "⭐" : "☆"}
                    </button>
                  ))}
                </div>

                <p className="mt-2 text-center text-sm font-bold text-gray-600">
                  {rating} / 5
                </p>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-gray-800">
                    コメント
                  </label>

                  <span className="text-xs text-gray-400">
                    任意
                  </span>
                </div>

                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="演奏者についての感想を入力してください"
                  rows={5}
                  className="mt-2 w-full resize-none rounded-xl border border-gray-200 bg-white p-4 text-sm leading-6 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                />
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-4">
                  <p className="text-sm leading-5 text-red-600">
                    {error}
                  </p>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="mt-6 w-full rounded-xl bg-black px-4 py-3.5 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {submitting ? "送信中..." : "⭐ 評価を送信"}
              </button>

              <p className="mt-3 text-center text-xs leading-5 text-gray-400">
                送信した評価は変更できません。
              </p>
            </>
          )}
        </section>

        <p className="mt-8 text-center text-xs text-gray-400">
          ご協力ありがとうございます
        </p>
      </div>
    </main>
  );
}