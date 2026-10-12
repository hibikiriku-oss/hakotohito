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
  status: "active" | "cancelled" | string;
  performance_status:
    | "scheduled"
    | "completed"
    | "cancelled"
    | string;
  completed_at: string | null;
  performance_requests:
    | PerformanceRequest
    | null;
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
    const [
      year,
      month,
      day,
    ] = date.split("-");

    return (
      year +
      "/" +
      month +
      "/" +
      day
    );
  }

  function formatTime(
    time: string
  ) {
    return time.slice(0, 5);
  }

  function getPerformanceStatus(
    match: Match
  ) {
    if (
      match.status ===
        "cancelled" ||
      match.performance_status ===
        "cancelled"
    ) {
      return {
        key: "cancelled",
        label: "キャンセル済み",
      };
    }

    if (
      match.performance_status ===
      "completed"
    ) {
      return {
        key: "completed",
        label: "演奏終了",
      };
    }

    return {
      key: "scheduled",
      label: "演奏予定",
    };
  }

  const scheduledMatches =
    matches
      .filter(
        (match) =>
          getPerformanceStatus(
            match
          ).key === "scheduled"
      )
      .sort((a, b) => {
        const requestA =
          a.performance_requests;

        const requestB =
          b.performance_requests;

        if (
          !requestA ||
          !requestB
        ) {
          return 0;
        }

        const dateA =
          `${requestA.performance_date}T${requestA.start_time}`;

        const dateB =
          `${requestB.performance_date}T${requestB.start_time}`;

        return (
          new Date(dateA).getTime() -
          new Date(dateB).getTime()
        );
      });

  const historyMatches =
    matches
      .filter(
        (match) =>
          getPerformanceStatus(
            match
          ).key !== "scheduled"
      )
      .sort((a, b) => {
        const requestA =
          a.performance_requests;

        const requestB =
          b.performance_requests;

        if (
          !requestA ||
          !requestB
        ) {
          return 0;
        }

        const dateA =
          `${requestA.performance_date}T${requestA.start_time}`;

        const dateB =
          `${requestB.performance_date}T${requestB.start_time}`;

        return (
          new Date(dateB).getTime() -
          new Date(dateA).getTime()
        );
      });

  function renderMatchCard(
    match: Match
  ) {
    const performanceRequest =
      match.performance_requests;

    if (!performanceRequest) {
      return null;
    }

    const facility =
      performanceRequest.facilities;

    const performanceStatus =
      getPerformanceStatus(
        match
      );

    const isCompleted =
      performanceStatus.key ===
      "completed";

    const isCancelled =
      performanceStatus.key ===
      "cancelled";

    return (
      <button
        key={match.id}
        type="button"
        onClick={() =>
          router.push(
            `/performer/matches/${match.id}`
          )
        }
        className="w-full text-left bg-white rounded-2xl p-5 shadow-sm border border-gray-100 active:scale-[0.99] transition"
      >
        {/* ステータス */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-gray-800">
            🎉 マッチング成立
          </span>

          {isCancelled ? (
            <span className="shrink-0 text-xs bg-red-50 text-red-600 rounded-full px-3 py-1 font-bold">
              キャンセル済み
            </span>
          ) : isCompleted ? (
            <span className="shrink-0 text-xs bg-gray-100 text-gray-600 rounded-full px-3 py-1 font-bold">
              演奏終了
            </span>
          ) : (
            <span className="shrink-0 text-xs bg-blue-50 text-blue-700 rounded-full px-3 py-1 font-bold">
              演奏予定
            </span>
          )}
        </div>

        {/* 案件タイトル */}
        <h2 className="text-xl font-bold text-gray-900 mt-4">
          {performanceRequest.title}
        </h2>

        {/* 施設 */}
        {facility && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 font-medium">
              施設
            </p>

            <div className="flex items-center gap-3 mt-2">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-lg">
                🏢
              </div>

              <div className="min-w-0">
                <p className="font-bold text-gray-800 truncate">
                  {facility.name ||
                    "施設名未設定"}
                </p>

                {facility.facility_type && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {facility.facility_type}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 演奏日時 */}
        <div className="mt-4 bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 font-medium">
            演奏日時
          </p>

          <p className="mt-1 font-bold text-gray-800">
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
            <p className="text-xs text-gray-400 font-medium">
              場所
            </p>

            {performanceRequest.area && (
              <p className="mt-1 text-sm text-gray-700">
                📍{" "}
                {performanceRequest.area}
              </p>
            )}

            {facility?.address && (
              <p className="mt-1 text-xs text-gray-500">
                {facility.address}
              </p>
            )}
          </div>
        )}

        {/* 報酬 */}
        {performanceRequest.reward !==
          null && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 font-medium">
              報酬
            </p>

            <p className="mt-1 font-bold text-gray-800">
              💰{" "}
              {performanceRequest.reward.toLocaleString()}
              円
            </p>
          </div>
        )}

        {/* 履歴の補足 */}
        {isCancelled && (
          <div className="mt-4 bg-red-50 rounded-xl p-3">
            <p className="text-sm text-red-700">
              このマッチングはキャンセルされています。
            </p>
          </div>
        )}

        {isCompleted && (
          <div className="mt-4 bg-gray-50 rounded-xl p-3">
            <p className="text-sm text-gray-600">
              この演奏は終了しています。
            </p>

            {match.completed_at && (
              <p className="text-xs text-gray-400 mt-1">
                完了：
                {new Date(
                  match.completed_at
                ).toLocaleString(
                  "ja-JP"
                )}
              </p>
            )}
          </div>
        )}

        {!isCancelled &&
          !isCompleted && (
            <div className="mt-4 bg-blue-50 rounded-xl p-3">
              <p className="text-sm text-blue-700 font-medium">
                📅 演奏予定です
              </p>
            </div>
          )}

        <div className="mt-4 pt-3 border-t border-gray-100 text-right">
          <span className="text-sm font-bold text-gray-500">
            詳細を見る →
          </span>
        </div>
      </button>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto">
          <header className="bg-black text-white px-5 pt-5 pb-6">
            <div className="h-4 w-24 bg-white/20 rounded animate-pulse" />

            <div className="h-7 w-40 bg-white/20 rounded mt-5 animate-pulse" />
          </header>

          <div className="p-4 space-y-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="h-5 w-28 bg-gray-100 rounded animate-pulse" />
              <div className="h-7 w-52 bg-gray-100 rounded mt-4 animate-pulse" />
              <div className="h-20 bg-gray-100 rounded-xl mt-4 animate-pulse" />
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="h-5 w-28 bg-gray-100 rounded animate-pulse" />
              <div className="h-7 w-48 bg-gray-100 rounded mt-4 animate-pulse" />
              <div className="h-20 bg-gray-100 rounded-xl mt-4 animate-pulse" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto">
          <header className="bg-black text-white px-5 pt-5 pb-6">
            <button
              type="button"
              onClick={() =>
                router.push(
                  "/performer/home"
                )
              }
              className="text-sm text-gray-300"
            >
              ← ホームへ戻る
            </button>

            <h1 className="text-xl font-bold mt-5">
              🎉 マッチング一覧
            </h1>
          </header>

          <div className="p-4">
            <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
              <p className="text-sm text-red-700 leading-6">
                {error}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/performer/home"
                )
              }
              className="w-full mt-4 bg-white border border-gray-200 rounded-2xl py-4 font-bold text-gray-700"
            >
              ← ホームへ戻る
            </button>
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
                "/performer/home"
              )
            }
            className="inline-flex items-center text-sm text-gray-300 py-2"
          >
            ← ホームへ戻る
          </button>

          <div className="flex items-center gap-3 mt-4">
            <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-xl">
              🎉
            </div>

            <div>
              <p className="text-xs text-gray-400">
                マッチング状況
              </p>

              <h1 className="text-xl font-bold">
                マッチング一覧
              </h1>
            </div>
          </div>
        </header>

        <div className="p-4 pb-8">
          {matches.length === 0 ? (
            <div className="bg-white rounded-3xl p-7 text-center shadow-sm border border-gray-100">
              <div className="w-16 h-16 rounded-3xl bg-gray-50 flex items-center justify-center text-3xl mx-auto">
                🎵
              </div>

              <h2 className="font-bold text-gray-800 mt-4">
                まだマッチングはありません
              </h2>

              <p className="text-sm text-gray-500 mt-2 leading-6">
                案件に応募して、施設とのマッチングを目指しましょう。
              </p>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/performer/requests"
                  )
                }
                className="w-full mt-5 bg-black text-white rounded-2xl py-4 font-bold"
              >
                📋 案件を探す
              </button>
            </div>
          ) : (
            <>
              {/* 演奏予定 */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs text-blue-600 font-bold">
                      UPCOMING
                    </p>

                    <h2 className="text-lg font-bold text-gray-900 mt-0.5">
                      🎵 演奏予定
                    </h2>
                  </div>

                  <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-3 py-1 font-bold">
                    {scheduledMatches.length}件
                  </span>
                </div>

                {scheduledMatches.length ===
                0 ? (
                  <div className="bg-white rounded-2xl p-5 border border-gray-100 text-center">
                    <p className="text-sm text-gray-400">
                      現在、演奏予定はありません。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {scheduledMatches.map(
                      renderMatchCard
                    )}
                  </div>
                )}
              </section>

              {/* 演奏履歴 */}
              <section className="mt-8">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs text-gray-400 font-bold">
                      HISTORY
                    </p>

                    <h2 className="text-lg font-bold text-gray-900 mt-0.5">
                      📋 演奏終了・キャンセル
                    </h2>
                  </div>

                  <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-3 py-1 font-bold">
                    {historyMatches.length}件
                  </span>
                </div>

                {historyMatches.length ===
                0 ? (
                  <div className="bg-white rounded-2xl p-5 border border-gray-100 text-center">
                    <p className="text-sm text-gray-400">
                      演奏終了・キャンセルの履歴はありません。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {historyMatches.map(
                      renderMatchCard
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          <button
            type="button"
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="w-full mt-7 bg-white border border-gray-200 rounded-2xl py-4 font-bold text-gray-700"
          >
            ← ホームへ戻る
          </button>
        </div>
      </div>
    </main>
  );
}