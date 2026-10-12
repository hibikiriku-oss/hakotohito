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
  performance_status: string;
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

  function formatDate(date: string) {
    const [year, month, day] =
      date.split("-");

    return (
      year +
      "/" +
      month +
      "/" +
      day
    );
  }

  function formatTime(time: string) {
    return time.slice(0, 5);
  }

  function getPerformanceStatus(
    match: Match
  ) {
    if (
      match.performance_status ===
      "completed"
    ) {
      return {
        label: "演奏完了",
        className:
          "bg-blue-50 text-blue-700 border-blue-200",
      };
    }

    if (
      match.performance_status ===
      "cancelled" ||
      match.status === "cancelled"
    ) {
      return {
        label: "キャンセル済み",
        className:
          "bg-red-50 text-red-700 border-red-200",
      };
    }

    return {
      label: "演奏予定",
      className:
        "bg-green-50 text-green-700 border-green-200",
    };
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">

          <header>
            <p className="text-sm font-semibold text-gray-500">
              演奏マッチング
            </p>

            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              🎉 マッチング
            </h1>
          </header>

          <div className="mt-8 rounded-2xl bg-white border border-gray-200 p-8 text-center shadow-sm">
            <div className="text-3xl">
              🎉
            </div>

            <p className="mt-3 text-sm text-gray-500">
              マッチング情報を読み込んでいます...
            </p>
          </div>

        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">

          <header>
            <p className="text-sm font-semibold text-gray-500">
              演奏マッチング
            </p>

            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              🎉 マッチング
            </h1>
          </header>

          <div className="mt-6 rounded-2xl bg-red-50 border border-red-200 p-5">
            <p className="text-sm leading-6 text-red-600">
              {error}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="w-full mt-5 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-700 shadow-sm active:bg-gray-50"
          >
            ← ホームへ戻る
          </button>

        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 py-6">

        {/* ヘッダー */}
        <header>
          <button
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="inline-flex items-center text-sm font-medium text-gray-500 active:text-gray-800"
          >
            ← ホームへ戻る
          </button>

          <div className="mt-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-500">
                演奏マッチング
              </p>

              <h1 className="mt-1 text-2xl font-bold text-gray-900">
                🎉 マッチング
              </h1>
            </div>

            <span className="shrink-0 rounded-full bg-white border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600">
              {matches.length}件
            </span>
          </div>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            マッチングした施設との演奏予定や履歴を確認できます。
          </p>
        </header>

        {/* 空状態 */}
        {matches.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-white border border-gray-200 p-6 text-center shadow-sm">

            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-50 text-3xl">
              🎵
            </div>

            <h2 className="mt-4 text-base font-bold text-gray-900">
              まだマッチングはありません
            </h2>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              気になる演奏案件に応募して、
              マッチングを目指しましょう。
            </p>

            <button
              onClick={() =>
                router.push(
                  "/performer/requests"
                )
              }
              className="w-full mt-5 rounded-2xl bg-black px-5 py-4 text-sm font-bold text-white active:bg-gray-800"
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

              const performanceStatus =
                getPerformanceStatus(match);

              return (
                <button
                  key={match.id}
                  onClick={() =>
                    router.push(
                      "/performer/matches/" +
                        match.id
                    )
                  }
                  className="w-full text-left rounded-2xl bg-white border border-gray-200 p-5 shadow-sm transition active:bg-gray-50"
                >

                  {/* ステータス */}
                  <div className="flex items-center justify-between gap-3">

                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-50">
                        🎉
                      </span>
                      マッチング成立
                    </span>

                    <span
                      className={
                        "shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold " +
                        performanceStatus.className
                      }
                    >
                      {performanceStatus.label}
                    </span>

                  </div>

                  {/* 案件タイトル */}
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-gray-400">
                      演奏案件
                    </p>

                    <h2 className="mt-1 text-lg font-bold leading-7 text-gray-900">
                      {performanceRequest.title}
                    </h2>
                  </div>

                  {/* 施設 */}
                  {facility && (
                    <div className="mt-4 rounded-xl bg-gray-50 p-4">

                      <p className="text-xs font-semibold text-gray-400">
                        演奏先
                      </p>

                      <p className="mt-1 font-bold text-gray-900">
                        🏢{" "}
                        {facility.name ||
                          "施設名未登録"}
                      </p>

                      {facility.facility_type && (
                        <p className="mt-1 text-xs text-gray-500">
                          {facility.facility_type}
                        </p>
                      )}

                    </div>
                  )}

                  {/* 演奏日時 */}
                  <div className="mt-3 grid grid-cols-2 gap-3">

                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <p className="text-xs font-medium text-gray-400">
                        演奏日
                      </p>

                      <p className="mt-1 text-sm font-bold text-gray-900">
                        📅{" "}
                        {formatDate(
                          performanceRequest.performance_date
                        )}
                      </p>
                    </div>

                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <p className="text-xs font-medium text-gray-400">
                        時間
                      </p>

                      <p className="mt-1 text-sm font-bold text-gray-900">
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

                  </div>

                  {/* 場所 */}
                  {(performanceRequest.area ||
                    facility?.address) && (
                    <div className="mt-3 rounded-xl border border-gray-100 p-4">

                      <p className="text-xs font-semibold text-gray-400">
                        演奏場所
                      </p>

                      {performanceRequest.area && (
                        <p className="mt-1 text-sm font-semibold text-gray-800">
                          📍{" "}
                          {performanceRequest.area}
                        </p>
                      )}

                      {facility?.address && (
                        <p className="mt-1 text-xs leading-5 text-gray-500">
                          {facility.address}
                        </p>
                      )}

                    </div>
                  )}

                  {/* 楽器・ジャンル */}
                  {(performanceRequest.instruments?.length >
                    0 ||
                    performanceRequest.genres?.length >
                      0) && (
                    <div className="mt-4">

                      {performanceRequest.instruments?.length >
                        0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400">
                            募集楽器
                          </p>

                          <div className="mt-2 flex flex-wrap gap-2">
                            {performanceRequest.instruments.map(
                              (instrument) => (
                                <span
                                  key={instrument}
                                  className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                                >
                                  🎸 {instrument}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      )}

                      {performanceRequest.genres?.length >
                        0 && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-gray-400">
                            ジャンル
                          </p>

                          <div className="mt-2 flex flex-wrap gap-2">
                            {performanceRequest.genres.map(
                              (genre) => (
                                <span
                                  key={genre}
                                  className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
                                >
                                  🎵 {genre}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  )}

                  {/* 報酬 */}
                  {performanceRequest.reward !==
                    null && (
                    <div className="mt-4 flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">

                      <span className="text-xs font-semibold text-gray-500">
                        謝礼
                      </span>

                      <span className="text-base font-bold text-gray-900">
                        💰{" "}
                        {performanceRequest.reward.toLocaleString()}
                        円
                      </span>

                    </div>
                  )}

                  {/* 施設について */}
                  {facility?.description && (
                    <div className="mt-4 rounded-xl border border-gray-100 p-4">

                      <p className="text-xs font-semibold text-gray-400">
                        施設について
                      </p>

                      <p className="mt-2 text-sm leading-6 text-gray-600 whitespace-pre-wrap">
                        {facility.description}
                      </p>

                    </div>
                  )}

                  {/* キャンセル */}
                  {performanceStatus.label ===
                    "キャンセル済み" && (
                    <div className="mt-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                      <p className="text-sm font-medium text-red-700">
                        このマッチングはキャンセルされています。
                      </p>
                    </div>
                  )}

                  {/* 完了 */}
                  {performanceStatus.label ===
                    "演奏完了" && (
                    <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
                      <p className="text-sm font-medium text-blue-700">
                        演奏が完了しています。
                      </p>
                    </div>
                  )}

                  {/* 詳細 */}
                  <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">

                    <span className="text-xs font-medium text-gray-400">
                      マッチング詳細
                    </span>

                    <span className="text-sm font-bold text-gray-700">
                      詳細を見る →
                    </span>

                  </div>

                </button>
              );
            })}

          </div>
        )}

        {/* 下部ホームボタン */}
        <button
          onClick={() =>
            router.push(
              "/performer/home"
            )
          }
          className="w-full mt-6 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-600 shadow-sm active:bg-gray-50"
        >
          ← ホームへ戻る
        </button>

        <p className="pb-5 pt-6 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>

      </div>
    </main>
  );
}