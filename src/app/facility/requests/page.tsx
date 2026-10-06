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

        setLineUserId(profile.userId);

        const response = await fetch(
          "/api/facility/requests",
          {
            headers: {
              "x-line-user-id":
                profile.userId,
            },
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

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">

          <h1 className="text-2xl font-bold">
            📋 自分の依頼
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
            📋 自分の依頼
          </h1>

          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">
              {error}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/facility/home"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← 施設ホームへ戻る
          </button>

        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <h1 className="text-2xl font-bold">
          📋 自分の依頼
        </h1>

        <p className="text-sm text-gray-500 mt-1">
          登録した演奏案件
        </p>

        {requests.length === 0 ? (
          <div className="mt-6 bg-white rounded-2xl p-6 text-center">

            <p className="text-gray-500">
              まだ演奏依頼がありません。
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
          <div className="mt-6 space-y-4">

            {requests.map((request) => (
              <button
                key={request.id}
                onClick={() =>
                  router.push(
                    `/facility/requests/${request.id}`
                  )
                }
                className="w-full text-left bg-white rounded-2xl p-5 shadow-sm border"
              >

                <div className="flex items-start justify-between gap-3">

                  <h2 className="text-lg font-bold">
                    {request.title}
                  </h2>

                  <span
                    className={
                      request.status === "open"
                        ? "text-xs bg-green-100 text-green-700 rounded-full px-3 py-1 whitespace-nowrap"
                        : "text-xs bg-gray-100 text-gray-500 rounded-full px-3 py-1 whitespace-nowrap"
                    }
                  >
                    {request.status === "open"
                      ? "募集中"
                      : request.status === "matched"
                        ? "マッチング済み"
                        : "終了"}
                  </span>

                </div>

                <div className="mt-4 space-y-1">

                  <p className="text-sm">
                    📅 {request.performance_date}
                  </p>

                  <p className="text-sm">
                    🕐{" "}
                    {request.start_time.slice(0, 5)}
                    {" ～ "}
                    {request.end_time.slice(0, 5)}
                  </p>

                  {request.area && (
                    <p className="text-sm">
                      📍 {request.area}
                    </p>
                  )}

                </div>

                {request.reward !== null && (
                  <p className="mt-3 font-bold">
                    💰 謝礼{" "}
                    {request.reward.toLocaleString()}
                    円
                  </p>
                )}

                <p className="mt-4 text-right text-sm text-gray-400">
                  応募者を確認する →
                </p>

              </button>
            ))}

          </div>
        )}

        <button
          onClick={() =>
            router.push(
              "/facility/home"
            )
          }
          className="w-full mt-6 bg-white border rounded-xl p-4"
        >
          ← 施設ホームへ戻る
        </button>

      </div>
    </main>
  );
}