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

export default function PerformerProfileEditPage() {
  const router = useRouter();

  const [lineUserId, setLineUserId] = useState("");

  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [instruments, setInstruments] = useState("");
  const [genres, setGenres] = useState("");
  const [bio, setBio] = useState("");

  const [performerId, setPerformerId] = useState("");

  const [reviewData, setReviewData] =
    useState<ReviewData | null>(null);
  const [reviewLoading, setReviewLoading] =
    useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // =========================
  // プロフィール取得
  // =========================
  const loadProfile = async (userId: string) => {
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "プロフィールの取得に失敗しました"
        );
      }

      const performer = data.performer;

      setPerformerId(performer.id || "");

      setName(performer.name || "");
      setArea(performer.area || "");

      setInstruments(
        Array.isArray(performer.instruments)
          ? performer.instruments.join(", ")
          : ""
      );

      setGenres(
        Array.isArray(performer.genres)
          ? performer.genres.join(", ")
          : ""
      );

      setBio(performer.bio || "");

      if (performer.id) {
        await loadReviews(performer.id);
      }
    } catch (error) {
      console.error(
        "プロフィール取得エラー:",
        error
      );

      if (error instanceof Error) {
        setError(error.message);
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

      const data = await response.json();

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
  const renderStars = (rating: number) => {
    return "★".repeat(rating) +
      "☆".repeat(5 - rating);
  };

  // =========================
  // 評価日付
  // =========================
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

        setLineUserId(profile.userId);

        await loadProfile(profile.userId);
      } catch (error) {
        console.error(
          "LIFF初期化エラー:",
          error
        );

        if (error instanceof Error) {
          setError(error.message);
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
      !genres
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

      const response = await fetch(
        "/api/performers/profile",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-line-user-id": lineUserId,
          },
          body: JSON.stringify({
            name,
            area,
            instruments: instruments
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            genres: genres
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            bio,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "プロフィールの更新に失敗しました"
        );
      }

      alert(
        "プロフィールを更新しました"
      );

      router.push("/performer/home");
    } catch (error) {
      console.error(
        "プロフィール更新エラー:",
        error
      );

      if (error instanceof Error) {
        setError(error.message);
        alert(error.message);
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
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-center text-gray-600">
            プロフィールを読み込み中...
          </p>
        </div>
      </main>
    );
  }

  // =========================
  // エラー
  // =========================
  if (error && !name && !area) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h1 className="text-xl font-bold mb-4">
              プロフィール編集
            </h1>

            <p className="text-red-600 whitespace-pre-wrap">
              {error}
            </p>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/performer/home"
                )
              }
              className="w-full mt-6 bg-black text-white rounded-xl p-4 font-bold"
            >
              戻る
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
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <button
          type="button"
          onClick={() =>
            router.push(
              "/performer/home"
            )
          }
          className="text-gray-600 mb-4"
        >
          ← 戻る
        </button>

        <h1 className="text-2xl font-bold mb-2">
          🎵 プロフィール編集
        </h1>

        <p className="text-gray-600 mb-6">
          施設に表示されるプロフィールを編集できます。
        </p>

        {/* ========================= */}
        {/* 評価 */}
        {/* ========================= */}
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">

          <h2 className="text-xl font-bold mb-4">
            ⭐ 評価
          </h2>

          {reviewLoading ? (
            <p className="text-gray-500">
              評価を読み込み中...
            </p>
          ) : !reviewData ||
            reviewData.review_count === 0 ? (
            <p className="text-gray-500">
              まだ評価はありません。
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="text-3xl font-bold">
                  {reviewData.average_rating.toFixed(
                    1
                  )}
                </div>

                <div>
                  <div className="text-yellow-500 text-xl">
                    {renderStars(
                      Math.round(
                        reviewData.average_rating
                      )
                    )}
                  </div>

                  <div className="text-sm text-gray-500">
                    {reviewData.review_count}
                    件の評価
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {reviewData.reviews.map(
                  (review) => (
                    <div
                      key={review.id}
                      className="border-t pt-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-bold">
                          {review.reviewer_name}
                        </div>

                        <div className="text-xs text-gray-500">
                          {formatReviewDate(
                            review.created_at
                          )}
                        </div>
                      </div>

                      <div className="text-yellow-500 mt-1">
                        {renderStars(
                          review.rating
                        )}
                      </div>

                      {review.comment && (
                        <p className="text-gray-700 mt-2 whitespace-pre-wrap">
                          {review.comment}
                        </p>
                      )}
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </div>

        {/* ========================= */}
        {/* プロフィール編集 */}
        {/* ========================= */}

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* 名前 */}
          <div>
            <label className="block font-bold mb-1">
              名前
            </label>

            <input
              type="text"
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="例：山田太郎"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 活動エリア */}
          <div>
            <label className="block font-bold mb-1">
              活動エリア
            </label>

            <input
              type="text"
              value={area}
              onChange={(event) =>
                setArea(event.target.value)
              }
              placeholder="例：名古屋市"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 楽器 */}
          <div>
            <label className="block font-bold mb-1">
              楽器
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
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください。
            </p>
          </div>

          {/* 音楽ジャンル */}
          <div>
            <label className="block font-bold mb-1">
              音楽ジャンル
            </label>

            <input
              type="text"
              value={genres}
              onChange={(event) =>
                setGenres(event.target.value)
              }
              placeholder="例：J-POP, クラシック"
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください。
            </p>
          </div>

          {/* 自己紹介 */}
          <div>
            <label className="block font-bold mb-1">
              自己紹介
            </label>

            <textarea
              value={bio}
              onChange={(event) =>
                setBio(event.target.value)
              }
              placeholder="演奏経験や活動内容など"
              rows={5}
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* エラー */}
          {error && (
            <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">
              {error}
            </div>
          )}

          {/* 更新ボタン */}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
          >
            {saving
              ? "更新中..."
              : "プロフィールを更新する"}
          </button>

        </form>
      </div>
    </main>
  );
}