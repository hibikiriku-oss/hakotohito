"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  status: string;
  display_status: string;
  latest_match_status: string | null;
  latest_performance_status: string | null;
  latest_match_id: string | null;
  created_at: string;
};

export default function FacilityRequestsPage() {
  const router = useRouter();

  const [lineUserId, setLineUserId] =
    useState("");

  const [requests, setRequests] =
    useState<PerformanceRequest[]>([]);

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

        setLineUserId(
          profile.userId
        );

        const response = await fetch(
          "/api/facility/requests",
          {
            headers: {
              "x-line-user-id":
                profile.userId,
            },
            cache: "no-store",
          }
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

    initialize();
  }, []);

  function getStatusLabel(
    status: string
  ) {
    if (status === "open") {
      return "募集中";
    }

    if (status === "matched") {
      return "マッチング済み";
    }

    if (status === "completed") {
      return "演奏完了";
    }

    if (status === "cancelled") {
      return "キャンセル";
    }

    return "終了";
  }

  function getStatusClass(
    status: string
  ) {
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
            <div className="text-3xl">
              📋
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
            <div className="text-2xl">
              ⚠️
            </div>

            <p className="text-sm font-bold text-red-700 mt-2">
              案件を取得できませんでした
            </p>

            <p className="text-sm text-red-600 mt-1 leading-relaxed">
              {error}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/facility/home"
              )
            }
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
            onClick={() =>
              router.push(
                "/facility/home"
              )
            }
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

        {/* 新規作成 */}
        <button
          onClick={() =>
            router.push(
              "/facility/request"
            )
          }
          className="w-full bg-black text-white rounded-2xl p-4 font-bold shadow-sm active:scale-[0.99] transition"
        >
          <div className="flex items-center justify-between">
            <span>
              🎵 新しい演奏依頼を作成
            </span>

            <span className="text-lg">
              →
            </span>
          </div>
        </button>

        {/* 案件一覧 */}
        {requests.length === 0 ? (
          <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-7 text-center">

            <div className="text-4xl">
              🎵
            </div>

            <h2 className="font-bold text-gray-900 mt-4">
              まだ演奏依頼がありません
            </h2>

            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              演奏してほしい日時や内容を登録すると、
              演奏者を募集できます。
            </p>

            <button
              onClick={() =>
                router.push(
                  "/facility/request"
                )
              }
              className="w-full mt-5 bg-black text-white rounded-xl p-4 font-bold"
            >
              🎵 演奏依頼を作成する
            </button>

          </div>
        ) : (
          <div className="mt-5 space-y-3">

            {requests.map((request) => (
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

                  <h2 className="text-base font-bold text-gray-900 leading-relaxed">
                    {request.title}
                  </h2>

                  <span
                    className={`shrink-0 text-xs font-bold border rounded-full px-3 py-1 ${getStatusClass(
                      request.display_status
                    )}`}
                  >
                    {getStatusLabel(
                      request.display_status
                    )}
                  </span>

                </div>

                {/* 日時・場所 */}
                <div className="mt-4 bg-gray-50 rounded-xl p-3">

                  <div className="flex items-center gap-2">
                    <span className="text-base">
                      📅
                    </span>

                    <span className="text-sm font-medium text-gray-800">
                      {request.performance_date}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-base">
                      🕐
                    </span>

                    <span className="text-sm font-medium text-gray-800">
                      {request.start_time.slice(0, 5)}
                      {" ～ "}
                      {request.end_time.slice(0, 5)}
                    </span>
                  </div>

                  {request.area && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-base">
                        📍
                      </span>

                      <span className="text-sm text-gray-700">
                        {request.area}
                      </span>
                    </div>
                  )}

                </div>

                {/* 条件タグ */}
                {(request.instruments.length > 0 ||
                  request.genres.length > 0) && (
                  <div className="flex flex-wrap gap-1.5 mt-3">

                    {request.instruments.map(
                      (instrument) => (
                        <span
                          key={`instrument-${instrument}`}
                          className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1"
                        >
                          🎹 {instrument}
                        </span>
                      )
                    )}

                    {request.genres.map(
                      (genre) => (
                        <span
                          key={`genre-${genre}`}
                          className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1"
                        >
                          🎵 {genre}
                        </span>
                      )
                    )}

                  </div>
                )}

                {/* 謝礼 */}
                {request.reward !== null && (
                  <div className="mt-4 flex items-center justify-between">

                    <span className="text-sm text-gray-500">
                      謝礼
                    </span>

                    <span className="font-bold text-gray-900">
                      {request.reward.toLocaleString()}
                      円
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
            ))}

          </div>
        )}

        {/* フッター */}
        <button
          onClick={() =>
            router.push(
              "/facility/home"
            )
          }
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