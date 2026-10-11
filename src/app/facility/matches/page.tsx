"use client";

import { useEffect, useState } from "react";
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
  performance_requests:
    | PerformanceRequest
    | null;
  performers: Performer | null;
};

export default function FacilityMatchesPage() {
  const router = useRouter();

  const [matches, setMatches] =
    useState<Match[]>([]);
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

        const response = await fetch(
          "/api/facility/matches",
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
              "マッチング情報の取得に失敗しました"
          );
        }

        setMatches(
          data.matches || []
        );
      } catch (error) {
        console.error(
          "施設マッチング取得エラー:",
          error
        );

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

  function formatDate(date: string) {
    const [year, month, day] =
      date.split("-");

    return (
      year +
      "/" +
      month +
      "/" +
      day
    );
  }

  function formatTime(time: string) {
    return time.slice(0, 5);
  }

  function getPerformanceStatus(
    match: Match
  ) {
    if (
      match.performance_status ===
      "completed"
    ) {
      return {
        label: "演奏完了",
        className:
          "bg-blue-100 text-blue-700",
      };
    }

    if (
      match.performance_status ===
      "cancelled" ||
      match.status === "cancelled"
    ) {
      return {
        label: "キャンセル済み",
        className:
          "bg-red-100 text-red-700",
      };
    }

    return {
      label: "演奏予定",
      className:
        "bg-green-100 text-green-700",
    };
  }

  const currentMatches =
    matches.filter(
      (match) =>
        match.performance_status !==
          "completed" &&
        match.performance_status !==
          "cancelled" &&
        match.status !== "cancelled"
    );

  const historyMatches =
    matches.filter(
      (match) =>
        match.performance_status ===
          "completed" ||
        match.performance_status ===
          "cancelled" ||
        match.status === "cancelled"
    );

  function renderMatchCard(match: Match) {
    const request =
      match.performance_requests;

    const performer =
      match.performers;

    if (!request || !performer) {
      return null;
    }

    const user =
      performer.users;

    const performanceStatus =
      getPerformanceStatus(match);

    return (
      <button
        key={match.id}
        onClick={() =>
          router.push(
            "/facility/matches/" +
              match.id
          )
        }
        className="w-full text-left bg-white rounded-2xl p-5 shadow-sm border hover:bg-gray-50 active:bg-gray-100 transition"
      >
        {/* ステータス */}
        <div className="flex items-center justify-between gap-3">

          <span className="text-sm font-bold">
            🎉 マッチング成立
          </span>

          <span
            className={
              "text-xs rounded-full px-3 py-1 font-bold " +
              performanceStatus.className
            }
          >
            {performanceStatus.label}
          </span>

        </div>

        {/* 案件タイトル */}
        <h2 className="text-xl font-bold mt-4">
          {request.title}
        </h2>

        {/* 演奏者 */}
        <div className="mt-4">

          <p className="text-sm text-gray-500">
            演奏者
          </p>

          <div className="flex items-center gap-3 mt-2">

            {user?.picture_url ? (
              <img
                src={
                  user.picture_url
                }
                alt=""
                className="w-12 h-12 rounded-full object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                🎸
              </div>
            )}

            <div>
              <p className="font-bold">
                {performer.name ||
                  user?.display_name ||
                  "演奏者名未登録"}
              </p>

              {performer.area && (
                <p className="text-sm text-gray-600">
                  📍{" "}
                  {performer.area}
                </p>
              )}
            </div>

          </div>

        </div>

        {/* 演奏日時 */}
        <div className="mt-4">

          <p className="text-sm text-gray-500">
            演奏日時
          </p>

          <p className="mt-1 font-bold">
            📅{" "}
            {formatDate(
              request.performance_date
            )}
          </p>

          <p className="text-sm text-gray-600 mt-1">
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

        {/* 場所 */}
        {request.area && (
          <div className="mt-4">

            <p className="text-sm text-gray-500">
              場所
            </p>

            <p className="mt-1">
              📍 {request.area}
            </p>

          </div>
        )}

        {/* 楽器 */}
        {performer.instruments?.length >
          0 && (
          <div className="mt-4">

            <p className="text-sm text-gray-500">
              演奏楽器
            </p>

            <div className="flex flex-wrap gap-2 mt-2">

              {performer.instruments.map(
                (instrument) => (
                  <span
                    key={instrument}
                    className="text-sm bg-gray-100 rounded-full px-3 py-1"
                  >
                    🎸 {instrument}
                  </span>
                )
              )}

            </div>

          </div>
        )}

        {/* ジャンル */}
        {performer.genres?.length >
          0 && (
          <div className="mt-4">

            <p className="text-sm text-gray-500">
              ジャンル
            </p>

            <div className="flex flex-wrap gap-2 mt-2">

              {performer.genres.map(
                (genre) => (
                  <span
                    key={genre}
                    className="text-sm bg-gray-100 rounded-full px-3 py-1"
                  >
                    🎵 {genre}
                  </span>
                )
              )}

            </div>

          </div>
        )}

        {/* 報酬 */}
        {request.reward !== null && (
          <div className="mt-4">

            <p className="text-sm text-gray-500">
              報酬
            </p>

            <p className="mt-1 font-bold">
              💰{" "}
              {request.reward.toLocaleString()}
              円
            </p>

          </div>
        )}

        {/* キャンセル履歴 */}
        {performanceStatus.label ===
          "キャンセル済み" && (
          <div className="mt-4 bg-red-50 rounded-xl p-3">
            <p className="text-sm text-red-700">
              このマッチングはキャンセルされています。
            </p>
          </div>
        )}

        {/* 完了履歴 */}
        {performanceStatus.label ===
          "演奏完了" && (
          <div className="mt-4 bg-blue-50 rounded-xl p-3">
            <p className="text-sm text-blue-700">
              演奏が完了しています。
            </p>

            {match.completed_at && (
              <p className="mt-1 text-xs text-blue-600">
                完了日時：
                {formatDate(
                  match.completed_at.slice(0, 10)
                )}
              </p>
            )}
          </div>
        )}

        {/* 現在のマッチング表示 */}
        {performanceStatus.label ===
          "演奏予定" && (
          <div className="mt-4 bg-green-50 rounded-xl p-3">
            <p className="text-sm text-green-700">
              現在、この演奏者とのマッチングが進行中です。
            </p>
          </div>
        )}

        {/* 詳細への案内 */}
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

          <h1 className="text-2xl font-bold">
            🎉 マッチング一覧
          </h1>

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

          <h1 className="text-2xl font-bold">
            🎉 マッチング一覧
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
          onClick={() =>
            router.push(
              "/facility/home"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← ホームへ戻る
        </button>

        <h1 className="text-2xl font-bold">
          🎉 マッチング一覧
        </h1>

        <p className="mt-2 text-sm text-gray-500">
          マッチングした演奏者との履歴を確認できます。
        </p>

        {matches.length === 0 ? (
          <div className="mt-6 bg-white rounded-2xl p-6 text-center">

            <p className="text-gray-500">
              まだマッチングはありません。
            </p>

            <button
              onClick={() =>
                router.push(
                  "/facility/requests"
                )
              }
              className="w-full mt-5 bg-black text-white rounded-xl p-4"
            >
              📋 自分の依頼を見る
            </button>

          </div>
        ) : (
          <div className="mt-6 space-y-8">

            {/* 現在のマッチング */}
            {currentMatches.length > 0 && (
              <section>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">
                    📌 現在のマッチング
                  </h2>

                  <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-1">
                    {currentMatches.length}件
                  </span>
                </div>

                <p className="mt-1 text-sm text-gray-500">
                  現在、演奏予定のマッチングです。
                </p>

                <div className="mt-4 space-y-4">
                  {currentMatches.map(
                    renderMatchCard
                  )}
                </div>
              </section>
            )}

            {/* マッチング履歴 */}
            {historyMatches.length > 0 && (
              <section>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">
                    📚 マッチング履歴
                  </h2>

                  <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-1">
                    {historyMatches.length}件
                  </span>
                </div>

                <p className="mt-1 text-sm text-gray-500">
                  演奏完了・キャンセル済みの過去のマッチングです。
                </p>

                <div className="mt-4 space-y-4">
                  {historyMatches.map(
                    renderMatchCard
                  )}
                </div>
              </section>
            )}

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
          ← ホームへ戻る
        </button>

      </div>
    </main>
  );
}