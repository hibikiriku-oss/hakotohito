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
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            🎵 演奏案件を探す
          </h1>

          <p className="mt-8 text-center text-gray-500">
            案件を読み込んでいます…
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
            🎵 演奏案件を探す
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
            ← 演奏者ホームへ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold">
            🎵 演奏案件を探す
          </h1>

          <p className="text-sm text-gray-500 mt-1">
            現在募集中の案件
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 shadow-sm border mb-6">
          <h2 className="text-lg font-bold mb-4">
            🔎 案件を絞り込む
          </h2>

          <div className="space-y-4">

            <div>
              <label className="block text-sm font-medium mb-2">
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
                className="w-full border rounded-xl p-3"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                地域
              </label>

              <select
                value={areaFilter}
                onChange={(event) =>
                  setAreaFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-xl p-3 bg-white"
              >
                <option value="">
                  すべての地域
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
              <label className="block text-sm font-medium mb-2">
                楽器
              </label>

              <select
                value={instrumentFilter}
                onChange={(event) =>
                  setInstrumentFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-xl p-3 bg-white"
              >
                <option value="">
                  すべての楽器
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

            <div>
              <label className="block text-sm font-medium mb-2">
                ジャンル
              </label>

              <select
                value={genreFilter}
                onChange={(event) =>
                  setGenreFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-xl p-3 bg-white"
              >
                <option value="">
                  すべてのジャンル
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
              <label className="block text-sm font-medium mb-2">
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
                className="w-full border rounded-xl p-3"
              />
            </div>

            <label className="flex items-center gap-3 p-3 border rounded-xl">
              <input
                type="checkbox"
                checked={rewardOnly}
                onChange={(event) =>
                  setRewardOnly(
                    event.target.checked
                  )
                }
                className="w-5 h-5"
              />

              <span className="text-sm font-medium">
                💰 謝礼ありの案件のみ
              </span>
            </label>

            <button
              type="button"
              onClick={clearFilters}
              className="w-full border rounded-xl p-3 text-gray-700"
            >
              条件をクリア
            </button>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600">
            {filteredRequests.length}
            件の案件が見つかりました
          </p>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="text-gray-500">
              条件に一致する案件がありません。
            </p>

            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 text-sm text-blue-600"
            >
              条件をクリアしてすべて表示
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRequests.map(
              (request) => (
                <button
                  key={request.id}
                  onClick={() =>
                    router.push(
                      `/performer/requests/${request.id}`
                    )
                  }
                  className="w-full text-left bg-white rounded-2xl p-5 shadow-sm border"
                >
                  <h2 className="text-lg font-bold">
                    {request.title}
                  </h2>

                  {request.facilities && (
                    <p className="mt-2 text-sm text-gray-600">
                      🏢{" "}
                      {request.facilities.name}
                    </p>
                  )}

                  <p className="mt-3 text-sm">
                    📅{" "}
                    {request.performance_date}
                  </p>

                  <p className="text-sm">
                    🕐{" "}
                    {request.start_time.slice(
                      0,
                      5
                    )}
                    {" ～ "}
                    {request.end_time.slice(
                      0,
                      5
                    )}
                  </p>

                  {request.area && (
                    <p className="text-sm">
                      📍 {request.area}
                    </p>
                  )}

                  {request.instruments?.length >
                    0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {request.instruments.map(
                        (instrument) => (
                          <span
                            key={instrument}
                            className="text-xs bg-gray-100 rounded-full px-3 py-1"
                          >
                            🎹 {instrument}
                          </span>
                        )
                      )}
                    </div>
                  )}

                  {request.genres?.length >
                    0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {request.genres.map(
                        (genre) => (
                          <span
                            key={genre}
                            className="text-xs bg-blue-50 rounded-full px-3 py-1"
                          >
                            🎵 {genre}
                          </span>
                        )
                      )}
                    </div>
                  )}

                  {request.reward !== null && (
                    <p className="mt-3 font-bold">
                      💰 謝礼{" "}
                      {request.reward.toLocaleString()}
                      円
                    </p>
                  )}

                  <p className="mt-4 text-right text-sm text-gray-400">
                    詳細を見る →
                  </p>
                </button>
              )
            )}
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
          ← 演奏者ホームへ戻る
        </button>

      </div>
    </main>
  );
}