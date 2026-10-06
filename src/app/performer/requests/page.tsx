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

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            🔍 演奏案件を探す
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
            🔍 演奏案件を探す
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
            演奏者ホームへ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              🔍 演奏案件を探す
            </h1>

            <p className="text-sm text-gray-500 mt-1">
              現在募集中の案件
            </p>
          </div>
        </div>

        {requests.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center">
            <p className="text-gray-500">
              現在募集中の案件はありません。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => (
              <button
                key={request.id}
                onClick={() =>
                  router.push(
                    `/performer/requests/${request.id}`
                  )
                }
                className="w-full text-left bg-white rounded-2xl p-5 shadow-sm border"
              >
                {/* タイトル */}
                <h2 className="text-lg font-bold">
                  {request.title}
                </h2>

                {/* 施設 */}
                {request.facilities && (
                  <p className="mt-2 text-sm text-gray-600">
                    🏢{" "}
                    {request.facilities.name}
                  </p>
                )}

                {/* 日付 */}
                <p className="mt-3 text-sm">
                  📅{" "}
                  {request.performance_date}
                </p>

                {/* 時間 */}
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

                {/* エリア */}
                {request.area && (
                  <p className="text-sm">
                    📍 {request.area}
                  </p>
                )}

                {/* 楽器 */}
                {request.instruments?.length >
                  0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {request.instruments.map(
                      (instrument) => (
                        <span
                          key={instrument}
                          className="text-xs bg-gray-100 rounded-full px-3 py-1"
                        >
                          🎵 {instrument}
                        </span>
                      )
                    )}
                  </div>
                )}

                {/* 謝礼 */}
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
            ))}
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