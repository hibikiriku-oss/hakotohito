"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type User = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
};

type Performer = {
  id: string;
  name: string | null;
  instruments: string[];
  genres: string[];
  area: string | null;
  bio: string | null;
  users: User | null;
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
  performers: Performer | null;
};

type StatusFilter = "all" | "scheduled" | "completed" | "cancelled";
type SortOption = "date_asc" | "date_desc" | "matched_desc" | "matched_asc";

const PAGE_SIZE = 10;

function getMatchStatus(match: Match): StatusFilter {
  if (
    match.performance_status === "cancelled" ||
    match.status === "cancelled"
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

function getMatchDateTime(match: Match) {
  const request = match.performance_requests;
  return request ? `${request.performance_date}T${request.start_time}` : "";
}

export default function FacilityMatchesPage() {
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
        const response = await fetch("/api/facility/matches", {
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
        console.error("施設マッチング取得エラー:", error);
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

  const filteredMatches = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();

    return matches
      .filter((match) => {
        const request = match.performance_requests;
        const performer = match.performers;

        if (!request || !performer) return false;

        const performerName = (
          performer.name ||
          performer.users?.display_name ||
          "演奏者名未登録"
        ).toLocaleLowerCase();

        const matchesKeyword =
          !keyword ||
          request.title.toLocaleLowerCase().includes(keyword) ||
          performerName.includes(keyword);

        const matchesStatus =
          statusFilter === "all" ||
          getMatchStatus(match) === statusFilter;

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

        const dateA = getMatchDateTime(a);
        const dateB = getMatchDateTime(b);

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
    const performer = match.performers;

    if (!request || !performer) return null;

    const user = performer.users;
    const status = getMatchStatus(match);

    const statusLabel =
      status === "cancelled"
        ? "キャンセル済み"
        : status === "completed"
          ? "演奏完了"
          : "演奏予定";

    const badgeClass =
      status === "cancelled"
        ? "bg-red-100 text-red-700"
        : status === "completed"
          ? "bg-blue-100 text-blue-700"
          : "bg-green-100 text-green-700";

    return (
      <button
        key={match.id}
        type="button"
        onClick={() => router.push(`/facility/matches/${match.id}`)}
        className="w-full text-left bg-white rounded-2xl p-5 shadow-sm border hover:bg-gray-50 active:bg-gray-100 transition"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold">🎉 マッチング成立</span>
          <span
            className={`text-xs rounded-full px-3 py-1 font-bold ${badgeClass}`}
          >
            {statusLabel}
          </span>
        </div>

        <h2 className="text-xl font-bold mt-4">{request.title}</h2>

        <div className="mt-4">
          <p className="text-sm text-gray-500">演奏者</p>
          <div className="flex items-center gap-3 mt-2">
            {user?.picture_url ? (
              <img
                src={user.picture_url}
                alt=""
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                🎸
              </div>
            )}

            <div className="min-w-0">
              <p className="font-bold truncate">
                {performer.name ||
                  user?.display_name ||
                  "演奏者名未登録"}
              </p>
              {performer.area && (
                <p className="text-sm text-gray-600">
                  📍 {performer.area}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm text-gray-500">演奏日時</p>
          <p className="mt-1 font-bold">
            📅 {formatDate(request.performance_date)}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            🕐 {formatTime(request.start_time)} ～ {formatTime(request.end_time)}
          </p>
        </div>

        {request.area && (
          <div className="mt-4">
            <p className="text-sm text-gray-500">場所</p>
            <p className="mt-1">📍 {request.area}</p>
          </div>
        )}

        {performer.instruments?.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-gray-500">演奏楽器</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {performer.instruments.map((instrument) => (
                <span
                  key={instrument}
                  className="text-sm bg-gray-100 rounded-full px-3 py-1"
                >
                  🎸 {instrument}
                </span>
              ))}
            </div>
          </div>
        )}

        {performer.genres?.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-gray-500">ジャンル</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {performer.genres.map((genre) => (
                <span
                  key={genre}
                  className="text-sm bg-gray-100 rounded-full px-3 py-1"
                >
                  🎵 {genre}
                </span>
              ))}
            </div>
          </div>
        )}

        {request.reward !== null && (
          <div className="mt-4">
            <p className="text-sm text-gray-500">報酬</p>
            <p className="mt-1 font-bold">
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
          <div className="mt-4 bg-blue-50 rounded-xl p-3">
            <p className="text-sm text-blue-700">演奏が完了しています。</p>
            {match.completed_at && (
              <p className="mt-1 text-xs text-blue-600">
                完了日時：
                {formatDate(match.completed_at.slice(0, 10))}
              </p>
            )}
          </div>
        )}

        {status === "scheduled" && (
          <div className="mt-4 bg-green-50 rounded-xl p-3">
            <p className="text-sm text-green-700">
              現在、この演奏者とのマッチングが進行中です。
            </p>
          </div>
        )}

        <div className="mt-5 pt-4 border-t text-center">
          <span className="text-sm font-bold text-gray-600">
            マッチング詳細を見る →
          </span>
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
            onClick={() => router.push("/facility/home")}
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
          type="button"
          onClick={() => router.push("/facility/home")}
          className="text-sm text-gray-500 mb-4"
        >
          ← ホームへ戻る
        </button>

        <h1 className="text-2xl font-bold">🎉 マッチング一覧</h1>
        <p className="mt-2 text-sm text-gray-500">
          マッチングした演奏者との履歴を確認できます。
        </p>

        <section className="mt-6 bg-white rounded-2xl border p-4 space-y-4">
          <div>
            <label htmlFor="match-search" className="block text-sm font-bold mb-2">
              演奏者名・案件名で検索
            </label>
            <input
              id="match-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="演奏者名や案件名を入力"
              className="w-full border rounded-xl px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label htmlFor="match-status" className="block text-sm font-bold mb-2">
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
            <label htmlFor="match-sort" className="block text-sm font-bold mb-2">
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
          <div className="mt-6 bg-white rounded-2xl p-6 text-center">
            <p className="text-gray-500">まだマッチングはありません。</p>
            <button
              type="button"
              onClick={() => router.push("/facility/requests")}
              className="w-full mt-5 bg-black text-white rounded-xl p-4"
            >
              📋 自分の依頼を見る
            </button>
          </div>
        ) : filteredMatches.length === 0 ? (
          <div className="mt-6 bg-white rounded-2xl p-6 text-center">
            <p className="text-gray-500">
              条件に一致するマッチングはありません。
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {displayedMatches.map(renderMatchCard)}

            <div className="bg-white border rounded-2xl p-4">
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
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  className="border rounded-lg px-3 py-2 text-sm disabled:opacity-40"
                >
                  次へ →
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => router.push("/facility/home")}
          className="w-full mt-6 bg-white border rounded-xl p-4"
        >
          ← ホームへ戻る
        </button>
      </div>
    </main>
  );
}