"use client";

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
  matched_at: string;
  status: string;
  performance_status: string;
  completed_at: string | null;
  performance_requests: PerformanceRequest | null;
};

type StatusFilter = "all" | "scheduled" | "completed" | "cancelled";
type SortOption = "date_asc" | "date_desc" | "matched_desc" | "matched_asc";

const PAGE_SIZE = 10;

export default function PerformerMatchesPage() {
  const router = useRouter();

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("date_asc");
  const [page, setPage] = useState(1);

  useEffect(() => {
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
          headers: { "x-line-user-id": profile.userId },
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "マッチング情報の取得に失敗しました"
          );
        }

        setMatches(data.matches || []);
      } catch (error) {
        console.error("マッチング取得エラー:", error);
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

  function formatDate(date: string) {
    const [year, month, day] = date.split("-");
    return `${year}/${month}/${day}`;
  }

  function formatTime(time: string) {
    return time.slice(0, 5);
  }

  function getDateTime(match: Match) {
    const request = match.performance_requests;
    return request
      ? `${request.performance_date}T${request.start_time}`
      : "";
  }

  const filteredMatches = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();

    return matches
      .filter((match) => {
        const request = match.performance_requests;
        if (!request) return false;

        const facility = request.facilities;
        const matchesKeyword =
          !keyword ||
          (request.title || "").toLocaleLowerCase().includes(keyword) ||
          (facility?.name || "").toLocaleLowerCase().includes(keyword);

        const matchesStatus =
          statusFilter === "all" || getStatus(match) === statusFilter;

        return matchesKeyword && matchesStatus;
      })
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
  }, [matches, search, statusFilter, sortBy]);

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
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function renderMatchCard(match: Match) {
    const request = match.performance_requests;
    if (!request) return null;

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
          ? "演奏終了"
          : "演奏予定";

    return (
      <button
        key={match.id}
        type="button"
        onClick={() => router.push(`/performer/matches/${match.id}`)}
        className="w-full text-left bg-white rounded-2xl p-5 shadow-sm border border-gray-100 active:scale-[0.99] transition"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-400 font-medium">
              マッチング成立
            </p>
            <h2 className="text-xl font-bold text-gray-900 mt-1">
              {request.title}
            </h2>
          </div>
          <span
            className={`shrink-0 text-xs rounded-full px-3 py-1 font-bold ${badgeClass}`}
          >
            {statusLabel}
          </span>
        </div>

        {facility && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 font-medium">施設</p>
            <div className="flex items-center gap-3 mt-2">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-lg">
                🏢
              </div>
              <div className="min-w-0">
                <p className="font-bold text-gray-800 truncate">
                  {facility.name || "施設名未設定"}
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

        <div className="mt-4 bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 font-medium">演奏日時</p>
          <p className="mt-1 font-bold text-gray-800">
            📅 {formatDate(request.performance_date)}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            🕐 {formatTime(request.start_time)} ～ {formatTime(request.end_time)}
          </p>
        </div>

        {(request.area || facility?.address) && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 font-medium">場所</p>
            {request.area && (
              <p className="mt-1 text-sm text-gray-700">📍 {request.area}</p>
            )}
            {facility?.address && (
              <p className="mt-1 text-xs text-gray-500">{facility.address}</p>
            )}
          </div>
        )}

        {request.reward !== null && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 font-medium">報酬</p>
            <p className="mt-1 font-bold text-gray-800">
              💰 {request.reward.toLocaleString()}円
            </p>
          </div>
        )}

        {status === "cancelled" && (
          <div className="mt-4 bg-red-50 rounded-xl p-3">
            <p className="text-sm text-red-700">
              このマッチングはキャンセルされています。
            </p>
          </div>
        )}

        {status === "completed" && (
          <div className="mt-4 bg-gray-50 rounded-xl p-3">
            <p className="text-sm text-gray-600">
              この演奏は終了しています。
            </p>
            {match.completed_at && (
              <p className="text-xs text-gray-400 mt-1">
                完了：
                {new Date(match.completed_at).toLocaleString("ja-JP")}
              </p>
            )}
          </div>
        )}

        {status === "scheduled" && (
          <div className="mt-4 bg-blue-50 rounded-xl p-3">
            <p className="text-sm text-blue-700 font-medium">
              📅 演奏予定です
            </p>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-gray-100 text-right">
          <span className="text-sm font-bold text-gray-500">詳細を見る →</span>
        </div>
      </button>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
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
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">🎉 マッチング一覧</h1>
          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← ホームへ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen">
        <header className="bg-white border-b px-5 pt-5 pb-6">
          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="text-sm text-gray-500 py-2"
          >
            ← ホームへ戻る
          </button>
          <h1 className="text-2xl font-bold text-gray-900 mt-4">
            🎉 マッチング一覧
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            マッチングした施設との履歴を確認できます。
          </p>
        </header>

        <div className="p-4 pb-8 space-y-4">
          <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
            <div>
              <label htmlFor="match-search" className="block text-sm font-bold text-gray-700 mb-2">
                施設名・案件名で検索
              </label>
              <input
                id="match-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="施設名や案件名を入力"
                className="w-full border rounded-xl px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="match-status" className="block text-sm font-bold text-gray-700 mb-2">
                ステータス
              </label>
              <select
                id="match-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="w-full border rounded-xl px-3 py-3 text-sm bg-white"
              >
                <option value="all">すべて</option>
                <option value="scheduled">演奏予定</option>
                <option value="completed">演奏完了</option>
                <option value="cancelled">キャンセル済み</option>
              </select>
            </div>

            <div>
              <label htmlFor="match-sort" className="block text-sm font-bold text-gray-700 mb-2">
                並び順
              </label>
              <select
                id="match-sort"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortOption)}
                className="w-full border rounded-xl px-3 py-3 text-sm bg-white"
              >
                <option value="date_asc">演奏日時が近い順</option>
                <option value="date_desc">演奏日時が遠い順</option>
                <option value="matched_desc">マッチング成立日時が新しい順</option>
                <option value="matched_asc">マッチング成立日時が古い順</option>
              </select>
            </div>

            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>該当 {filteredMatches.length} 件</span>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setSortBy("date_asc");
                  setPage(1);
                }}
                className="font-bold underline"
              >
                条件をリセット
              </button>
            </div>
          </section>

          {matches.length === 0 ? (
            <div className="bg-white rounded-3xl p-7 text-center shadow-sm border border-gray-100">
              <div className="w-16 h-16 rounded-3xl bg-gray-50 flex items-center justify-center text-3xl mx-auto">
                🎵
              </div>
              <h2 className="font-bold text-gray-800 mt-4">
                現在のマッチングはありません
              </h2>
              <p className="text-sm text-gray-500 mt-2 leading-6">
                案件に応募して、施設とのマッチングを目指しましょう。
              </p>
              <button
                type="button"
                onClick={() => router.push("/performer/requests")}
                className="w-full mt-5 bg-black text-white rounded-2xl py-4 font-bold"
              >
                📋 演奏案件を探す
              </button>
            </div>
          ) : filteredMatches.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center border border-gray-100">
              <p className="text-gray-500">
                条件に一致するマッチングはありません。
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {displayedMatches.map(renderMatchCard)}
              </div>

              <div className="bg-white border border-gray-100 rounded-2xl p-4">
                <p className="text-center text-sm text-gray-500 mb-3">
                  {filteredMatches.length}件中{" "}
                  {(page - 1) * PAGE_SIZE + 1}～
                  {Math.min(page * PAGE_SIZE, filteredMatches.length)}件を表示
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="border rounded-lg px-3 py-2 text-sm disabled:opacity-40"
                  >
                    ← 前へ
                  </button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).map(
                    (pageNumber) => (
                      <button
                        key={pageNumber}
                        type="button"
                        aria-current={pageNumber === page ? "page" : undefined}
                        onClick={() => setPage(pageNumber)}
                        className={`min-w-9 rounded-lg px-3 py-2 text-sm border ${
                          pageNumber === page
                            ? "bg-black text-white border-black"
                            : "bg-white"
                        }`}
                      >
                        {pageNumber}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    disabled={page === totalPages}
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    className="border rounded-lg px-3 py-2 text-sm disabled:opacity-40"
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
            className="w-full bg-white border border-gray-200 rounded-2xl py-4 font-bold text-gray-700"
          >
            ← ホームへ戻る
          </button>
        </div>
      </div>
    </main>
  );
}