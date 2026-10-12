"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();

  const matchId = params.id as string;

  const [lineUserId, setLineUserId] =
    useState("");

  const [rating, setRating] =
    useState(5);

  const [comment, setComment] =
    useState("");

  const [reviewed, setReviewed] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    const init = async () => {
      try {
        await liff.init({
          liffId:
            process.env
              .NEXT_PUBLIC_LIFF_ID!,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile =
          await liff.getProfile();

        setLineUserId(
          profile.userId
        );

        const response =
          await fetch(
            `/api/reviews?match_id=${matchId}`,
            {
              headers: {
                "x-line-user-id":
                  profile.userId,
              },
            }
          );

        if (!response.ok) {
          throw new Error(
            "評価情報の取得に失敗しました"
          );
        }

        const data =
          await response.json();

        setReviewed(
          data.reviewed
        );

        if (data.reviewed) {
          setRating(
            data.review?.rating ??
              5
          );

          setComment(
            data.review?.comment ??
              ""
          );
        }
      } catch (error) {
        console.error(error);

        setError(
          "評価情報を取得できませんでした。"
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [matchId]);

  const handleSubmit =
    async () => {
      if (!lineUserId) {
        setError(
          "LINEユーザー情報を取得できませんでした。"
        );

        return;
      }

      if (reviewed) {
        return;
      }

      setSubmitting(true);
      setError("");

      try {
        const response =
          await fetch(
            "/api/reviews",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                "x-line-user-id":
                  lineUserId,
              },
              body: JSON.stringify({
                match_id:
                  matchId,
                rating,
                comment,
              }),
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "評価の送信に失敗しました"
          );
        }

        setReviewed(true);

        router.push(
          `/performer/matches/${matchId}`
        );
      } catch (error) {
        console.error(error);

        if (
          error instanceof Error
        ) {
          setError(
            error.message
          );
        } else {
          setError(
            "評価の送信に失敗しました。"
          );
        }
      } finally {
        setSubmitting(false);
      }
    };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen">
          <div className="bg-black px-5 pt-5 pb-6">
            <div className="h-4 w-20 bg-white/20 rounded animate-pulse" />

            <div className="h-7 w-32 bg-white/20 rounded mt-5 animate-pulse" />
          </div>

          <div className="p-4">
            <div className="bg-white rounded-3xl p-6 shadow-sm">
              <div className="h-6 w-40 bg-gray-100 rounded mx-auto animate-pulse" />

              <div className="flex justify-center gap-2 mt-8">
                {[1, 2, 3, 4, 5].map(
                  (star) => (
                    <div
                      key={star}
                      className="w-10 h-10 rounded-full bg-gray-100 animate-pulse"
                    />
                  )
                )}
              </div>

              <div className="h-28 bg-gray-100 rounded-2xl mt-8 animate-pulse" />

              <div className="h-14 bg-gray-100 rounded-2xl mt-5 animate-pulse" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen">
        {/* ヘッダー */}
        <header className="bg-black text-white px-4 pt-4 pb-6">
          <button
            type="button"
            onClick={() =>
              router.push(
                `/performer/matches/${matchId}`
              )
            }
            className="inline-flex items-center text-sm text-gray-300 py-2"
          >
            ← マッチング詳細に戻る
          </button>

          <div className="flex items-center gap-3 mt-4">
            <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-xl">
              ⭐
            </div>

            <div>
              <p className="text-xs text-gray-400">
                マッチング終了後の評価
              </p>

              <h1 className="text-xl font-bold mt-0.5">
                施設を評価
              </h1>
            </div>
          </div>
        </header>

        <div className="p-4 pb-8">
          {/* エラー */}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-100 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">
                  ⚠️
                </span>

                <p className="text-sm text-red-700 leading-6">
                  {error}
                </p>
              </div>
            </div>
          )}

          <section className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            {/* セクションヘッダー */}
            <div className="px-5 pt-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-yellow-50 flex items-center justify-center text-3xl mx-auto">
                ⭐
              </div>

              <h2 className="text-xl font-bold text-gray-900 mt-4">
                {reviewed
                  ? "施設への評価"
                  : "施設はいかがでしたか？"}
              </h2>

              <p className="text-sm text-gray-500 mt-2 leading-6">
                {reviewed
                  ? "今回の演奏について投稿した評価です。"
                  : "演奏や当日の対応について、率直な感想を教えてください。"}
              </p>
            </div>

            {reviewed ? (
              /* 評価済み */
              <div className="p-5">
                <div className="bg-gray-50 rounded-2xl p-5">
                  <div className="text-center">
                    <span className="inline-flex items-center bg-white border border-gray-100 rounded-full px-3 py-1 text-xs font-medium text-gray-500">
                      ✓ 評価済み
                    </span>

                    <div className="flex justify-center gap-1 mt-5">
                      {[1, 2, 3, 4, 5].map(
                        (star) => (
                          <span
                            key={star}
                            className="text-3xl"
                          >
                            {star <= rating
                              ? "⭐"
                              : "☆"}
                          </span>
                        )
                      )}
                    </div>

                    <p className="text-sm font-bold text-gray-700 mt-2">
                      {rating} / 5
                    </p>
                  </div>

                  {comment && (
                    <div className="mt-5 pt-5 border-t border-gray-200">
                      <p className="text-xs font-bold text-gray-500 mb-2">
                        コメント
                      </p>

                      <p className="text-sm text-gray-700 leading-6 whitespace-pre-wrap break-words">
                        {comment}
                      </p>
                    </div>
                  )}

                  {!comment && (
                    <p className="text-sm text-gray-400 text-center mt-5">
                      コメントはありません。
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      `/performer/matches/${matchId}`
                    )
                  }
                  className="w-full mt-5 bg-black text-white rounded-2xl py-4 font-bold text-sm active:scale-[0.99] transition"
                >
                  マッチング詳細へ戻る
                </button>
              </div>
            ) : (
              /* 評価入力 */
              <div className="p-5">
                {/* 星評価 */}
                <div className="text-center">
                  <p className="text-sm font-bold text-gray-700">
                    評価を選択
                  </p>

                  <div className="flex justify-center gap-1.5 mt-4">
                    {[1, 2, 3, 4, 5].map(
                      (star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() =>
                            setRating(
                              star
                            )
                          }
                          disabled={
                            submitting
                          }
                          className="w-12 h-12 rounded-2xl flex items-center justify-center text-3xl transition active:scale-90 disabled:opacity-50"
                          aria-label={`${star}点`}
                        >
                          {star <= rating
                            ? "⭐"
                            : "☆"}
                        </button>
                      )
                    )}
                  </div>

                  <div className="inline-flex items-center bg-gray-50 rounded-full px-4 py-1.5 mt-3">
                    <span className="text-sm font-bold text-gray-700">
                      {rating} / 5
                    </span>
                  </div>
                </div>

                {/* コメント */}
                <div className="mt-7">
                  <div className="flex items-center justify-between mb-2">
                    <label
                      htmlFor="review-comment"
                      className="text-sm font-bold text-gray-700"
                    >
                      コメント
                    </label>

                    <span className="text-xs text-gray-400">
                      任意
                    </span>
                  </div>

                  <textarea
                    id="review-comment"
                    value={comment}
                    onChange={(event) =>
                      setComment(
                        event.target.value
                      )
                    }
                    placeholder="施設での演奏について、感想を入力してください"
                    rows={5}
                    disabled={
                      submitting
                    }
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm text-gray-900 placeholder:text-gray-400 outline-none resize-none focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100 disabled:opacity-50 leading-6"
                  />
                </div>

                <p className="text-xs text-gray-400 mt-2">
                  施設とのやり取りや演奏環境など、今後の参考になる内容がおすすめです。
                </p>

                {/* 送信 */}
                <button
                  type="button"
                  onClick={
                    handleSubmit
                  }
                  disabled={
                    submitting
                  }
                  className="w-full mt-6 bg-black text-white rounded-2xl py-4 font-bold text-sm shadow-sm transition active:scale-[0.99] disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                >
                  {submitting ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      送信中...
                    </span>
                  ) : (
                    "⭐ 評価を送信"
                  )}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}