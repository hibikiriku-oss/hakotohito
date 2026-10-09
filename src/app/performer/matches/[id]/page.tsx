"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Facility = {
  id: string;
  name: string | null;
  facility_type: string | null;
  address: string | null;
  description: string | null;
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

type Match = {
  id: string;
  request_id: string;
  performer_id: string;
  matched_at: string;
  status: string;
  performance_status: "scheduled" | "completed" | "cancelled";
  completed_at: string | null;
  performance_requests: PerformanceRequest | null;
};

export default function PerformerMatchDetailPage() {
  const router = useRouter();
  const params = useParams();

  const matchId = params.id as string;

  const [match, setMatch] =
    useState<Match | null>(null);

  const [reviewed, setReviewed] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [completing, setCompleting] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function initialize() {
      try {
        const liffId =
          process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "LINE MINI Appの設定がありません"
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

        const response = await fetch(
          `/api/performer/matches/${matchId}`,
          {
            headers: {
              "x-line-user-id":
                profile.userId,
            },
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "マッチング情報の取得に失敗しました"
          );
        }

        setMatch(data.match);

        const reviewResponse = await fetch(
          `/api/reviews?match_id=${matchId}`,
          {
            headers: {
              "x-line-user-id":
                profile.userId,
            },
          }
        );

        if (reviewResponse.ok) {
          const reviewData =
            await reviewResponse.json();

          setReviewed(
            reviewData.reviewed === true
          );
        }
      } catch (error) {
        console.error(
          "マッチング詳細取得エラー:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "マッチング情報の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [matchId]);

  async function handleComplete() {
    if (!match) {
      return;
    }

    const confirmed = window.confirm(
      "この演奏を完了済みにしますか？"
    );

    if (!confirmed) {
      return;
    }

    try {
      setCompleting(true);
      setError("");

      const liffId =
        process.env.NEXT_PUBLIC_LIFF_ID;

      if (!liffId) {
        throw new Error(
          "LINE MINI Appの設定がありません"
        );
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile =
        await liff.getProfile();

      const response = await fetch(
        `/api/performer/matches/${matchId}/complete`,
        {
          method: "POST",
          headers: {
            "x-line-user-id":
              profile.userId,
          },
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "演奏完了の更新に失敗しました"
        );
      }

      setMatch((currentMatch) => {
        if (!currentMatch) {
          return currentMatch;
        }

        return {
          ...currentMatch,
          performance_status:
            "completed",
          completed_at:
            data.match?.completed_at ??
            new Date().toISOString(),
        };
      });
    } catch (error) {
      console.error(
        "演奏完了処理エラー:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "演奏完了の更新に失敗しました"
      );
    } finally {
      setCompleting(false);
    }
  }

  function formatDate(date: string) {
    const [year, month, day] =
      date.split("-");

    return `${year}年${month}月${day}日`;
  }

  function formatTime(time: string) {
    return time.slice(0, 5);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            🎵 マッチング詳細
          </h1>

          <p className="mt-8 text-center text-gray-500">
            読み込み中...
          </p>
        </div>
      </main>
    );
  }

  if (error || !match) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            🎵 マッチング詳細
          </h1>

          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">
              {error ||
                "マッチング情報が見つかりません"}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/performer/matches"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← マッチング一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  const performanceRequest =
    match.performance_requests;

  const facility =
    performanceRequest?.facilities;

  if (!performanceRequest) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-red-600">
            案件の情報が見つかりません。
          </p>

          <button
            onClick={() =>
              router.push(
                "/performer/matches"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← マッチング一覧へ戻る
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
              "/performer/matches"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← マッチング一覧へ戻る
        </button>

        <h1 className="text-2xl font-bold">
          🎵 マッチング詳細
        </h1>

        <div className="mt-5 bg-green-50 border border-green-200 rounded-2xl p-5">
          <p className="text-green-700 font-bold">
            🎉 マッチング成立
          </p>

          <p className="mt-2 text-sm text-green-700">
            この施設への出演が決定しています。
          </p>
        </div>

        {/* 演奏ステータス */}
        <section className="mt-4 bg-white rounded-2xl p-5 shadow-sm border">

          <h2 className="font-bold">
            🎵 演奏状況
          </h2>

          {match.performance_status ===
          "completed" ? (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-green-700 font-bold">
                ✅ 演奏完了
              </p>

              {match.completed_at && (
                <p className="mt-1 text-sm text-green-600">
                  完了日時：
                  {new Date(
                    match.completed_at
                  ).toLocaleString("ja-JP")}
                </p>
              )}
            </div>
          ) : match.performance_status ===
            "cancelled" ? (
            <div className="mt-4 bg-gray-100 rounded-xl p-4">
              <p className="text-gray-600 font-bold">
                キャンセル済み
              </p>
            </div>
          ) : (
            <>
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-blue-700 font-bold">
                  📅 演奏予定
                </p>

                <p className="mt-1 text-sm text-blue-600">
                  演奏が終わったら、下のボタンから完了にしてください。
                </p>
              </div>

              <button
                onClick={handleComplete}
                disabled={completing}
                className="w-full mt-4 bg-green-600 text-white rounded-xl p-4 font-bold disabled:opacity-50"
              >
                {completing
                  ? "更新中..."
                  : "🎵 演奏完了"}
              </button>
            </>
          )}

        </section>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-red-600">
              {error}
            </p>
          </div>
        )}

        <section className="mt-5 bg-white rounded-2xl p-5 shadow-sm border">

          <h2 className="text-xl font-bold">
            {performanceRequest.title}
          </h2>

          {performanceRequest.description && (
            <p className="mt-4 text-gray-700 whitespace-pre-wrap">
              {performanceRequest.description}
            </p>
          )}

        </section>

        <section className="mt-4 bg-white rounded-2xl p-5 shadow-sm border">

          <h2 className="font-bold">
            📅 演奏日時
          </h2>

          <p className="mt-3 text-lg font-bold">
            {formatDate(
              performanceRequest.performance_date
            )}
          </p>

          <p className="mt-1 text-gray-600">
            {formatTime(
              performanceRequest.start_time
            )}
            {" ～ "}
            {formatTime(
              performanceRequest.end_time
            )}
          </p>

        </section>

        <section className="mt-4 bg-white rounded-2xl p-5 shadow-sm border">

          <h2 className="font-bold">
            📍 場所
          </h2>

          {performanceRequest.area && (
            <p className="mt-3 font-bold">
              {performanceRequest.area}
            </p>
          )}

          {facility?.address && (
            <p className="mt-1 text-gray-600">
              {facility.address}
            </p>
          )}

        </section>

        <section className="mt-4 bg-white rounded-2xl p-5 shadow-sm border">

          <h2 className="font-bold">
            💰 報酬
          </h2>

          <p className="mt-3 text-2xl font-bold">
            {performanceRequest.reward !== null
              ? `${performanceRequest.reward.toLocaleString()}円`
              : "要相談"}
          </p>

        </section>

        {performanceRequest.instruments?.length >
          0 && (
          <section className="mt-4 bg-white rounded-2xl p-5 shadow-sm border">

            <h2 className="font-bold">
              🎸 募集楽器
            </h2>

            <div className="flex flex-wrap gap-2 mt-3">
              {performanceRequest.instruments.map(
                (instrument) => (
                  <span
                    key={instrument}
                    className="bg-gray-100 rounded-full px-3 py-1 text-sm"
                  >
                    {instrument}
                  </span>
                )
              )}
            </div>

          </section>
        )}

        {performanceRequest.genres?.length >
          0 && (
          <section className="mt-4 bg-white rounded-2xl p-5 shadow-sm border">

            <h2 className="font-bold">
              🎵 募集ジャンル
            </h2>

            <div className="flex flex-wrap gap-2 mt-3">
              {performanceRequest.genres.map(
                (genre) => (
                  <span
                    key={genre}
                    className="bg-gray-100 rounded-full px-3 py-1 text-sm"
                  >
                    {genre}
                  </span>
                )
              )}
            </div>

          </section>
        )}

        {facility && (
          <section className="mt-4 bg-white rounded-2xl p-5 shadow-sm border">

            <h2 className="font-bold">
              🏢 施設について
            </h2>

            <p className="mt-4 text-xl font-bold">
              {facility.name ||
                "施設名未登録"}
            </p>

            {facility.facility_type && (
              <p className="mt-1 text-sm text-gray-500">
                {facility.facility_type}
              </p>
            )}

            {facility.description && (
              <p className="mt-4 text-gray-700 whitespace-pre-wrap">
                {facility.description}
              </p>
            )}

          </section>
        )}

        {/* 評価 */}
        <section className="mt-4 bg-white rounded-2xl p-5 shadow-sm border">

          <h2 className="font-bold">
            ⭐ 施設を評価
          </h2>

          {reviewed ? (
            <div className="mt-4 bg-gray-50 rounded-xl p-4">
              <p className="text-gray-700 font-bold">
                評価済みです
              </p>

              <p className="mt-1 text-sm text-gray-500">
                このマッチングはすでに評価しています。
              </p>
            </div>
          ) : (
            <button
              onClick={() =>
                router.push(
                  `/performer/matches/${matchId}/review`
                )
              }
              className="w-full mt-4 bg-yellow-500 text-white rounded-xl p-4 font-bold"
            >
              ⭐ この施設を評価する
            </button>
          )}

        </section>

        <button
          onClick={() =>
            router.push(
              "/performer/matches"
            )
          }
          className="w-full mt-6 bg-black text-white rounded-xl p-4"
        >
          マッチング一覧に戻る
        </button>

      </div>
    </main>
  );
}