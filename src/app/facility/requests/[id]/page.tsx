"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

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
  status: "open" | "matched" | "closed";
};

type Match = {
  id: string;
  request_id: string;
  status: string;
  performance_status?: string;
};

export default function FacilityRequestDetailPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [request, setRequest] =
    useState<PerformanceRequest | null>(null);

  const [match, setMatch] =
    useState<Match | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function initialize() {
      try {
        setLoading(true);
        setError("");

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

        // 案件情報を取得
        const response = await fetch(
          `/api/performance-requests/${requestId}`,
          {
            cache: "no-store",
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "案件情報の取得に失敗しました"
          );
        }

        const loadedRequest =
          data.request as PerformanceRequest;

        setRequest(loadedRequest);

        // マッチング済みの場合は、
        // request_id から実際の match.id を取得する
        if (
          loadedRequest.status ===
          "matched"
        ) {
          const matchResponse =
            await fetch(
              "/api/facility/matches",
              {
                headers: {
                  "x-line-user-id":
                    profile.userId,
                },
                cache: "no-store",
              }
            );

          if (matchResponse.ok) {
            const matchData =
              await matchResponse.json();

            const matched =
              (
                matchData.matches || []
              ).find(
                (item: Match) =>
                  item.request_id ===
                    requestId &&
                  item.status ===
                    "active"
              );

            if (matched) {
              setMatch(matched);
            }
          }
        }
      } catch (err) {
        console.error(
          "案件詳細取得エラー:",
          err
        );

        setError(
          err instanceof Error
            ? err.message
            : "案件情報の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    if (requestId) {
      initialize();
    }
  }, [requestId]);

  function formatDate(
    date: string
  ) {
    const [
      year,
      month,
      day,
    ] = date.split("-");

    return `${year}年${month}月${day}日`;
  }

  function formatTime(
    time: string
  ) {
    return time.slice(0, 5);
  }

  function getStatusLabel() {
    if (!request) {
      return "";
    }

    switch (request.status) {
      case "open":
        return "募集中";

      case "matched":
        return "マッチング成立";

      case "closed":
        return "募集終了";

      default:
        return request.status;
    }
  }

  function getStatusClass() {
    if (!request) {
      return "";
    }

    switch (request.status) {
      case "open":
        return "bg-green-100 text-green-700";

      case "matched":
        return "bg-blue-100 text-blue-700";

      case "closed":
        return "bg-gray-100 text-gray-600";

      default:
        return "bg-gray-100 text-gray-600";
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">

          <header className="pb-6">
            <p className="text-sm font-medium text-gray-500">
              案件管理
            </p>

            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              📋 案件詳細
            </h1>
          </header>

          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            <div className="text-3xl">
              📋
            </div>

            <p className="text-sm text-gray-500 mt-3">
              案件情報を読み込んでいます…
            </p>
          </div>

        </div>
      </main>
    );
  }

  if (error || !request) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">

          <button
            type="button"
            onClick={() =>
              router.push(
                "/facility/requests"
              )
            }
            className="text-sm text-gray-500 mb-5"
          >
            ← 自分の依頼へ戻る
          </button>

          <div className="bg-white border border-red-100 rounded-2xl p-6">

            <div className="text-3xl">
              ⚠️
            </div>

            <h1 className="text-xl font-bold text-gray-900 mt-3">
              案件を表示できません
            </h1>

            <p className="text-sm text-red-600 mt-3 leading-relaxed">
              {error ||
                "案件が見つかりませんでした"}
            </p>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/facility/requests"
                )
              }
              className="w-full mt-6 bg-black text-white rounded-xl py-3.5 font-bold"
            >
              自分の依頼へ戻る
            </button>

          </div>

        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">

        {/* ヘッダー */}
        <header className="pb-6">

          <button
            type="button"
            onClick={() =>
              router.push(
                "/facility/requests"
              )
            }
            className="text-sm text-gray-500 mb-4"
          >
            ← 自分の依頼へ戻る
          </button>

          <div className="flex items-start justify-between gap-3">

            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-500">
                案件管理
              </p>

              <h1 className="text-2xl font-bold text-gray-900 mt-1 break-words">
                📋 案件詳細
              </h1>
            </div>

            <span
              className={`shrink-0 text-xs font-bold rounded-full px-3 py-1.5 ${getStatusClass()}`}
            >
              {getStatusLabel()}
            </span>

          </div>

        </header>

        {/* 案件概要 */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5">

          <h2 className="text-xl font-bold text-gray-900">
            {request.title}
          </h2>

          <div className="mt-5 space-y-4">

            {/* 演奏日 */}
            <div>
              <p className="text-xs font-medium text-gray-400">
                演奏日
              </p>

              <p className="mt-1 font-bold text-gray-900">
                📅{" "}
                {formatDate(
                  request.performance_date
                )}
              </p>
            </div>

            {/* 演奏時間 */}
            <div>
              <p className="text-xs font-medium text-gray-400">
                演奏時間
              </p>

              <p className="mt-1 font-bold text-gray-900">
                🕐{" "}
                {formatTime(
                  request.start_time
                )}
                {" ～ "}
                {formatTime(
                  request.end_time
                )}
              </p>
            </div>

            {/* エリア */}
            {request.area && (
              <div>
                <p className="text-xs font-medium text-gray-400">
                  活動エリア
                </p>

                <p className="mt-1 font-medium text-gray-900">
                  📍 {request.area}
                </p>
              </div>
            )}

            {/* 謝礼 */}
            <div>
              <p className="text-xs font-medium text-gray-400">
                謝礼
              </p>

              <p className="mt-1 font-bold text-gray-900">
                💰{" "}
                {request.reward !== null
                  ? `${request.reward.toLocaleString()}円`
                  : "応相談"}
              </p>
            </div>

          </div>

        </section>

        {/* 希望する演奏 */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5 mt-4">

          <h2 className="font-bold text-gray-900">
            🎵 希望する演奏
          </h2>

          {request.instruments?.length >
          0 ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-400">
                楽器
              </p>

              <div className="flex flex-wrap gap-2 mt-2">
                {request.instruments.map(
                  (instrument) => (
                    <span
                      key={instrument}
                      className="text-sm bg-gray-100 text-gray-700 rounded-full px-3 py-1.5"
                    >
                      🎵 {instrument}
                    </span>
                  )
                )}
              </div>
            </div>
          ) : null}

          {request.genres?.length >
          0 ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-400">
                ジャンル
              </p>

              <div className="flex flex-wrap gap-2 mt-2">
                {request.genres.map(
                  (genre) => (
                    <span
                      key={genre}
                      className="text-sm bg-gray-100 text-gray-700 rounded-full px-3 py-1.5"
                    >
                      🎼 {genre}
                    </span>
                  )
                )}
              </div>
            </div>
          ) : null}

          {request.instruments?.length ===
            0 &&
            request.genres?.length ===
              0 && (
              <p className="text-sm text-gray-400 mt-3">
                希望条件は設定されていません。
              </p>
            )}

        </section>

        {/* 依頼内容 */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5 mt-4">

          <h2 className="font-bold text-gray-900">
            📝 依頼内容
          </h2>

          {request.description ? (
            <p className="mt-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {request.description}
            </p>
          ) : (
            <p className="mt-4 text-sm text-gray-400">
              依頼内容は設定されていません。
            </p>
          )}

        </section>

        {/* マッチング成立 */}
        {request.status ===
          "matched" && (
          <section className="bg-blue-50 border border-blue-100 rounded-2xl p-5 mt-4">

            <div className="flex items-start gap-3">

              <div className="text-2xl">
                🎉
              </div>

              <div className="flex-1">
                <h2 className="font-bold text-blue-900">
                  マッチング成立
                </h2>

                <p className="text-sm text-blue-700 mt-1 leading-relaxed">
                  この案件は演奏者とのマッチングが成立しています。
                </p>

                {match ? (
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/facility/matches/${match.id}`
                      )
                    }
                    className="w-full mt-4 bg-black text-white rounded-xl py-3.5 font-bold"
                  >
                    マッチング詳細を見る
                  </button>
                ) : (
                  <p className="text-xs text-blue-600 mt-3">
                    マッチング情報を確認しています…
                  </p>
                )}

              </div>

            </div>

          </section>
        )}

        {/* 応募者 */}
        {request.status ===
          "open" && (
          <section className="bg-white border border-gray-200 rounded-2xl p-5 mt-4">

            <div className="flex items-center justify-between gap-3">

              <div>
                <h2 className="font-bold text-gray-900">
                  👥 応募者
                </h2>

                <p className="text-xs text-gray-400 mt-1">
                  この案件に応募した演奏者を確認できます。
                </p>
              </div>

            </div>

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/facility/requests/${requestId}/applications`
                )
              }
              className="w-full mt-4 border border-gray-200 bg-gray-50 rounded-xl py-3.5 font-bold text-gray-800"
            >
              応募者一覧を見る
            </button>

          </section>
        )}

        {/* 編集 */}
        {request.status ===
          "open" && (
          <section className="mt-4">

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/facility/requests/${requestId}/edit`
                )
              }
              className="w-full bg-black text-white rounded-2xl py-3.5 font-bold"
            >
              ✏️ 案件を編集する
            </button>

            <p className="text-xs text-gray-400 text-center mt-3">
              マッチング成立前の案件のみ編集できます。
            </p>

          </section>
        )}

        {/* 戻る */}
        <button
          type="button"
          onClick={() =>
            router.push(
              "/facility/requests"
            )
          }
          className="w-full mt-5 bg-white border border-gray-200 rounded-2xl py-3.5 font-bold text-gray-700"
        >
          ← 自分の依頼へ戻る
        </button>

        <p className="text-center text-xs text-gray-400 py-5">
          演奏者と施設をつなぐ、演奏マッチング
        </p>

      </div>
    </main>
  );
}