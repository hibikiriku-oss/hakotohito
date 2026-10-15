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
  created_at: string;
  facilities: Facility | null;
};

type FilterOptions = {
  areas: string[];
  instruments: string[];
  genres: string[];
};

const PAGE_SIZE = 10;

const EMPTY_OPTIONS: FilterOptions = {
  areas: [],
  instruments: [],
  genres: [],
};

export default function PerformerRequestsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<PerformanceRequest[]>([]);
  const [filterOptions, setFilterOptions] =
    useState<FilterOptions>(EMPTY_OPTIONS);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [keyword, setKeyword] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [instrumentFilter, setInstrumentFilter] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [rewardOnly, setRewardOnly] = useState(false);

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("newest");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // 全案件から絞り込み候補を取得します。
  useEffect(() => {
    let cancelled = false;

    async function fetchFilterOptions() {
      try {
        const response = await fetch(
          "/api/performance-requests/options"
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "絞り込み候補の取得に失敗しました"
          );
        }

        if (cancelled) return;

        setFilterOptions({
          areas: Array.isArray(data.areas) ? data.areas : [],
          instruments: Array.isArray(data.instruments)
            ? data.instruments
            : [],
          genres: Array.isArray(data.genres) ? data.genres : [],
        });
      } catch (error) {
        if (!cancelled) {
          console.error("絞り込み候補取得エラー:", error);
        }
      }
    }

    fetchFilterOptions();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // ページ単位で案件を取得します。
  useEffect(() => {
    let cancelled = false;

    async function fetchRequests() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
          sort,
          keyword: keyword.trim(),
          area: areaFilter,
          instrument: instrumentFilter,
          genre: genreFilter,
          date: dateFilter,
          rewardOnly: String(rewardOnly),
        });

        const response = await fetch(
          `/api/performance-requests?${params.toString()}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "案件の取得に失敗しました"
          );
        }

        if (cancelled) return;

        setRequests(
          Array.isArray(data.requests) ? data.requests : []
        );
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 0);
      } catch (error) {
        if (cancelled) return;

        console.error("案件取得エラー:", error);

        setError(
          error instanceof Error
            ? error.message
            : "案件の取得に失敗しました"
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchRequests();

    return () => {
      cancelled = true;
    };
  }, [
    page,
    sort,
    keyword,
    areaFilter,
    instrumentFilter,
    genreFilter,
    dateFilter,
    rewardOnly,
    reloadKey,
  ]);

  // 候補APIに問題があった場合も、表示中の案件にある候補は使えます。
  const areas = Array.from(
    new Set([
      ...filterOptions.areas,
      ...requests
        .map((request) => request.area)
        .filter((value): value is string => Boolean(value)),
    ])
  ).sort((a, b) => a.localeCompare(b, "ja"));

  const instruments = Array.from(
    new Set([
      ...filterOptions.instruments,
      ...requests.flatMap((request) => request.instruments || []),
    ])
  ).sort((a, b) => a.localeCompare(b, "ja"));

  const genres = Array.from(
    new Set([
      ...filterOptions.genres,
      ...requests.flatMap((request) => request.genres || []),
    ])
  ).sort((a, b) => a.localeCompare(b, "ja"));

  const clearFilters = () => {
    setKeyword("");
    setAreaFilter("");
    setInstrumentFilter("");
    setGenreFilter("");
    setDateFilter("");
    setRewardOnly(false);
    setPage(1);
  };

  const updateFilter = (callback: () => void) => {
    callback();
    setPage(1);
  };

  const goToPage = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) return;

    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const retry = () => {
    setPage(1);
    setReloadKey((current) => current + 1);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto min-h-screen max-w-md px-4 py-5">
          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="py-2 text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            🎵 演奏案件を探す
          </h1>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="text-3xl">🎵</div>
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
        <div className="mx-auto min-h-screen max-w-md px-4 py-5">
          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="py-2 text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            🎵 演奏案件を探す
          </h1>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm text-red-600">{error}</p>
          </div>

          <button
            type="button"
            onClick={retry}
            className="mt-4 w-full rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm font-semibold text-gray-700"
          >
            再読み込み
          </button>
        </div>
      </main>
    );
  }

  const firstItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, total);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto min-h-screen max-w-md px-4 py-5">
        {/* ヘッダー */}
        <header>
          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="py-2 text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <div className="mt-4 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                🎵 演奏案件を探す
              </h1>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                自分に合った演奏依頼を探しましょう。
              </p>
            </div>

            <div className="shrink-0 rounded-full border border-gray-200 bg-white px-3 py-1.5">
              <span className="font-bold text-gray-900">{total}</span>
              <span className="ml-1 text-xs text-gray-500">件</span>
            </div>
          </div>
        </header>

        {/* 絞り込み */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                🔎 案件を絞り込む
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                条件を指定して検索できます。
              </p>
            </div>

            <button
              type="button"
              onClick={clearFilters}
              className="shrink-0 text-xs text-gray-500 underline underline-offset-2"
            >
              クリア
            </button>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold text-gray-600">
                キーワード
              </label>
              <input
                type="text"
                value={keyword}
                onChange={(event) =>
                  updateFilter(() => setKeyword(event.target.value))
                }
                placeholder="案件名・説明から検索"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:border-gray-400 focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-xs font-semibold text-gray-600">
                  地域
                </label>
                <select
                  value={areaFilter}
                  onChange={(event) =>
                    updateFilter(() => setAreaFilter(event.target.value))
                  }
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm"
                >
                  <option value="">すべて</option>
                  {areas.map((area) => (
                    <option key={area} value={area}>
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
                    updateFilter(() =>
                      setInstrumentFilter(event.target.value)
                    )
                  }
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm"
                >
                  <option value="">すべて</option>
                  {instruments.map((instrument) => (
                    <option key={instrument} value={instrument}>
                      {instrument}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-xs font-semibold text-gray-600">
                  ジャンル
                </label>
                <select
                  value={genreFilter}
                  onChange={(event) =>
                    updateFilter(() => setGenreFilter(event.target.value))
                  }
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm"
                >
                  <option value="">すべて</option>
                  {genres.map((genre) => (
                    <option key={genre} value={genre}>
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
                    updateFilter(() => setDateFilter(event.target.value))
                  }
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <input
                type="checkbox"
                checked={rewardOnly}
                onChange={(event) =>
                  updateFilter(() => setRewardOnly(event.target.checked))
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

        {/* 案件一覧 */}
        <section className="mt-7">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                募集中の案件
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                {total === 0
                  ? "0件の案件"
                  : `${firstItem}〜${lastItem}件 / 全${total}件`}
              </p>
            </div>

            <div className="shrink-0">
              <label
                htmlFor="request-sort"
                className="mb-1 block text-xs text-gray-500"
              >
                並び替え
              </label>
              <select
                id="request-sort"
                value={sort}
                onChange={(event) =>
                  updateFilter(() => setSort(event.target.value))
                }
                className="max-w-[165px] rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
              >
                <option value="newest">新着順</option>
                <option value="date">開催日が近い順</option>
              </select>
            </div>
          </div>

          {requests.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-7 text-center shadow-sm">
              <div className="text-3xl">🔍</div>
              <p className="mt-3 text-sm font-medium text-gray-700">
                条件に一致する案件がありません。
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-400">
                検索条件を変更して、もう一度お試しください。
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700"
              >
                条件をクリア
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() =>
                    router.push(`/performer/requests/${request.id}`)
                  }
                  className="group w-full rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm active:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold leading-7 text-gray-900">
                        {request.title}
                      </h3>
                      {request.facilities && (
                        <p className="mt-1.5 text-sm text-gray-500">
                          🏢 {request.facilities.name}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-lg text-gray-300">→</span>
                  </div>

                  <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                      <span>📅</span>
                      <span>{request.performance_date}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-sm text-gray-600">
                      <span>🕐</span>
                      <span>
                        {request.start_time.slice(0, 5)}
                        {" ～ "}
                        {request.end_time.slice(0, 5)}
                      </span>
                    </div>
                    {request.area && (
                      <div className="mt-1.5 flex items-center gap-2 text-sm text-gray-600">
                        <span>📍</span>
                        <span>{request.area}</span>
                      </div>
                    )}
                  </div>

                  {(request.instruments || []).length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {request.instruments.map((instrument) => (
                        <span
                          key={instrument}
                          className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600"
                        >
                          🎹 {instrument}
                        </span>
                      ))}
                    </div>
                  )}

                  {(request.genres || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {request.genres.map((genre) => (
                        <span
                          key={genre}
                          className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                        >
                          🎵 {genre}
                        </span>
                      ))}
                    </div>
                  )}

                  {request.reward !== null && (
                    <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                      <span className="text-xs text-gray-500">謝礼</span>
                      <span className="font-bold text-gray-900">
                        💰 {request.reward.toLocaleString()}円
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-end border-t border-gray-100 pt-3">
                    <span className="text-sm font-semibold text-gray-500">
                      詳細を見る →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ページ切り替え */}
          {totalPages > 0 && (
            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← 前へ
              </button>

              <span className="text-center text-sm text-gray-600">
                {page} / {totalPages} ページ
              </span>

              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                次へ →
              </button>
            </div>
          )}
        </section>

        <button
          type="button"
          onClick={() => router.push("/performer/home")}
          className="mt-7 w-full rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm font-semibold text-gray-600 shadow-sm"
        >
          ← ホームへ戻る
        </button>

        <p className="pb-4 pt-6 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>
      </div>
    </main>
  );
}