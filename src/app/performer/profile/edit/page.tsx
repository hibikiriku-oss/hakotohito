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

type StatusLevel =
  | "beginner"
  | "amateur"
  | "pro"
  | "";

const statusLevelOptions: {
  value: Exclude<StatusLevel, "">;
  label: string;
  shortLabel: string;
  description: string;
  colorClass: string;
  borderClass: string;
  textClass: string;
}[] = [
  {
    value: "beginner",
    label: "初心者",
    shortLabel: "BEGINNER",
    description:
      "人前での演奏経験がほぼ0",
    colorClass: "bg-green-50",
    borderClass: "border-green-200",
    textClass: "text-green-700",
  },
  {
    value: "amateur",
    label: "アマチュア",
    shortLabel: "AMATEUR",
    description:
      "人前での演奏は度々こなしているが、有料チケットを購入してもらえるほどの腕前ではない",
    colorClass: "bg-blue-50",
    borderClass: "border-blue-200",
    textClass: "text-blue-700",
  },
  {
    value: "pro",
    label: "プロ",
    shortLabel: "PRO",
    description:
      "演奏料やレッスン代金を生活の糧にしている",
    colorClass: "bg-violet-200",
    borderClass: "border-violet-400",
    textClass: "text-violet-900",
  },
];

export default function PerformerProfileEditPage() {
  const router = useRouter();

  const [lineUserId, setLineUserId] =
    useState("");

  const [name, setName] =
    useState("");

  const [area, setArea] =
    useState("");

  const [instruments, setInstruments] =
    useState("");

  const [genres, setGenres] =
    useState("");

  const [bio, setBio] =
    useState("");

  const [statusLevel, setStatusLevel] =
    useState<StatusLevel>("");

  const [performerId, setPerformerId] =
    useState("");

  const [reviewData, setReviewData] =
    useState<ReviewData | null>(null);

  const [reviewLoading, setReviewLoading] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  // =========================
  // プロフィール取得
  // =========================

  const loadProfile = async (
    userId: string
  ) => {
    try {
      const response = await fetch(
        "/api/performers/profile",
        {
          method: "GET",
          headers: {
            "x-line-user-id": userId,
          },
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "プロフィールの取得に失敗しました"
        );
      }

      const performer =
        data.performer;

      setPerformerId(
        performer.id || ""
      );

      setName(
        performer.name || ""
      );

      setArea(
        performer.area || ""
      );

      setInstruments(
        Array.isArray(
          performer.instruments
        )
          ? performer.instruments.join(
              ", "
            )
          : ""
      );

      setGenres(
        Array.isArray(
          performer.genres
        )
          ? performer.genres.join(
              ", "
            )
          : ""
      );

      setBio(
        performer.bio || ""
      );

      if (
        performer.status_level ===
          "beginner" ||
        performer.status_level ===
          "amateur" ||
        performer.status_level ===
          "pro"
      ) {
        setStatusLevel(
          performer.status_level
        );
      } else {
        setStatusLevel("");
      }

      if (performer.id) {
        await loadReviews(
          performer.id
        );
      }
    } catch (error) {
      console.error(
        "プロフィール取得エラー:",
        error
      );

      if (
        error instanceof Error
      ) {
        setError(
          error.message
        );
      } else {
        setError(
          "プロフィールの取得に失敗しました"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // 評価取得
  // =========================

  const loadReviews = async (
    performerId: string
  ) => {
    try {
      setReviewLoading(true);

      const response = await fetch(
        "/api/performers/" +
          performerId +
          "/reviews"
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "評価情報の取得に失敗しました"
        );
      }

      setReviewData(data);
    } catch (error) {
      console.error(
        "評価取得エラー:",
        error
      );

      setReviewData(null);
    } finally {
      setReviewLoading(false);
    }
  };

  // =========================
  // 星表示
  // =========================

  const renderStars = (
    rating: number
  ) => {
    return (
      "★".repeat(rating) +
      "☆".repeat(5 - rating)
    );
  };

  // =========================
  // 評価日付
  // =========================

  const formatReviewDate = (
    dateString: string
  ) => {
    const date =
      new Date(dateString);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }

    return date.toLocaleDateString(
      "ja-JP",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    );
  };

  // =========================
  // LINE / LIFF 初期化
  // =========================

  useEffect(() => {
    async function initLiff() {
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

        setLineUserId(
          profile.userId
        );

        await loadProfile(
          profile.userId
        );
      } catch (error) {
        console.error(
          "LIFF初期化エラー:",
          error
        );

        if (
          error instanceof Error
        ) {
          setError(
            error.message
          );
        } else {
          setError(
            "LINE情報の取得に失敗しました"
          );
        }

        setLoading(false);
      }
    }

    initLiff();
  }, []);

  // =========================
  // プロフィール更新
  // =========================

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (
      !name ||
      !area ||
      !instruments ||
      !genres ||
      !statusLevel
    ) {
      alert(
        "必須項目を入力してください"
      );
      return;
    }

    if (!lineUserId) {
      alert(
        "LINEユーザー情報を取得中です。少し待ってから再度お試しください。"
      );
      return;
    }

    try {
      setSaving(true);
      setError("");

      const response =
        await fetch(
          "/api/performers/profile",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
              "x-line-user-id":
                lineUserId,
            },
            body: JSON.stringify({
              name,
              area,
              instruments:
                instruments
                  .split(",")
                  .map(
                    (item) =>
                      item.trim()
                  )
                  .filter(Boolean),
              genres:
                genres
                  .split(",")
                  .map(
                    (item) =>
                      item.trim()
                  )
                  .filter(Boolean),
              bio,
              statusLevel,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "プロフィールの更新に失敗しました"
        );
      }

      alert(
        "プロフィールを更新しました"
      );

      router.push(
        "/performer/home"
      );
    } catch (error) {
      console.error(
        "プロフィール更新エラー:",
        error
      );

      if (
        error instanceof Error
      ) {
        setError(
          error.message
        );

        alert(
          error.message
        );
      } else {
        setError(
          "プロフィールの更新に失敗しました"
        );

        alert(
          "プロフィールの更新に失敗しました"
        );
      }
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // 読み込み中
  // =========================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-5 py-6">
          <button
            type="button"
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <div className="mt-8 bg-white rounded-3xl p-8 text-center shadow-sm">
            <div className="text-4xl">
              🎵
            </div>

            <p className="mt-4 text-gray-600">
              プロフィールを読み込んでいます...
            </p>
          </div>
        </div>
      </main>
    );
  }

  // =========================
  // エラー
  // =========================

  if (
    error &&
    !name &&
    !area
  ) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-5 py-6">
          <button
            type="button"
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <div className="mt-8 bg-white rounded-3xl p-6 shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center text-2xl">
              ⚠️
            </div>

            <h1 className="text-xl font-bold mt-5">
              プロフィールを読み込めませんでした
            </h1>

            <p className="text-red-600 text-sm mt-3 whitespace-pre-wrap leading-6">
              {error}
            </p>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/performer/home"
                )
              }
              className="w-full mt-6 bg-black text-white rounded-2xl p-4 font-bold"
            >
              ホームへ戻る
            </button>
          </div>
        </div>
      </main>
    );
  }

  // =========================
  // 画面
  // =========================

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-5 py-6 pb-10">

        {/* ヘッダー */}
        <header>
          <button
            type="button"
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <div className="mt-6">
            <p className="text-sm font-bold text-gray-500">
              🎸 演奏者ホーム
            </p>

            <h1 className="text-2xl font-bold mt-1">
              プロフィール編集
            </h1>

            <p className="text-sm text-gray-500 mt-2 leading-6">
              施設に表示されるプロフィールを編集できます。
            </p>
          </div>
        </header>

        {/* 評価 */}
        <section className="mt-7 bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-gray-400">
                REVIEWS
              </p>

              <h2 className="text-lg font-bold mt-1">
                ⭐ 評価
              </h2>
            </div>

            {reviewData &&
              reviewData.review_count >
                0 && (
                <div className="bg-yellow-50 rounded-2xl px-4 py-2 text-center">
                  <p className="text-lg font-bold text-yellow-700">
                    {reviewData.average_rating.toFixed(
                      1
                    )}
                  </p>

                  <p className="text-[11px] text-yellow-600">
                    平均評価
                  </p>
                </div>
              )}
          </div>

          {reviewLoading ? (
            <div className="mt-5 bg-gray-50 rounded-2xl p-5 text-center">
              <p className="text-sm text-gray-500">
                評価を読み込んでいます...
              </p>
            </div>
          ) : !reviewData ||
            reviewData.review_count ===
              0 ? (
            <div className="mt-5 bg-gray-50 rounded-2xl p-5 text-center">
              <div className="text-3xl">
                ⭐
              </div>

              <p className="text-sm text-gray-500 mt-2">
                まだ評価はありません。
              </p>

              <p className="text-xs text-gray-400 mt-1">
                演奏を重ねると施設から評価が届きます。
              </p>
            </div>
          ) : (
            <>
              <div className="mt-5 flex items-center gap-4 bg-yellow-50 rounded-2xl p-4">
                <div className="text-3xl font-bold text-gray-900">
                  {reviewData.average_rating.toFixed(
                    1
                  )}
                </div>

                <div>
                  <div className="text-yellow-500 text-xl tracking-wide">
                    {renderStars(
                      Math.round(
                        reviewData.average_rating
                      )
                    )}
                  </div>

                  <div className="text-xs text-gray-500 mt-1">
                    {reviewData.review_count}
                    件の評価
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {reviewData.reviews.map(
                  (review) => (
                    <div
                      key={review.id}
                      className="rounded-2xl bg-gray-50 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold truncate">
                            {review.reviewer_name}
                          </p>

                          <div className="text-yellow-500 mt-1 tracking-wide">
                            {renderStars(
                              review.rating
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-gray-400 shrink-0">
                          {formatReviewDate(
                            review.created_at
                          )}
                        </p>
                      </div>

                      {review.comment && (
                        <p className="text-sm text-gray-700 mt-3 leading-6 whitespace-pre-wrap">
                          {review.comment}
                        </p>
                      )}
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </section>

        {/* プロフィール編集フォーム */}
        <section className="mt-5 bg-white rounded-3xl p-5 shadow-sm border border-gray-100">
          <div className="mb-6">
            <p className="text-xs font-bold text-gray-400">
              PROFILE
            </p>

            <h2 className="text-lg font-bold mt-1">
              🎵 プロフィール情報
            </h2>

            <p className="text-sm text-gray-500 mt-2 leading-6">
              演奏案件を探す施設に表示される情報です。
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
          >

            {/* 名前 */}
            <div>
              <label className="flex items-center gap-2 font-bold text-sm mb-2">
                名前
                <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                  必須
                </span>
              </label>

              <input
                type="text"
                value={name}
                onChange={(event) =>
                  setName(
                    event.target.value
                  )
                }
                placeholder="例：山田太郎"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 outline-none focus:bg-white focus:border-black focus:ring-1 focus:ring-black"
              />
            </div>

            {/* 活動エリア */}
            <div>
              <label className="flex items-center gap-2 font-bold text-sm mb-2">
                活動エリア
                <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                  必須
                </span>
              </label>

              <input
                type="text"
                value={area}
                onChange={(event) =>
                  setArea(
                    event.target.value
                  )
                }
                placeholder="例：名古屋市"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 outline-none focus:bg-white focus:border-black focus:ring-1 focus:ring-black"
              />
            </div>

            {/* 楽器 */}
            <div>
              <label className="flex items-center gap-2 font-bold text-sm mb-2">
                楽器
                <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                  必須
                </span>
              </label>

              <input
                type="text"
                value={instruments}
                onChange={(event) =>
                  setInstruments(
                    event.target.value
                  )
                }
                placeholder="例：ギター, ピアノ"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 outline-none focus:bg-white focus:border-black focus:ring-1 focus:ring-black"
              />

              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」で区切ってください。
              </p>
            </div>

            {/* 音楽ジャンル */}
            <div>
              <label className="flex items-center gap-2 font-bold text-sm mb-2">
                音楽ジャンル
                <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                  必須
                </span>
              </label>

              <input
                type="text"
                value={genres}
                onChange={(event) =>
                  setGenres(
                    event.target.value
                  )
                }
                placeholder="例：J-POP, クラシック"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 outline-none focus:bg-white focus:border-black focus:ring-1 focus:ring-black"
              />

              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」で区切ってください。
              </p>
            </div>

            {/* 演奏レベル */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="font-bold text-sm">
                  演奏レベル
                </label>

                <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                  必須
                </span>
              </div>

              <p className="text-xs text-gray-400 leading-5 mb-4">
                ご自身の判断で近いものを選択してください。
                <br />
                このレベルは自己申告であり、運営による認定ではありません。
              </p>

              <div className="space-y-3">
                {statusLevelOptions.map(
                  (option) => {
                    const selected =
                      statusLevel ===
                      option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setStatusLevel(
                            option.value
                          )
                        }
                        disabled={saving}
                        className={`w-full text-left rounded-2xl border p-4 transition ${
                          selected
                            ? "border-black ring-2 ring-black/10"
                            : "border-gray-200"
                        } bg-white hover:bg-gray-50 disabled:opacity-50`}
                      >
                        <div className="flex items-center gap-4">
                          {/* ワッペン */}
                          <div
                            className={`shrink-0 w-[86px] h-[64px] flex flex-col items-center justify-center border-2 shadow-sm ${option.colorClass} ${option.borderClass} ${option.textClass}`}
                            style={{
                              clipPath:
                                "polygon(8% 0%, 92% 0%, 100% 12%, 100% 82%, 82% 82%, 50% 100%, 18% 82%, 0% 82%, 0% 12%)",
                            }}
                          >
                            <span className="text-[10px] font-black tracking-wider">
                              {option.shortLabel}
                            </span>

                            <span className="text-sm font-black mt-0.5">
                              {option.label}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-900">
                                {option.label}
                              </p>

                              {selected && (
                                <span className="text-[10px] bg-black text-white px-2 py-0.5 rounded-full">
                                  選択中
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-gray-500 leading-5 mt-1">
                              {option.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* 自己紹介 */}
            <div>
              <label className="font-bold text-sm mb-2 block">
                自己紹介
              </label>

              <textarea
                value={bio}
                onChange={(event) =>
                  setBio(
                    event.target.value
                  )
                }
                placeholder="演奏経験や活動内容など"
                rows={6}
                className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 outline-none focus:bg-white focus:border-black focus:ring-1 focus:ring-black resize-none"
              />

              <p className="text-xs text-gray-400 mt-2">
                演奏経験、活動内容、得意な演奏などを入力できます。
              </p>
            </div>

            {/* エラー */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <span className="text-lg">
                    ⚠️
                  </span>

                  <p className="text-sm text-red-600 leading-6">
                    {error}
                  </p>
                </div>
              </div>
            )}

            {/* 更新ボタン */}
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-black text-white rounded-2xl p-4 font-bold disabled:opacity-50"
            >
              {saving
                ? "更新しています..."
                : "プロフィールを更新する"}
            </button>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/performer/home"
                )
              }
              disabled={saving}
              className="w-full border border-gray-200 text-gray-600 rounded-2xl p-4 font-bold bg-white disabled:opacity-50"
            >
              キャンセル
            </button>
          </form>
        </section>

      </div>
    </main>
  );
}