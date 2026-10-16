"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

const PAGE_SIZE = 10;

type SortOrder = "newest" | "date";

type User = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
};

type Performer = {
  id: string;
  user_id: string;
  name: string;
  instruments: string[];
  genres: string[];
  area: string;
  bio: string | null;
  users: User | User[] | null;
};

type Review = {
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
  created_at: string;
};

export default function FacilityPerformerInvitePage() {
  const router = useRouter();
  const params = useParams();
  const performerId = params.id as string;

  const [lineUserId, setLineUserId] = useState("");
  const [performer, setPerformer] = useState<Performer | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showReviews, setShowReviews] = useState(false);

  const [requests, setRequests] = useState<PerformanceRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [page, setPage] = useState(1);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function initialize() {
      try {
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID || "",
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineUserId(profile.userId);

        const [performerResponse, requestsResponse] =
          await Promise.all([
            fetch(`/api/performers/${performerId}`),
            fetch("/api/facility/requests", {
              headers: {
                "x-line-user-id": profile.userId,
              },
            }),
          ]);

        const performerData = await performerResponse.json();
        const requestsData = await requestsResponse.json();

        if (!performerResponse.ok) {
          throw new Error(
            performerData.error ||
              "演奏者の情報を取得できませんでした"
          );
        }

        if (!requestsResponse.ok) {
          throw new Error(
            requestsData.error ||
              "案件情報を取得できませんでした"
          );
        }

        setPerformer(performerData.performer || null);
        setRating(performerData.rating ?? null);
        setReviewCount(performerData.review_count ?? 0);
        setReviews(performerData.reviews ?? []);

        const openRequests: PerformanceRequest[] = (
          requestsData.requests || []
        ).filter(
          (request: PerformanceRequest) =>
            request.status === "open"
        );

        setRequests(openRequests);
      } catch (error) {
        console.error("依頼画面初期化エラー:", error);

        setError(
          error instanceof Error
            ? error.message
            : "情報の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [performerId]);

  // 並び順を切り替えたら1ページ目へ戻す
  const handleSortChange = (value: SortOrder) => {
    setSortOrder(value);
    setPage(1);
  };

  // 案件を並べ替える
  const sortedRequests = [...requests].sort((a, b) => {
    if (sortOrder === "newest") {
      // 登録日時が新しい案件を先にする
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();

      const validA = Number.isFinite(dateA) ? dateA : 0;
      const validB = Number.isFinite(dateB) ? dateB : 0;

      return validB - validA;
    }

    // 演奏日が近い案件を先にする。同じ日なら開始時刻順。
    const performanceDateA =
      `${a.performance_date}T${a.start_time || "00:00"}`;
    const performanceDateB =
      `${b.performance_date}T${b.start_time || "00:00"}`;

    return performanceDateA.localeCompare(performanceDateB);
  });

  const totalPages = Math.max(
    1,
    Math.ceil(sortedRequests.length / PAGE_SIZE)
  );

  const startIndex = (page - 1) * PAGE_SIZE;
  const displayedRequests = sortedRequests.slice(
    startIndex,
    startIndex + PAGE_SIZE
  );

  const handleSubmit = async () => {
    if (!lineUserId) {
      setError("LINEユーザー情報を取得できませんでした");
      return;
    }

    if (!selectedRequestId) {
      setError("依頼する案件を選択してください");
      return;
    }

    setError("");
    setSuccess("");
    setSending(true);

    try {
      const response = await fetch("/api/facility/invitations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-user-id": lineUserId,
        },
        body: JSON.stringify({
          request_id: selectedRequestId,
          performer_id: performerId,
          message: message.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "依頼の送信に失敗しました"
        );
      }

      setSuccess("演奏依頼を送信しました");

      setTimeout(() => {
        router.push("/facility/performers");
      }, 1200);
    } catch (error) {
      console.error("演奏依頼送信エラー:", error);

      setError(
        error instanceof Error
          ? error.message
          : "依頼の送信に失敗しました"
      );
    } finally {
      setSending(false);
    }
  };

  const formatDate = (date: string) => {
    const parsedDate = new Date(`${date}T00:00:00`);

    return parsedDate.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  };

  const formatReviewDate = (date: string) => {
    return new Date(date).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (time: string) => time.slice(0, 5);

  const renderStars = (reviewRating: number) => {
    const stars = Math.max(0, Math.min(5, Math.round(reviewRating)));
    return "★".repeat(stars) + "☆".repeat(5 - stars);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">
          <header className="pb-6">
            <p className="text-sm font-medium text-gray-500">
              演奏者検索
            </p>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              🎹 演奏者に依頼する
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              演奏者と案件を確認しています。
            </p>
          </header>

          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            <div className="text-3xl">🎹</div>
            <p className="text-sm text-gray-500 mt-3">
              情報を読み込んでいます…
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error && !performer) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">
          <header className="pb-6">
            <p className="text-sm font-medium text-gray-500">
              演奏者検索
            </p>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              🎹 演奏者に依頼する
            </h1>
          </header>

          <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
            <div className="text-2xl">⚠️</div>
            <p className="text-sm font-bold text-red-700 mt-2">
              情報を取得できませんでした
            </p>
            <p className="text-sm text-red-600 mt-1 leading-relaxed">
              {error}
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/facility/performers")}
            className="w-full mt-5 bg-white border border-gray-200 rounded-2xl p-4 font-bold text-gray-700"
          >
            ← 演奏者を探すへ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">
        {/* ヘッダー */}
        <header className="pb-5">
          <button
            type="button"
            onClick={() => router.push("/facility/performers")}
            className="text-sm text-gray-500 mb-4"
          >
            ← 演奏者一覧へ戻る
          </button>

          <p className="text-sm font-medium text-gray-500">
            演奏者への依頼
          </p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            🎹 演奏者に依頼する
          </h1>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            募集中の案件を選択して、この演奏者へ依頼を送れます。
          </p>
        </header>

        {/* 演奏者プロフィール */}
        {performer && (
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-start gap-4">
              {performer.users &&
              !Array.isArray(performer.users) &&
              performer.users.picture_url ? (
                <img
                  src={performer.users.picture_url}
                  alt=""
                  className="w-16 h-16 rounded-2xl object-cover shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center text-3xl shrink-0">
                  🎹
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-400">
                  依頼する演奏者
                </p>
                <h2 className="text-xl font-bold text-gray-900 mt-1">
                  {performer.name}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  📍 {performer.area}
                </p>
              </div>
            </div>

            {/* 平均評価・レビュー件数 */}
            <div className="mt-4 flex items-center gap-3">
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-xs text-gray-400">平均評価</p>
                <p className="font-bold text-gray-900 mt-0.5">
                  ⭐ {rating !== null ? rating.toFixed(1) : "評価なし"}
                </p>
              </div>

              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-xs text-gray-400">レビュー</p>
                <p className="font-bold text-gray-900 mt-0.5">
                  {reviewCount}件
                </p>
              </div>
            </div>

            {performer.instruments?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-bold text-gray-500">
                  楽器
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {performer.instruments.map((instrument) => (
                    <span
                      key={instrument}
                      className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1"
                    >
                      🎹 {instrument}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {performer.genres?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-bold text-gray-500">
                  ジャンル
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {performer.genres.map((genre) => (
                    <span
                      key={genre}
                      className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1"
                    >
                      🎵 {genre}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {performer.bio && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-bold text-gray-500">
                  自己紹介
                </p>
                <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
                  {performer.bio}
                </p>
              </div>
            )}
          </section>
        )}

        {/* 折りたたみ式レビュー */}
        {performer && (
          <section className="mt-4 bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowReviews((current) => !current)}
              aria-expanded={showReviews}
              className="w-full p-5 flex items-center justify-between gap-3 text-left active:bg-gray-50"
            >
              <div className="min-w-0">
                <h2 className="text-base font-bold text-gray-900">
                  💬 評価・レビューを見る
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  {reviewCount > 0
                    ? `平均 ⭐ ${rating !== null ? rating.toFixed(1) : "—"} ・ ${reviewCount}件のレビュー`
                    : "レビューはまだありません"}
                </p>
              </div>

              <span className="shrink-0 flex items-center gap-2 text-sm font-bold text-gray-600">
                {showReviews ? "閉じる" : "表示"}
                <span
                  className={`transition-transform ${
                    showReviews ? "rotate-180" : ""
                  }`}
                >
                  ▼
                </span>
              </span>
            </button>

            {showReviews && (
              <div className="border-t border-gray-100 p-5">
                {reviews.length > 0 ? (
                  <div className="space-y-3">
                    {reviews.map((review, index) => (
                      <div
                        key={`${review.created_at}-${index}`}
                        className="bg-gray-50 rounded-2xl p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-yellow-500 text-sm tracking-wide">
                            {renderStars(review.rating)}
                          </span>
                          <span className="text-xs text-gray-400 shrink-0">
                            {formatReviewDate(review.created_at)}
                          </span>
                        </div>

                        {review.comment ? (
                          <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                            {review.comment}
                          </p>
                        ) : (
                          <p className="mt-3 text-sm text-gray-400">
                            コメントはありません。
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    まだレビューがありません。
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* 案件選択 */}
        <section className="mt-4 bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                📋 依頼する案件
              </h2>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                現在募集中の案件から選択してください。
              </p>
            </div>

            {requests.length > 0 && (
              <span className="shrink-0 bg-gray-100 rounded-full px-3 py-1 text-xs font-bold text-gray-600">
                {requests.length}件
              </span>
            )}
          </div>

          {requests.length === 0 ? (
            <div className="mt-5 bg-gray-50 rounded-2xl p-6 text-center">
              <div className="text-3xl">📋</div>
              <p className="font-bold text-gray-800 mt-3">
                現在、募集中の案件がありません
              </p>
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                新しい案件を登録すると、演奏者へ依頼できるようになります。
              </p>
              <button
                type="button"
                onClick={() => router.push("/facility/request")}
                className="mt-5 bg-black text-white rounded-xl px-5 py-3 font-bold"
              >
                ＋ 新しい案件を登録する
              </button>
            </div>
          ) : (
            <>
              {/* 並び替え */}
              <div className="mt-5">
                <label
                  htmlFor="request-sort"
                  className="block text-sm font-bold text-gray-700 mb-2"
                >
                  案件の並び順
                </label>
                <select
                  id="request-sort"
                  value={sortOrder}
                  onChange={(event) =>
                    handleSortChange(event.target.value as SortOrder)
                  }
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-white text-sm text-gray-800 outline-none focus:ring-2 focus:ring-black"
                >
                  <option value="newest">新着順</option>
                  <option value="date">演奏日が近い順</option>
                </select>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  {sortedRequests.length}件中{" "}
                  {startIndex + 1}～
                  {Math.min(startIndex + PAGE_SIZE, sortedRequests.length)}
                  件を表示
                </p>
                <p className="text-xs text-gray-400">
                  {page} / {totalPages}ページ
                </p>
              </div>

              {/* 現在のページの案件 */}
              <div className="mt-3 space-y-3">
                {displayedRequests.map((request) => {
                  const selected =
                    selectedRequestId === request.id;

                  return (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() => {
                        setSelectedRequestId(request.id);
                        setError("");
                      }}
                      className={`w-full text-left rounded-2xl border p-4 transition ${
                        selected
                          ? "border-black bg-gray-50 ring-1 ring-black"
                          : "border-gray-200 bg-white active:scale-[0.99]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${
                            selected
                              ? "border-black"
                              : "border-gray-300"
                          }`}
                        >
                          {selected && (
                            <div className="w-3 h-3 rounded-full bg-black" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-bold text-gray-900 leading-snug">
                              {request.title}
                            </h3>

                            {request.reward !== null && (
                              <span className="shrink-0 text-xs font-bold text-gray-700 bg-gray-100 rounded-full px-2.5 py-1">
                                ¥ {request.reward.toLocaleString()}
                              </span>
                            )}
                          </div>

                          <div className="mt-3 space-y-1.5">
                            <p className="text-sm text-gray-600">
                              📅 {formatDate(request.performance_date)}
                            </p>
                            <p className="text-sm text-gray-600">
                              🕐 {formatTime(request.start_time)}
                              {" ～ "}
                              {formatTime(request.end_time)}
                            </p>
                            {request.area && (
                              <p className="text-sm text-gray-600">
                                📍 {request.area}
                              </p>
                            )}
                          </div>

                          {(request.instruments?.length > 0 ||
                            request.genres?.length > 0) && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {request.instruments?.map((instrument) => (
                                <span
                                  key={`instrument-${instrument}`}
                                  className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1"
                                >
                                  🎹 {instrument}
                                </span>
                              ))}
                              {request.genres?.map((genre) => (
                                <span
                                  key={`genre-${genre}`}
                                  className="text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1"
                                >
                                  🎵 {genre}
                                </span>
                              ))}
                            </div>
                          )}

                          {request.description && (
                            <p className="mt-3 text-sm text-gray-500 line-clamp-3 leading-relaxed">
                              {request.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* ページ切り替え */}
              {totalPages > 1 && (
                <div className="mt-5 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPage((current) => Math.max(1, current - 1));
                    }}
                    disabled={page === 1}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← 前へ
                  </button>

                  <span className="text-sm text-gray-600">
                    {page} / {totalPages}
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      setPage((current) =>
                        Math.min(totalPages, current + 1)
                      );
                    }}
                    disabled={page === totalPages}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    次へ →
                  </button>
                </div>
              )}
            </>
          )}

          {requests.length > 0 && (
            <>
              {/* メッセージ */}
              <div className="mt-6">
                <label
                  htmlFor="invitation-message"
                  className="block text-sm font-bold text-gray-800 mb-2"
                >
                  💬 依頼メッセージ
                </label>

                <textarea
                  id="invitation-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  maxLength={1000}
                  placeholder="演奏者へのメッセージを入力してください"
                  className="w-full border border-gray-200 rounded-2xl px-4 py-3 bg-gray-50 resize-none outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
                />

                <div className="flex items-start justify-between gap-3 mt-2">
                  <p className="text-xs text-gray-400 leading-relaxed">
                    例：ぜひこちらのイベントで演奏をお願いしたいです。ご検討よろしくお願いします。
                  </p>
                  <span className="text-xs text-gray-400 shrink-0">
                    {message.length}/1000
                  </span>
                </div>
              </div>

              {/* エラー・成功 */}
              {error && (
                <div className="mt-4 bg-red-50 border border-red-100 rounded-2xl p-4">
                  <p className="text-sm font-bold text-red-700">
                    ⚠️ 送信できませんでした
                  </p>
                  <p className="text-sm text-red-600 mt-1">
                    {error}
                  </p>
                </div>
              )}

              {success && (
                <div className="mt-4 bg-green-50 border border-green-100 rounded-2xl p-4">
                  <p className="text-sm font-bold text-green-700">
                    ✓ 依頼を送信しました
                  </p>
                  <p className="text-sm text-green-600 mt-1">
                    演奏者一覧へ移動します…
                  </p>
                </div>
              )}

              {/* 送信 */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={sending || !selectedRequestId}
                className={`w-full mt-5 rounded-2xl p-4 font-bold transition ${
                  sending || !selectedRequestId
                    ? "bg-gray-200 text-gray-400"
                    : "bg-black text-white active:scale-[0.99]"
                }`}
              >
                {sending
                  ? "送信中..."
                  : selectedRequestId
                  ? "この案件で依頼を送信"
                  : "まず案件を選択してください"}
              </button>
            </>
          )}
        </section>

        {/* フッター */}
        <p className="text-center text-xs text-gray-400 mt-6 pb-4">
          演奏者と施設をつなぐ、演奏マッチング
        </p>
      </div>
    </main>
  );
}