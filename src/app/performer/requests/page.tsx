"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Facility = {
  name: string;
  facility_type: string;
  address: string;
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

export default function PerformerRequestsPage() {
  const router = useRouter();

  const [requests, setRequests] =
    useState<PerformanceRequest[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [keyword, setKeyword] =
    useState("");

  const [areaFilter, setAreaFilter] =
    useState("");

  const [instrumentFilter, setInstrumentFilter] =
    useState("");

  const [genreFilter, setGenreFilter] =
    useState("");

  const [dateFilter, setDateFilter] =
    useState("");

  const [rewardOnly, setRewardOnly] =
    useState(false);

  useEffect(() => {
    async function fetchRequests() {
      try {
        const response = await fetch(
          "/api/performance-requests"
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "案件の取得に失敗しました"
          );
        }

        setRequests(
          data.requests || []
        );
      } catch (error) {
        console.error(
          "案件取得エラー:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "案件の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchRequests();
  }, []);

  const areas = Array.from(
    new Set(
      requests
        .map((request) => request.area)
        .filter(
          (area): area is string =>
            Boolean(area)
        )
    )
  ).sort();

  const instruments = Array.from(
    new Set(
      requests.flatMap(
        (request) =>
          request.instruments || []
      )
    )
  ).sort();

  const genres = Array.from(
    new Set(
      requests.flatMap(
        (request) =>
          request.genres || []
      )
    )
  ).sort();

  const filteredRequests =
    requests.filter((request) => {
      const normalizedKeyword =
        keyword
          .trim()
          .toLowerCase();

      if (
        normalizedKeyword &&
        !(
          request.title
            .toLowerCase()
            .includes(normalizedKeyword) ||
          (request.description || "")
            .toLowerCase()
            .includes(normalizedKeyword)
        )
      ) {
        return false;
      }

      if (
        areaFilter &&
        request.area !== areaFilter
      ) {
        return false;
      }

      if (
        instrumentFilter &&
        !(request.instruments || []).includes(
          instrumentFilter
        )
      ) {
        return false;
      }

      if (
        genreFilter &&
        !(request.genres || []).includes(
          genreFilter
        )
      ) {
        return false;
      }

      if (
        dateFilter &&
        request.performance_date !==
          dateFilter
      ) {
        return false;
      }

      if (
        rewardOnly &&
        (request.reward === null ||
          request.reward <= 0)
      ) {
        return false;
      }

      return true;
    });

  const clearFilters = () => {
    setKeyword("");
    setAreaFilter("");
    setInstrumentFilter("");
    setGenreFilter("");
    setDateFilter("");
    setRewardOnly(false);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <header className="pt-2">
            <p className="text-sm font-medium text-gray-500">
              演奏マッチング
            </p>

            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              🎵 演奏案件を探す
            </h1>

            <p className="mt-2 text-sm text-gray-500">
              あなたに合った演奏依頼を探しましょう。
            </p>
          </header>

          <div className="mt-8 rounded-2xl bg-white border border-gray-200 p-8 text-center shadow-sm">
            <div className="text-3xl">
              🎵
            </div>

            <p className="mt-3 text-sm text-gray-500">
              案件を読み込んでいます…
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
          <header className="pt-2">
            <p className="text-sm font-medium text-gray-500">
              演奏マッチング
            </p>

            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              🎵 演奏案件を探す
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
            ← 演奏者ホームへ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 py-6">

        {/* ヘッダー */}
        <header className="pt-2">
          <p className="text-sm font-medium text-gray-500">
            演奏マッチング
          </p>

          <div className="mt-1 flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                🎵 演奏案件を探す
              </h1>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                現在募集中の案件から、
                自分に合った依頼を探せます。
              </p>
            </div>

            <div className="shrink-0 rounded-full bg-white border border-gray-200 px-3 py-1.5 shadow-sm">
              <span className="text-sm font-bold text-gray-900">
                {filteredRequests.length}
              </span>

              <span className="ml-1 text-xs text-gray-500">
                件
              </span>
            </div>
          </div>
        </header>

        {/* 絞り込み */}
        <section className="mt-6 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                🔎 案件を絞り込む
              </h2>

              <p className="mt-1 text-xs text-gray-500">
                条件を指定して探しやすくできます。
              </p>
            </div>

            <button
              type="button"
              onClick={clearFilters}
              className="shrink-0 text-xs font-medium text-gray-500 underline underline-offset-2"
            >
              クリア
            </button>
          </div>

          <div className="mt-5 space-y-4">

            {/* キーワード */}
            <div>
              <label className="mb-2 block text-xs font-semibold text-gray-600">
                キーワード
              </label>

              <input
                type="text"
                value={keyword}
                onChange={(event) =>
                  setKeyword(
                    event.target.value
                  )
                }
                placeholder="案件名・説明から検索"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
              />
            </div>

            {/* 地域・楽器 */}
            <div className="grid grid-cols-2 gap-3">

              <div>
                <label className="mb-2 block text-xs font-semibold text-gray-600">
                  地域
                </label>

                <select
                  value={areaFilter}
                  onChange={(event) =>
                    setAreaFilter(
                      event.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
                >
                  <option value="">
                    すべて
                  </option>

                  {areas.map((area) => (
                    <option
                      key={area}
                      value={area}
                    >
                      {area}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold text-gray-600">
                  楽器
                </label>

                <select
                  value={instrumentFilter}
                  onChange={(event) =>
                    setInstrumentFilter(
                      event.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
                >
                  <option value="">
                    すべて
                  </option>

                  {instruments.map(
                    (instrument) => (
                      <option
                        key={instrument}
                        value={instrument}
                      >
                        {instrument}
                      </option>
                    )
                  )}
                </select>
              </div>

            </div>

            {/* ジャンル・演奏日 */}
            <div className="grid grid-cols-2 gap-3">

              <div>
                <label className="mb-2 block text-xs font-semibold text-gray-600">
                  ジャンル
                </label>

                <select
                  value={genreFilter}
                  onChange={(event) =>
                    setGenreFilter(
                      event.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
                >
                  <option value="">
                    すべて
                  </option>

                  {genres.map((genre) => (
                    <option
                      key={genre}
                      value={genre}
                    >
                      {genre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold text-gray-600">
                  演奏日
                </label>

                <input
                  type="date"
                  value={dateFilter}
                  onChange={(event) =>
                    setDateFilter(
                      event.target.value
                    )
                  }
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white focus:ring-2 focus:ring-gray-100"
                />
              </div>

            </div>

            {/* 謝礼あり */}
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <input
                type="checkbox"
                checked={rewardOnly}
                onChange={(event) =>
                  setRewardOnly(
                    event.target.checked
                  )
                }
                className="h-5 w-5 rounded border-gray-300"
              />

              <div>
                <p className="text-sm font-semibold text-gray-800">
                  💰 謝礼ありの案件のみ
                </p>

                <p className="mt-0.5 text-xs text-gray-500">
                  謝礼が設定されている案件を表示
                </p>
              </div>
            </label>

          </div>
        </section>

        {/* 検索結果 */}
        <section className="mt-7">

          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                募集中の案件
              </h2>

              <p className="mt-0.5 text-xs text-gray-500">
                {filteredRequests.length}件の案件
              </p>
            </div>
          </div>

          {filteredRequests.length === 0 ? (
            <div className="rounded-2xl bg-white border border-gray-200 p-7 text-center shadow-sm">
              <div className="text-3xl">
                🔍
              </div>

              <p className="mt-3 text-sm font-medium text-gray-700">
                条件に一致する案件がありません。
              </p>

              <p className="mt-1 text-xs leading-5 text-gray-400">
                検索条件を変更して、もう一度お試しください。
              </p>

              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 active:bg-gray-200"
              >
                条件をクリアしてすべて表示
              </button>
            </div>
          ) : (
            <div className="space-y-3">

              {filteredRequests.map(
                (request) => (
                  <button
                    key={request.id}
                    onClick={() =>
                      router.push(
                        `/performer/requests/${request.id}`
                      )
                    }
                    className="group w-full rounded-2xl bg-white border border-gray-200 p-5 text-left shadow-sm transition active:bg-gray-50"
                  >
                    {/* タイトル */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold leading-7 text-gray-900">
                          {request.title}
                        </h3>

                        {request.facilities && (
                          <p className="mt-1.5 text-sm text-gray-500">
                            🏢{" "}
                            {request.facilities.name}
                          </p>
                        )}
                      </div>

                      <span className="shrink-0 text-lg text-gray-300 transition group-active:text-gray-500">
                        →
                      </span>
                    </div>

                    {/* 日時・場所 */}
                    <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        <span>📅</span>

                        <span>
                          {request.performance_date}
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-center gap-2 text-sm text-gray-600">
                        <span>🕐</span>

                        <span>
                          {request.start_time.slice(
                            0,
                            5
                          )}
                          {" ～ "}
                          {request.end_time.slice(
                            0,
                            5
                          )}
                        </span>
                      </div>

                      {request.area && (
                        <div className="mt-1.5 flex items-center gap-2 text-sm text-gray-600">
                          <span>📍</span>

                          <span>
                            {request.area}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 楽器・ジャンル */}
                    {(request.instruments?.length >
                      0 ||
                      request.genres?.length >
                        0) && (
                      <div className="mt-4 space-y-2">

                        {request.instruments?.length >
                          0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {request.instruments.map(
                              (instrument) => (
                                <span
                                  key={instrument}
                                  className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600"
                                >
                                  🎹 {instrument}
                                </span>
                              )
                            )}
                          </div>
                        )}

                        {request.genres?.length >
                          0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {request.genres.map(
                              (genre) => (
                                <span
                                  key={genre}
                                  className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                                >
                                  🎵 {genre}
                                </span>
                              )
                            )}
                          </div>
                        )}

                      </div>
                    )}

                    {/* 謝礼 */}
                    {request.reward !== null && (
                      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                        <span className="text-xs text-gray-500">
                          謝礼
                        </span>

                        <span className="font-bold text-gray-900">
                          💰{" "}
                          {request.reward.toLocaleString()}
                          円
                        </span>
                      </div>
                    )}

                    {/* 詳細 */}
                    <div className="mt-4 flex items-center justify-end border-t border-gray-100 pt-3">
                      <span className="text-sm font-semibold text-gray-500">
                        詳細を見る →
                      </span>
                    </div>
                  </button>
                )
              )}

            </div>
          )}
        </section>

        {/* ホームへ戻る */}
        <button
          onClick={() =>
            router.push(
              "/performer/home"
            )
          }
          className="mt-7 w-full rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-600 shadow-sm active:bg-gray-50"
        >
          ← 演奏者ホームへ戻る
        </button>

        <p className="pb-4 pt-6 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>

      </div>
    </main>
  );
}