"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type PerformanceRequest = {
  id: string;
  title: string;
  description: string | null;
  performance_date: string;
  application_deadline: string;
  start_time: string;
  end_time: string;
  area: string | null;
  instruments: string[];
  genres: string[];
  reward: number | null;
  status: string;
  display_status: string;
  latest_match_status: string | null;
  latest_performance_status: string | null;
  latest_match_id: string | null;
  created_at: string;
};

type StatusFilter =
  | "all"
  | "open"
  | "matched"
  | "completed"
  | "cancelled";

type SortOption =
  | "date_asc"
  | "date_desc"
  | "created_desc"
  | "created_asc";

const PAGE_SIZE = 10;

const STATUS_OPTIONS: {
  value: StatusFilter;
  label: string;
}[] = [
  { value: "all", label: "すべて" },
  { value: "open", label: "募集中" },
  { value: "matched", label: "マッチング済み" },
  { value: "completed", label: "演奏完了" },
  { value: "cancelled", label: "キャンセル" },
];

const SORT_OPTIONS: {
  value: SortOption;
  label: string;
}[] = [
  { value: "date_asc", label: "演奏日時が近い順" },
  { value: "date_desc", label: "演奏日時が遠い順" },
  { value: "created_desc", label: "登録日時が新しい順" },
  { value: "created_asc", label: "登録日時が古い順" },
];

function getEffectiveStatus(
  request: PerformanceRequest
): StatusFilter | "other" {
  const values = [
    request.display_status,
    request.status,
    request.latest_performance_status,
    request.latest_match_status,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  // キャンセル済みの案件を優先して判定
  if (
    values.some(
      (value) =>
        value === "cancelled" ||
        value === "canceled"
    )
  ) {
    return "cancelled";
  }

  if (
    values.some(
      (value) =>
        value === "completed"
    )
  ) {
    return "completed";
  }

  if (
    values.some(
      (value) =>
        value === "matched"
    )
  ) {
    return "matched";
  }

  if (
    values.some(
      (value) =>
        value === "open"
    )
  ) {
    return "open";
  }

  return "other";
}

function getStatusLabel(status: string) {
  if (status === "open") return "募集中";
  if (status === "matched") return "マッチング済み";
  if (status === "completed") return "演奏完了";
  if (status === "cancelled") return "キャンセル";
  return "終了";
}

function getStatusClass(status: string) {
  if (status === "open") {
    return "bg-green-50 text-green-700 border-green-100";
  }

  if (status === "matched") {
    return "bg-blue-50 text-blue-700 border-blue-100";
  }

  if (status === "completed") {
    return "bg-gray-100 text-gray-600 border-gray-200";
  }

  if (status === "cancelled") {
    return "bg-red-50 text-red-600 border-red-100";
  }

  return "bg-gray-100 text-gray-500 border-gray-200";
}

function getPerformanceTimestamp(
  request: PerformanceRequest
) {
  const date = request.performance_date || "";
  const time = request.start_time || "00:00";

  const timestamp = new Date(
    `${date}T${time.slice(0, 5)}:00`
  ).getTime();

  return Number.isNaN(timestamp)
    ? Number.MAX_SAFE_INTEGER
    : timestamp;
}

function formatDate(date: string) {
  if (!date) return "日付未設定";

  const parts = date.split("-");
  if (parts.length === 3) {
    return `${parts[0]}年${Number(parts[1])}月${Number(
      parts[2]
    )}日`;
  }

  return date;
}

export default function FacilityRequestsPage() {
  const router = useRouter();

  const [requests, setRequests] =
    useState<PerformanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("all");
  const [sortOption, setSortOption] =
    useState<SortOption>("date_asc");
  const [currentPage, setCurrentPage] = useState(1);

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

        const profile = await liff.getProfile();

        const response = await fetch(
          "/api/facility/requests",
          {
            headers: {
              "x-line-user-id": profile.userId,
            },
            cache: "no-store",
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "案件の取得に失敗しました"
          );
        }

        setRequests(
          Array.isArray(data.requests)
            ? data.requests
            : []
        );
      } catch (error) {
        console.error("案件取得エラー:", error);

        setError(
          error instanceof Error
            ? error.message
            : "案件の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, []);

  // 検索・絞り込み・並べ替えを変更したら1ページ目に戻る
  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, statusFilter, sortOption]);

  const filteredRequests = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();

    const filtered = requests.filter((request) => {
      const searchableText = [
        request.title,
        request.area ?? "",
        ...(request.instruments ?? []),
        ...(request.genres ?? []),
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        keyword === "" ||
        searchableText.includes(keyword);

      const effectiveStatus =
        getEffectiveStatus(request);

      const matchesStatus =
        statusFilter === "all" ||
        effectiveStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });

    return filtered.sort((a, b) => {
      if (sortOption === "date_asc") {
        return (
          getPerformanceTimestamp(a) -
          getPerformanceTimestamp(b)
        );
      }

      if (sortOption === "date_desc") {
        return (
          getPerformanceTimestamp(b) -
          getPerformanceTimestamp(a)
        );
      }

      const aCreated = new Date(a.created_at).getTime();
      const bCreated = new Date(b.created_at).getTime();

      const safeACreated = Number.isNaN(aCreated)
        ? 0
        : aCreated;
      const safeBCreated = Number.isNaN(bCreated)
        ? 0
        : bCreated;

      if (sortOption === "created_desc") {
        return safeBCreated - safeACreated;
      }

      return safeACreated - safeBCreated;
    });
  }, [requests, searchText, statusFilter, sortOption]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRequests.length / PAGE_SIZE)
  );

  const visibleRequests = filteredRequests.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function goToPage(page: number) {
    setCurrentPage(
      Math.max(1, Math.min(page, totalPages))
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">
          <header className="pb-6">
            <p className="text-sm font-medium text-gray-500">
              演奏マッチング
            </p>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              📋 自分の依頼
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              登録した演奏案件を確認できます。
            </p>
          </header>

          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <div className="text-3xl">📋</div>
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
        <div className="max-w-md mx-auto px-4 py-6">
          <header className="pb-6">
            <p className="text-sm font-medium text-gray-500">
              演奏マッチング
            </p>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              📋 自分の依頼
            </h1>
          </header>

          <div className="bg-red-50 border border-red-100 rounded-2xl p-5">
            <div className="text-2xl">⚠️</div>
            <p className="text-sm font-bold text-red-700 mt-2">
              案件を取得できませんでした
            </p>
            <p className="text-sm text-red-600 mt-1 leading-relaxed">
              {error}
            </p>
          </div>

          <button
            onClick={() => router.push("/facility/home")}
            className="w-full mt-5 bg-white border border-gray-200 rounded-2xl p-4 font-bold text-gray-700"
          >
            ← 施設ホームへ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">
        {/* ヘッダー */}
        <header className="pb-5">
          <button
            onClick={() => router.push("/facility/home")}
            className="text-sm text-gray-500 mb-4"
          >
            ← 施設ホーム
          </button>

          <p className="text-sm font-medium text-gray-500">
            案件管理
          </p>

          <div className="flex items-end justify-between gap-3 mt-1">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                📋 自分の依頼
              </h1>
              <p className="text-sm text-gray-500 mt-2">
                登録した演奏案件を管理できます。
              </p>
            </div>

            <div className="shrink-0 bg-white border border-gray-200 rounded-full px-3 py-1">
              <span className="text-sm font-bold text-gray-700">
                {requests.length}件
              </span>
            </div>
          </div>
        </header>

        {/* 新規依頼作成 */}
        <button
          onClick={() => router.push("/facility/request")}
          className="w-full bg-black text-white rounded-2xl p-4 font-bold shadow-sm active:scale-[0.99] transition"
        >
          <div className="flex items-center justify-between">
            <span>🎵 新しい演奏依頼を作成</span>
            <span className="text-lg">→</span>
          </div>
        </button>

        {/* 検索・絞り込み・並べ替え */}
        {requests.length > 0 && (
          <section className="mt-5 bg-white border border-gray-200 rounded-2xl p-4">
            <h2 className="text-sm font-bold text-gray-900 mb-3">
              🔎 案件を検索・絞り込み
            </h2>

            <label
              htmlFor="request-search"
              className="block text-xs font-medium text-gray-600 mb-1.5"
            >
              案件名・楽器・ジャンル・開催エリア
            </label>

            <input
              id="request-search"
              type="search"
              value={searchText}
              onChange={(event) =>
                setSearchText(event.target.value)
              }
              placeholder="例：ピアノ、クラシック、名古屋"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-900 outline-none focus:border-gray-500"
            />

            <div className="mt-4">
              <label
                htmlFor="request-status"
                className="block text-xs font-medium text-gray-600 mb-1.5"
              >
                ステータス
              </label>

              <select
                id="request-status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as StatusFilter
                  )
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <label
                htmlFor="request-sort"
                className="block text-xs font-medium text-gray-600 mb-1.5"
              >
                並べ替え
              </label>

              <select
                id="request-sort"
                value={sortOption}
                onChange={(event) =>
                  setSortOption(
                    event.target.value as SortOption
                  )
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-900"
              >
                {SORT_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-3 mt-4">
              <p className="text-xs text-gray-500">
                該当：{filteredRequests.length}件
              </p>

              <button
                onClick={() => {
                  setSearchText("");
                  setStatusFilter("all");
                  setSortOption("date_asc");
                  setCurrentPage(1);
                }}
                className="text-xs font-bold text-gray-600 underline underline-offset-2"
              >
                条件をリセット
              </button>
            </div>
          </section>
        )}

        {/* 案件一覧 */}
        {requests.length === 0 ? (
          <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-7 text-center">
            <div className="text-4xl">🎵</div>

            <h2 className="font-bold text-gray-900 mt-4">
              まだ演奏依頼がありません
            </h2>

            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              演奏してほしい日時や内容を登録すると、
              演奏者を募集できます。
            </p>

            <button
              onClick={() => router.push("/facility/request")}
              className="w-full mt-5 bg-black text-white rounded-xl p-4 font-bold"
            >
              🎵 演奏依頼を作成する
            </button>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-7 text-center">
            <div className="text-3xl">🔎</div>

            <h2 className="font-bold text-gray-900 mt-3">
              該当する案件がありません
            </h2>

            <p className="text-sm text-gray-500 mt-2">
              検索キーワードや絞り込み条件を変更してください。
            </p>

            <button
              onClick={() => {
                setSearchText("");
                setStatusFilter("all");
                setSortOption("date_asc");
                setCurrentPage(1);
              }}
              className="mt-4 rounded-xl bg-gray-100 px-5 py-3 text-sm font-bold text-gray-700"
            >
              条件をリセット
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-800">
                依頼案件一覧
              </h2>

              <span className="text-xs text-gray-500">
                {filteredRequests.length}件中{" "}
                {(currentPage - 1) * PAGE_SIZE + 1}
                {"～"}
                {Math.min(
                  currentPage * PAGE_SIZE,
                  filteredRequests.length
                )}
                件
              </span>
            </div>

            <div className="mt-3 space-y-3">
              {visibleRequests.map((request) => {
                const status =
                  getEffectiveStatus(request);

                return (
                  <button
                    key={request.id}
                    onClick={() =>
                      router.push(
                        `/facility/requests/${request.id}`
                      )
                    }
                    className="w-full text-left bg-white border border-gray-200 rounded-2xl p-5 shadow-sm active:scale-[0.99] transition"
                  >
                    {/* タイトル・ステータス */}
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-bold text-gray-900 leading-relaxed">
                        {request.title}
                      </h3>

                      <span
                        className={`shrink-0 text-xs font-bold border rounded-full px-3 py-1 ${getStatusClass(
                          status
                        )}`}
                      >
                        {getStatusLabel(status)}
                      </span>
                    </div>

                    {/* 日時・場所 */}
                    <div className="mt-4 bg-gray-50 rounded-xl p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📅</span>
                        <span className="text-sm font-medium text-gray-800">
                          {formatDate(
                            request.performance_date
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-base">🕐</span>
                        <span className="text-sm font-medium text-gray-800">
                          {(request.start_time || "").slice(0, 5)}
                          {" ～ "}
                          {(request.end_time || "").slice(0, 5)}
                        </span>
                      </div>

                      {request.area && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-base">📍</span>
                          <span className="text-sm text-gray-700">
                            {request.area}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 募集期限 */}
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-base">⏳</span>
                      <span className="text-sm text-gray-700">
                        募集期限：
                        {formatDate(
                          request.application_deadline
                        )}
                      </span>
                    </div>

                    {/* 楽器・ジャンル */}
                    {((request.instruments ?? []).length > 0 ||
                      (request.genres ?? []).length > 0) && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {(request.instruments ?? []).map(
                          (instrument) => (
                            <span
                              key={`instrument-${instrument}`}
                              className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1"
                            >
                              🎹 {instrument}
                            </span>
                          )
                        )}

                        {(request.genres ?? []).map((genre) => (
                          <span
                            key={`genre-${genre}`}
                            className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1"
                          >
                            🎵 {genre}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 謝礼 */}
                    {request.reward !== null &&
                      request.reward !== undefined && (
                        <div className="mt-4 flex items-center justify-between">
                          <span className="text-sm text-gray-500">
                            謝礼
                          </span>

                          <span className="font-bold text-gray-900">
                            {request.reward.toLocaleString()}円
                          </span>
                        </div>
                      )}

                    {/* 詳細リンク */}
                    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        案件の詳細・応募者を確認
                      </span>

                      <span className="text-sm font-bold text-gray-700">
                        詳細を見る →
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
              <nav
                aria-label="案件一覧ページ"
                className="mt-6 flex items-center justify-center gap-2"
              >
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                >
                  ← 前へ
                </button>

                {Array.from(
                  { length: totalPages },
                  (_, index) => index + 1
                ).map((page) => (
                  <button
                    key={page}
                    onClick={() => goToPage(page)}
                    aria-current={
                      currentPage === page
                        ? "page"
                        : undefined
                    }
                    className={`min-w-9 rounded-xl border px-3 py-2 text-sm font-bold ${
                      currentPage === page
                        ? "border-black bg-black text-white"
                        : "border-gray-200 bg-white text-gray-700"
                    }`}
                  >
                    {page}
                  </button>
                ))}

                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                >
                  次へ →
                </button>
              </nav>
            )}
          </>
        )}

        {/* フッター */}
        <button
          onClick={() => router.push("/facility/home")}
          className="w-full mt-6 bg-white border border-gray-200 rounded-2xl p-4 font-medium text-gray-600"
        >
          ← 施設ホームへ戻る
        </button>

        <p className="text-center text-xs text-gray-400 mt-6 pb-4">
          演奏者と施設をつなぐ、演奏マッチング
        </p>
      </div>
    </main>
  );
}