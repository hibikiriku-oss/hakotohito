"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Facility = {
  name: string;
  facility_type: string;
  address: string;
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

export default function PerformerRequestDetailPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [request, setRequest] =
    useState<PerformanceRequest | null>(null);

  const [lineUserId, setLineUserId] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [applying, setApplying] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function initialize() {
      try {
        // LINE情報取得
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

        // 案件取得
        const response = await fetch(
          `/api/performance-requests/${requestId}`
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "案件の取得に失敗しました"
          );
        }

        setRequest(data.request);
      } catch (error) {
        console.error(error);

        setError(
          error instanceof Error
            ? error.message
            : "エラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [requestId]);

  const handleApply = async () => {
    if (!lineUserId) {
      alert(
        "LINEユーザー情報を取得できていません"
      );
      return;
    }

    if (!request) {
      return;
    }

    if (request.status !== "open") {
      alert(
        "この案件は現在応募できません"
      );
      return;
    }

    const confirmed =
      window.confirm(
        "この案件に応募しますか？"
      );

    if (!confirmed) {
      return;
    }

    try {
      setApplying(true);

      const response = await fetch(
        "/api/applications",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "x-line-user-id":
              lineUserId,
          },
          body: JSON.stringify({
            requestId,
            message,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        alert(
          data.error ||
            "応募に失敗しました"
        );
        return;
      }

      alert(
        "応募しました！"
      );

      router.push(
        "/performer/home"
      );
    } catch (error) {
      console.error(
        "応募エラー:",
        error
      );

      alert(
        "通信エラーが発生しました"
      );
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            案件詳細
          </h1>

          <p className="mt-8 text-center text-gray-500">
            案件を読み込んでいます…
          </p>
        </div>
      </main>
    );
  }

  if (error || !request) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            案件詳細
          </h1>

          <div className="mt-6 p-4 bg-red-50 rounded-xl">
            <p className="text-red-600">
              {error || "案件が見つかりません"}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/performer/requests"
              )
            }
            className="w-full mt-6 bg-white border rounded-xl p-4"
          >
            ← 案件一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <button
          onClick={() =>
            router.push(
              "/performer/requests"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← 案件一覧へ戻る
        </button>

        <div className="bg-white rounded-2xl p-5 shadow-sm">

          <h1 className="text-2xl font-bold">
            {request.title}
          </h1>

          {request.facilities && (
            <div className="mt-5">
              <p className="text-sm text-gray-500">
                施設
              </p>

              <p className="font-bold mt-1">
                🏢 {request.facilities.name}
              </p>

              <p className="text-sm text-gray-600 mt-1">
                {request.facilities.facility_type}
              </p>

              <p className="text-sm text-gray-600">
                {request.facilities.address}
              </p>
            </div>
          )}

          <div className="mt-5 space-y-2">

            <p>
              📅 {request.performance_date}
            </p>

            <p>
              🕐{" "}
              {request.start_time.slice(0, 5)}
              {" ～ "}
              {request.end_time.slice(0, 5)}
            </p>

            {request.area && (
              <p>
                📍 {request.area}
              </p>
            )}

            {request.reward !== null && (
              <p className="font-bold">
                💰 謝礼{" "}
                {request.reward.toLocaleString()}
                円
              </p>
            )}

          </div>

          {request.instruments?.length > 0 && (
            <div className="mt-5">
              <p className="text-sm text-gray-500 mb-2">
                希望する楽器
              </p>

              <div className="flex flex-wrap gap-2">
                {request.instruments.map(
                  (instrument) => (
                    <span
                      key={instrument}
                      className="bg-gray-100 rounded-full px-3 py-1 text-sm"
                    >
                      🎵 {instrument}
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {request.genres?.length > 0 && (
            <div className="mt-5">
              <p className="text-sm text-gray-500 mb-2">
                希望するジャンル
              </p>

              <div className="flex flex-wrap gap-2">
                {request.genres.map(
                  (genre) => (
                    <span
                      key={genre}
                      className="bg-gray-100 rounded-full px-3 py-1 text-sm"
                    >
                      🎼 {genre}
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {request.description && (
            <div className="mt-5">
              <p className="text-sm text-gray-500">
                依頼内容
              </p>

              <p className="mt-2 whitespace-pre-wrap">
                {request.description}
              </p>
            </div>
          )}

          {request.facilities?.description && (
            <div className="mt-5">
              <p className="text-sm text-gray-500">
                施設紹介
              </p>

              <p className="mt-2 whitespace-pre-wrap">
                {request.facilities.description}
              </p>
            </div>
          )}

        </div>

        {request.status === "open" ? (
          <div className="mt-6 bg-white rounded-2xl p-5 shadow-sm">

            <h2 className="font-bold text-lg">
              この案件に応募する
            </h2>

            <p className="text-sm text-gray-500 mt-2">
              施設に伝えたいことがあれば入力してください。
            </p>

            <textarea
              value={message}
              onChange={(e) =>
                setMessage(e.target.value)
              }
              placeholder="例：ギターでの演奏経験があります。ぜひ演奏させてください！"
              rows={5}
              className="w-full border rounded-xl p-3 bg-white mt-4"
            />

            <button
              onClick={handleApply}
              disabled={applying}
              className="w-full mt-4 bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
            >
              {applying
                ? "応募中..."
                : "この案件に応募する"}
            </button>

          </div>
        ) : (
          <div className="mt-6 bg-gray-100 rounded-xl p-4 text-center">
            <p className="text-gray-500">
              この案件は現在募集していません。
            </p>
          </div>
        )}

      </div>
    </main>
  );
}