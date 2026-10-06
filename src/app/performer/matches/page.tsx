"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  performance_requests: PerformanceRequest | null;
};

export default function PerformerMatchesPage() {
  const router = useRouter();

  const [matches, setMatches] =
    useState<Match[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

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

        const response = await fetch(
          "/api/performer/matches",
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

        setMatches(
          data.matches || []
        );

      } catch (error) {
        console.error(
          "マッチング取得エラー:",
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
  }, []);

  function formatDate(
    date: string
  ) {
    const [year, month, day] =
      date.split("-");

    return `${year}/${month}/${day}`;
  }

  function formatTime(
    time: string
  ) {
    return time.slice(0, 5);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">

          <h1 className="text-2xl font-bold">
            🎉 マッチング一覧
          </h1>

          <p className="mt-8 text-center text-gray-500">
            マッチング情報を読み込んでいます…
          </p>

        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">

          <h1 className="text-2xl font-bold">
            🎉 マッチング一覧
          </h1>

          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">
              {error}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← ホームへ戻る
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
              "/performer/home"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← ホームへ戻る
        </button>

        <h1 className="text-2xl font-bold">
          🎉 マッチング一覧
        </h1>

        {matches.length === 0 ? (
          <div className="mt-6 bg-white rounded-2xl p-6 text-center">

            <p className="text-gray-500">
              まだマッチングはありません。
            </p>

            <button
              onClick={() =>
                router.push(
                  "/performer/requests"
                )
              }
              className="w-full mt-5 bg-black text-white rounded-xl p-4"
            >
              🔍 演奏案件を探す
            </button>

          </div>
        ) : (
          <div className="mt-6 space-y-4">

            {matches.map((match) => {
              const performanceRequest =
                match.performance_requests;

              if (!performanceRequest) {
                return null;
              }

              const facility =
                performanceRequest.facilities;

              return (
                <div
                  key={match.id}
                  className="bg-white rounded-2xl p-5 shadow-sm border"
                >

                  {/* ステータス */}
                  <div className="flex items-center justify-between">

                    <span className="text-sm font-bold">
                      🎉 マッチング成立
                    </span>

                    <span className="text-xs bg-green-100 text-green-700 rounded-full px-3 py-1">
                      {match.status ===
                      "active"
                        ? "進行中"
                        : "キャンセル"}
                    </span>

                  </div>

                  {/* 案件タイトル */}
                  <h2 className="text-xl font-bold mt-4">
                    {performanceRequest.title}
                  </h2>

                  {/* 施設 */}
                  {facility && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        施設
                      </p>

                      <p className="mt-1 font-bold">
                        🏢 {facility.name ||
                          "施設名未登録"}
                      </p>

                      {facility.facility_type && (
                        <p className="text-sm text-gray-600 mt-1">
                          {facility.facility_type}
                        </p>
                      )}

                    </div>
                  )}

                  {/* 日時 */}
                  <div className="mt-4">

                    <p className="text-sm text-gray-500">
                      演奏日時
                    </p>

                    <p className="mt-1 font-bold">
                      📅{" "}
                      {formatDate(
                        performanceRequest.performance_date
                      )}
                    </p>

                    <p className="text-sm text-gray-600 mt-1">
                      🕐{" "}
                      {formatTime(
                        performanceRequest.start_time
                      )}
                      {" ～ "}
                      {formatTime(
                        performanceRequest.end_time
                      )}
                    </p>

                  </div>

                  {/* 場所 */}
                  {(performanceRequest.area ||
                    facility?.address) && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        場所
                      </p>

                      {performanceRequest.area && (
                        <p className="mt-1">
                          📍{" "}
                          {performanceRequest.area}
                        </p>
                      )}

                      {facility?.address && (
                        <p className="text-sm text-gray-600 mt-1">
                          {facility.address}
                        </p>
                      )}

                    </div>
                  )}

                  {/* 楽器 */}
                  {performanceRequest.instruments?.length >
                    0 && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        募集楽器
                      </p>

                      <div className="flex flex-wrap gap-2 mt-2">

                        {performanceRequest.instruments.map(
                          (instrument) => (
                            <span
                              key={instrument}
                              className="text-sm bg-gray-100 rounded-full px-3 py-1"
                            >
                              🎵 {instrument}
                            </span>
                          )
                        )}

                      </div>

                    </div>
                  )}

                  {/* ジャンル */}
                  {performanceRequest.genres?.length >
                    0 && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        ジャンル
                      </p>

                      <div className="flex flex-wrap gap-2 mt-2">

                        {performanceRequest.genres.map(
                          (genre) => (
                            <span
                              key={genre}
                              className="text-sm bg-gray-100 rounded-full px-3 py-1"
                            >
                              🎼 {genre}
                            </span>
                          )
                        )}

                      </div>

                    </div>
                  )}

                  {/* 報酬 */}
                  {performanceRequest.reward !==
                    null && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        報酬
                      </p>

                      <p className="mt-1 font-bold">
                        💰{" "}
                        {performanceRequest.reward.toLocaleString()}
                        円
                      </p>

                    </div>
                  )}

                  {/* 施設住所 */}
                  {facility?.description && (
                    <div className="mt-4">

                      <p className="text-sm text-gray-500">
                        施設について
                      </p>

                      <p className="mt-1 text-sm whitespace-pre-wrap">
                        {facility.description}
                      </p>

                    </div>
                  )}

                </div>
              );
            })}

          </div>
        )}

        <button
          onClick={() =>
            router.push(
              "/performer/home"
            )
          }
          className="w-full mt-6 bg-white border rounded-xl p-4"
        >
          ← ホームへ戻る
        </button>

      </div>
    </main>
  );
}