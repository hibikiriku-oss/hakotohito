
"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
import { useEffect, useMemo, useState } from "react";
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
  band_id: string | null;
  band: {
    id: string;
    name: string;
    description: string | null;
  } | null;
  isBandLeader: boolean;
  matched_at: string;
  status: string;
  performance_status: string;
  completed_at: string | null;
  performance_requests: PerformanceRequest | null;
};

type StatusFilter = "scheduled" | "completed" | "cancelled";
type SortOption =
  | "date_asc"
  | "date_desc"
  | "matched_desc"
  | "matched_asc";

const PAGE_SIZE = 10;

const STATUS_TABS: {
  value: StatusFilter;
  label: string;
  icon: string;
}[] = [
  { value: "scheduled", label: "演奏予定", icon: "📅" },
  { value: "completed", label: "演奏完了", icon: "✅" },
  { value: "cancelled", label: "キャンセル済み", icon: "⚠️" },
];

function getStatus(match: Match): StatusFilter {
  if (
    match.status === "cancelled" ||
    match.performance_status === "cancelled"
  ) {
    return "cancelled";
  }

  if (match.performance_status === "completed") {
    return "completed";
  }

  return "scheduled";
}

function getDateTime(match: Match) {
  const request = match.performance_requests;

  return request
    ? `${request.performance_date}T${request.start_time}`
    : "";
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${year}/${month}/${day}`;
}

function formatTime(time: string) {
  return time.slice(0, 5);
}

export default function PerformerMatchesPage() {
  const router = useRouter();

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("scheduled");
  const [sortBy, setSortBy] = useState<SortOption>("date_asc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("NEXT_PUBLIC_LIFF_IDが設定されていません");
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();

        const response = await fetch("/api/performer/matches", {
          headers: {
            Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
          },
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "マッチング情報の取得に失敗しました"
          );
        }

        if (!cancelled) {
          setMatches(Array.isArray(data.matches) ? data.matches : []);
        }
      } catch (err) {
        console.error("マッチング取得エラー:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "マッチング情報の取得に失敗しました"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  // 検索はステータスに関係なく行い、タブごとの件数にも利用する
  const searchableMatches = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();

    return matches.filter((match) => {
      const request = match.performance_requests;

      if (!request) {
        return false;
      }

      const facility = request.facilities;

      return (
        !keyword ||
        (request.title || "").toLocaleLowerCase().includes(keyword) ||
        (facility?.name || "").toLocaleLowerCase().includes(keyword) ||
        (match.band?.name || "").toLocaleLowerCase().includes(keyword)
      );
    });
  }, [matches, search]);

  const statusCounts = useMemo(() => {
    return {
      scheduled: searchableMatches.filter(
        (match) => getStatus(match) === "scheduled"
      ).length,
      completed: searchableMatches.filter(
        (match) => getStatus(match) === "completed"
      ).length,
      cancelled: searchableMatches.filter(
        (match) => getStatus(match) === "cancelled"
      ).length,
    };
  }, [searchableMatches]);

  const filteredMatches = useMemo(() => {
    return searchableMatches
      .filter((match) => getStatus(match) === statusFilter)
      .sort((a, b) => {
        if (sortBy === "matched_desc") {
          return (
            new Date(b.matched_at).getTime() -
            new Date(a.matched_at).getTime()
          );
        }

        if (sortBy === "matched_asc") {
          return (
            new Date(a.matched_at).getTime() -
            new Date(b.matched_at).getTime()
          );
        }

        const dateA = getDateTime(a);
        const dateB = getDateTime(b);

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return sortBy === "date_asc"
          ? dateA.localeCompare(dateB)
          : dateB.localeCompare(dateA);
      });
  }, [searchableMatches, statusFilter, sortBy]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredMatches.length / PAGE_SIZE)
  );

  const displayedMatches = filteredMatches.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, sortBy]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function handleStatusChange(status: StatusFilter) {
    setStatusFilter(status);
    setPage(1);

    // 予定は開催日が近い順、完了・キャンセル履歴は新しい日付から
    setSortBy(status === "scheduled" ? "date_asc" : "date_desc");
  }

  function handleReset() {
    setSearch("");
    setStatusFilter("scheduled");
    setSortBy("date_asc");
    setPage(1);
  }

  function renderMatchCard(match: Match) {
    const request = match.performance_requests;

    if (!request) {
      return null;
    }

    const facility = request.facilities;
    const status = getStatus(match);

    const badgeClass =
      status === "cancelled"
        ? "bg-red-50 text-red-600"
        : status === "completed"
          ? "bg-gray-100 text-gray-600"
          : "bg-blue-50 text-blue-700";

    const statusLabel =
      status === "cancelled"
        ? "キャンセル済み"
        : status === "completed"
          ? "演奏完了"
          : "演奏予定";

    return (
      <button
        key={match.id}
        type="button"
        onClick={() => router.push(`/performer/matches/${match.id}`)}
        className="w-full rounded-2xl border border-gray-100 bg-white p-5 text-left shadow-sm transition active:scale-[0.99]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-400">
              マッチング成立
            </p>

            <h2 className="mt-1 text-xl font-bold text-gray-900">
              {request.title}
            </h2>

            {match.band && (
              <div className="mt-2 rounded-lg bg-purple-50 px-3 py-2">
                <p className="text-xs font-bold text-purple-700">
                  🎸 バンド応募
                </p>

                <p className="mt-1 font-bold text-purple-900">
                  {match.band.name}
                </p>

                <p className="mt-1 text-xs text-purple-700">
                  {match.isBandLeader
                    ? "あなたはこのバンドのリーダーです"
                    : "バンドメンバーとして参加"}
                </p>
              </div>
            )}
          </div>

          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${badgeClass}`}
          >
            {statusLabel}
          </span>
        </div>

        {facility && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-400">施設</p>

            <div className="mt-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-lg">
                🏢
              </div>

              <div className="min-w-0">
                <p className="truncate font-bold text-gray-800">
                  {facility.name || "施設名未設定"}
                </p>

                {facility.facility_type && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {facility.facility_type}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-xl bg-gray-50 p-4">
          <p className="text-xs font-medium text-gray-400">
            演奏日時
          </p>

          <p className="mt-1 font-bold text-gray-800">
            📅 {formatDate(request.performance_date)}
          </p>

          <p className="mt-1 text-sm text-gray-600">
            🕐 {formatTime(request.start_time)} ～{" "}
            {formatTime(request.end_time)}
          </p>
        </div>

        {(request.area || facility?.address) && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-400">場所</p>

            {request.area && (
              <p className="mt-1 text-sm text-gray-700">
                📍 {request.area}
              </p>
            )}

            {facility?.address && (
              <p className="mt-1 text-xs text-gray-500">
                {facility.address}
              </p>
            )}
          </div>
        )}

        {request.reward !== null && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-400">報酬</p>

            <p className="mt-1 font-bold text-gray-800">
              💰 {request.reward.toLocaleString()}円
            </p>
          </div>
        )}

        {status === "cancelled" && (
          <div className="mt-4 rounded-xl bg-red-50 p-3">
            <p className="text-sm text-red-700">
              このマッチングはキャンセルされています。
            </p>
          </div>
        )}

        {status === "completed" && (
          <div className="mt-4 rounded-xl bg-gray-50 p-3">
            <p className="text-sm text-gray-600">
              この演奏は終了しています。
            </p>

            {match.completed_at && (
              <p className="mt-1 text-xs text-gray-400">
                完了：
                {new Date(match.completed_at).toLocaleString("ja-JP")}
              </p>
            )}
          </div>
        )}

        {status === "scheduled" && (
          <div className="mt-4 rounded-xl bg-blue-50 p-3">
            <p className="text-sm font-medium text-blue-700">
              📅 演奏予定です
            </p>
          </div>
        )}

        <div className="mt-4 border-t border-gray-100 pt-3 text-right">
          <span className="text-sm font-bold text-gray-500">
            詳細を見る →
          </span>
        </div>
      </button>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-md">
          <h1 className="text-2xl font-bold">🎉 マッチング一覧</h1>

          <p className="mt-8 text-center text-gray-500">
            マッチング情報を読み込んでいます...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-md">
          <h1 className="text-2xl font-bold">🎉 マッチング一覧</h1>

          <div className="mt-6 rounded-xl bg-red-50 p-4">
            <p className="text-red-600">{error}</p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="mt-6 w-full rounded-xl border bg-white p-4"
          >
            ← ホームへ戻る
          </button>
        </div>
      </main>
    );
  }

  const activeTab = STATUS_TABS.find(
    (tab) => tab.value === statusFilter
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto min-h-screen max-w-md">
        <header className="border-b bg-white px-5 pb-5 pt-5">
          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="py-2 text-sm text-gray-500"
          >
            ← ホームへ戻る
          </button>

          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            📅 マッチング
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            演奏予定や、これまでの出演履歴を確認できます。
          </p>
        </header>

        <div className="space-y-4 p-4 pb-8">
          {/* ステータスタブ */}
          <section className="rounded-2xl border border-gray-100 bg-white p-2 shadow-sm">
            <div
              className="grid grid-cols-3 gap-1"
              role="tablist"
              aria-label="マッチングのステータス"
            >
              {STATUS_TABS.map((tab) => {
                const selected = statusFilter === tab.value;
                const count = statusCounts[tab.value];

                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => handleStatusChange(tab.value)}
                    className={`min-w-0 rounded-xl px-1 py-3 text-center transition ${
                      selected
                        ? "bg-black text-white shadow-sm"
                        : "bg-white text-gray-600 active:bg-gray-100"
                    }`}
                  >
                    <span className="block text-lg">
                      {tab.icon}
                    </span>

                    <span className="mt-1 block text-xs font-bold leading-4">
                      {tab.label}
                    </span>

                    <span
                      className={`mt-1 inline-flex min-w-6 justify-center rounded-full px-1.5 py-0.5 text-xs font-bold ${
                        selected
                          ? "bg-white/20 text-white"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 検索・並び替え */}
          <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div>
              <label
                htmlFor="match-search"
                className="mb-2 block text-sm font-bold text-gray-700"
              >
                施設名・案件名で検索
              </label>

              <input
                id="match-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="施設名や案件名を入力"
                className="w-full rounded-xl border px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="match-sort"
                className="mb-2 block text-sm font-bold text-gray-700"
              >
                並び順
              </label>

              <select
                id="match-sort"
                value={sortBy}
                onChange={(event) =>
                  setSortBy(event.target.value as SortOption)
                }
                className="w-full rounded-xl border bg-white px-3 py-3 text-sm"
              >
                <option value="date_asc">
                  演奏日時が近い順
                </option>
                <option value="date_desc">
                  演奏日時が遠い順
                </option>
                <option value="matched_desc">
                  マッチング成立日時が新しい順
                </option>
                <option value="matched_asc">
                  マッチング成立日時が古い順
                </option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-3 text-sm text-gray-500">
              <span>
                {activeTab?.label}：{filteredMatches.length}件
              </span>

              <button
                type="button"
                onClick={handleReset}
                className="shrink-0 font-bold underline"
              >
                条件をリセット
              </button>
            </div>
          </section>

          {/* 一覧 */}
          {matches.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-50 text-3xl">
                🎵
              </div>

              <h2 className="mt-4 font-bold text-gray-800">
                現在のマッチングはありません
              </h2>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                案件に応募して、施設とのマッチングを目指しましょう。
              </p>

              <button
                type="button"
                onClick={() => router.push("/performer/requests")}
                className="mt-5 w-full rounded-2xl bg-black py-4 font-bold text-white"
              >
                📋 演奏案件を探す
              </button>
            </div>
          ) : searchableMatches.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
              <p className="font-bold text-gray-700">
                検索条件に一致するマッチングはありません
              </p>

              <p className="mt-2 text-sm text-gray-500">
                施設名や案件名を変えて検索してください。
              </p>

              <button
                type="button"
                onClick={() => setSearch("")}
                className="mt-4 rounded-xl border px-4 py-2 text-sm font-bold text-gray-600"
              >
                検索をクリア
              </button>
            </div>
          ) : filteredMatches.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
              <div className="text-3xl">
                {statusFilter === "scheduled"
                  ? "📅"
                  : statusFilter === "completed"
                    ? "✅"
                    : "⚠️"}
              </div>

              <h2 className="mt-3 font-bold text-gray-800">
                {activeTab?.label}はありません
              </h2>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                {statusFilter === "scheduled"
                  ? "現在、演奏予定のマッチングはありません。"
                  : statusFilter === "completed"
                    ? "完了した演奏はまだありません。"
                    : "キャンセル済みのマッチングはありません。"}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {displayedMatches.map(renderMatchCard)}
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-4">
                <p className="mb-3 text-center text-sm text-gray-500">
                  {filteredMatches.length}件中{" "}
                  {(page - 1) * PAGE_SIZE + 1}～
                  {Math.min(
                    page * PAGE_SIZE,
                    filteredMatches.length
                  )}
                  件を表示
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
                  >
                    ← 前へ
                  </button>

                  {Array.from(
                    { length: totalPages },
                    (_, index) => index + 1
                  ).map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      aria-current={
                        pageNumber === page ? "page" : undefined
                      }
                      onClick={() => setPage(pageNumber)}
                      className={`min-w-9 rounded-lg border px-3 py-2 text-sm ${
                        pageNumber === page
                          ? "border-black bg-black text-white"
                          : "bg-white"
                      }`}
                    >
                      {pageNumber}
                    </button>
                  ))}

                  <button
                    type="button"
                    disabled={page === totalPages}
                    onClick={() =>
                      setPage((current) =>
                        Math.min(totalPages, current + 1)
                      )
                    }
                    className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
                  >
                    次へ →
                  </button>
                </div>
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="w-full rounded-2xl border border-gray-200 bg-white py-4 font-bold text-gray-700"
          >
            ← ホームへ戻る
          </button>
        </div>
      </div>
    </main>
  );
}
