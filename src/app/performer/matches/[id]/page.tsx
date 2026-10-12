"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  performance_status:
    | "scheduled"
    | "completed"
    | "cancelled";
  completed_at: string | null;
  performance_requests: PerformanceRequest | null;
};

export default function PerformerMatchDetailPage() {
  const router = useRouter();
  const params = useParams();

  const matchId = params.id as string;

  const [match, setMatch] =
    useState<Match | null>(null);

  const [reviewed, setReviewed] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [completing, setCompleting] =
    useState(false);

  const [cancelling, setCancelling] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function initialize() {
      try {
        const liffId =
          process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "LINE MINI Appの設定がありません"
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
          `/api/performer/matches/${matchId}`,
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

        setMatch(data.match);

        const reviewResponse =
          await fetch(
            `/api/reviews?match_id=${matchId}`,
            {
              headers: {
                "x-line-user-id":
                  profile.userId,
              },
            }
          );

        if (reviewResponse.ok) {
          const reviewData =
            await reviewResponse.json();

          setReviewed(
            reviewData.reviewed === true
          );
        }
      } catch (error) {
        console.error(
          "マッチング詳細取得エラー:",
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
  }, [matchId]);

  async function handleComplete() {
    if (!match) {
      return;
    }

    const confirmed =
      window.confirm(
        "この演奏を完了済みにしますか？"
      );

    if (!confirmed) {
      return;
    }

    try {
      setCompleting(true);
      setError("");

      const liffId =
        process.env.NEXT_PUBLIC_LIFF_ID;

      if (!liffId) {
        throw new Error(
          "LINE MINI Appの設定がありません"
        );
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile =
        await liff.getProfile();

      const response = await fetch(
        `/api/performer/matches/${matchId}/complete`,
        {
          method: "POST",
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
            "演奏完了の更新に失敗しました"
        );
      }

      setMatch((currentMatch) => {
        if (!currentMatch) {
          return currentMatch;
        }

        return {
          ...currentMatch,
          performance_status:
            "completed",
          completed_at:
            data.match?.completed_at ??
            new Date().toISOString(),
        };
      });
    } catch (error) {
      console.error(
        "演奏完了処理エラー:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "演奏完了の更新に失敗しました"
      );
    } finally {
      setCompleting(false);
    }
  }

  async function handleCancel() {
    if (!match) {
      return;
    }

    const confirmed =
      window.confirm(
        "この出演をキャンセルしますか？\n\nキャンセルすると、このマッチングでは演奏できなくなります。"
      );

    if (!confirmed) {
      return;
    }

    try {
      setCancelling(true);
      setError("");

      const liffId =
        process.env.NEXT_PUBLIC_LIFF_ID;

      if (!liffId) {
        throw new Error(
          "LINE MINI Appの設定がありません"
        );
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile =
        await liff.getProfile();

      const response = await fetch(
        `/api/performer/matches/${matchId}/cancel`,
        {
          method: "POST",
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
            "マッチングのキャンセルに失敗しました"
        );
      }

      setMatch((currentMatch) => {
        if (!currentMatch) {
          return currentMatch;
        }

        return {
          ...currentMatch,
          status: "cancelled",
          performance_status:
            "cancelled",
        };
      });
    } catch (error) {
      console.error(
        "マッチングキャンセル処理エラー:",
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : "マッチングのキャンセルに失敗しました"
      );
    } finally {
      setCancelling(false);
    }
  }

  function formatDate(date: string) {
    const [year, month, day] =
      date.split("-");

    return `${year}年${month}月${day}日`;
  }

  function formatTime(time: string) {
    return time.slice(0, 5);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <header>
            <p className="text-sm font-semibold text-gray-500">
              演奏マッチング
            </p>

            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              🎉 マッチング詳細
            </h1>
          </header>

          <div className="mt-8 rounded-2xl bg-white border border-gray-200 p-8 text-center shadow-sm">
            <div className="text-3xl">
              🎵
            </div>

            <p className="mt-3 text-sm text-gray-500">
              マッチング情報を読み込んでいます...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !match) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <header>
            <p className="text-sm font-semibold text-gray-500">
              演奏マッチング
            </p>

            <h1 className="mt-1 text-2xl font-bold text-gray-900">
              🎉 マッチング詳細
            </h1>
          </header>

          <div className="mt-6 rounded-2xl bg-red-50 border border-red-200 p-5">
            <p className="text-sm leading-6 text-red-600">
              {error ||
                "マッチング情報が見つかりません"}
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/performer/matches"
              )
            }
            className="w-full mt-5 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-700 shadow-sm active:bg-gray-50"
          >
            ← マッチング一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  const performanceRequest =
    match.performance_requests;

  const facility =
    performanceRequest?.facilities;

  if (!performanceRequest) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <div className="rounded-2xl bg-red-50 border border-red-200 p-5">
            <p className="text-sm text-red-600">
              案件の情報が見つかりません。
            </p>
          </div>

          <button
            onClick={() =>
              router.push(
                "/performer/matches"
              )
            }
            className="w-full mt-5 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-700 shadow-sm"
          >
            ← マッチング一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  const isCancelled =
    match.performance_status ===
    "cancelled";

  const isCompleted =
    match.performance_status ===
    "completed";

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 py-6">

        {/* 戻る */}
        <button
          onClick={() =>
            router.push(
              "/performer/matches"
            )
          }
          className="inline-flex items-center text-sm font-medium text-gray-500 active:text-gray-800"
        >
          ← マッチング一覧へ戻る
        </button>

        {/* ヘッダー */}
        <header className="mt-5">
          <p className="text-sm font-semibold text-gray-500">
            マッチング詳細
          </p>

          <h1 className="mt-1 text-2xl font-bold leading-8 text-gray-900">
            {performanceRequest.title}
          </h1>
        </header>

        {/* マッチング状態 */}
        <section
          className={`mt-5 rounded-2xl border p-5 ${
            isCancelled
              ? "bg-red-50 border-red-200"
              : isCompleted
                ? "bg-blue-50 border-blue-200"
                : "bg-green-50 border-green-200"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl ${
                isCancelled
                  ? "bg-white"
                  : isCompleted
                    ? "bg-white"
                    : "bg-white"
              }`}
            >
              {isCancelled
                ? "⚠️"
                : isCompleted
                  ? "✅"
                  : "🎉"}
            </div>

            <div>
              <p
                className={`font-bold ${
                  isCancelled
                    ? "text-red-700"
                    : isCompleted
                      ? "text-blue-700"
                      : "text-green-700"
                }`}
              >
                {isCancelled
                  ? "マッチングキャンセル"
                  : isCompleted
                    ? "演奏完了"
                    : "マッチング成立"}
              </p>

              <p
                className={`mt-1 text-sm ${
                  isCancelled
                    ? "text-red-600"
                    : isCompleted
                      ? "text-blue-600"
                      : "text-green-600"
                }`}
              >
                {isCancelled
                  ? "このマッチングはキャンセルされています。"
                  : isCompleted
                    ? "このマッチングでの演奏は完了しています。"
                    : "この施設への出演が決定しています。"}
              </p>
            </div>
          </div>
        </section>

        {/* 案件概要 */}
        <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
          <div className="grid grid-cols-2 gap-3">

            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs font-semibold text-gray-400">
                演奏日
              </p>

              <p className="mt-1 text-sm font-bold text-gray-900">
                📅{" "}
                {formatDate(
                  performanceRequest.performance_date
                )}
              </p>
            </div>

            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs font-semibold text-gray-400">
                時間
              </p>

              <p className="mt-1 text-sm font-bold text-gray-900">
                🕐{" "}
                {formatTime(
                  performanceRequest.start_time
                )}
              </p>

              <p className="text-xs text-gray-500">
                ～{" "}
                {formatTime(
                  performanceRequest.end_time
                )}
              </p>
            </div>

          </div>

          <div className="mt-3 rounded-xl bg-gray-50 p-4">
            <p className="text-xs font-semibold text-gray-400">
              演奏場所
            </p>

            {performanceRequest.area && (
              <p className="mt-1 text-sm font-bold text-gray-900">
                📍 {performanceRequest.area}
              </p>
            )}

            {facility?.address && (
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {facility.address}
              </p>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
            <span className="text-xs font-semibold text-gray-500">
              謝礼
            </span>

            <span className="text-lg font-bold text-gray-900">
              💰{" "}
              {performanceRequest.reward !== null
                ? `${performanceRequest.reward.toLocaleString()}円`
                : "要相談"}
            </span>
          </div>
        </section>

        {/* 演奏状況 */}
        <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">

          <h2 className="text-base font-bold text-gray-900">
            🎵 演奏状況
          </h2>

          {isCompleted ? (
            <div className="mt-4 rounded-xl bg-blue-50 border border-blue-200 p-4">
              <p className="font-bold text-blue-700">
                ✅ 演奏完了
              </p>

              {match.completed_at && (
                <p className="mt-1 text-xs text-blue-600">
                  完了日時：
                  {new Date(
                    match.completed_at
                  ).toLocaleString("ja-JP")}
                </p>
              )}
            </div>
          ) : isCancelled ? (
            <div className="mt-4 rounded-xl bg-gray-100 p-4">
              <p className="font-bold text-gray-600">
                キャンセル済み
              </p>

              <p className="mt-1 text-sm text-gray-500">
                この出演はキャンセルされています。
              </p>
            </div>
          ) : (
            <>
              <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-4">
                <p className="font-bold text-gray-800">
                  📅 演奏予定
                </p>

                <p className="mt-1 text-sm leading-6 text-gray-500">
                  演奏が終わったら、下のボタンから完了にしてください。
                </p>
              </div>

              <button
                onClick={handleComplete}
                disabled={
                  completing ||
                  cancelling
                }
                className="w-full mt-4 rounded-2xl bg-black px-5 py-4 text-sm font-bold text-white shadow-sm active:bg-gray-800 disabled:bg-gray-300"
              >
                {completing
                  ? "更新中..."
                  : "🎵 演奏完了にする"}
              </button>

              <button
                onClick={handleCancel}
                disabled={
                  completing ||
                  cancelling
                }
                className="w-full mt-3 rounded-2xl border border-red-200 bg-white px-5 py-4 text-sm font-bold text-red-600 active:bg-red-50 disabled:opacity-50"
              >
                {cancelling
                  ? "キャンセル中..."
                  : "⚠️ 出演をキャンセルする"}
              </button>

              <p className="mt-2 text-center text-xs leading-5 text-gray-400">
                ※ キャンセルすると、このマッチングでは出演できなくなります。
              </p>
            </>
          )}

        </section>

        {/* エラー */}
        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 border border-red-200 p-4">
            <p className="text-sm leading-6 text-red-600">
              {error}
            </p>
          </div>
        )}

        {/* 案件内容 */}
        <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">

          <p className="text-xs font-semibold text-gray-400">
            演奏案件
          </p>

          <h2 className="mt-1 text-lg font-bold text-gray-900">
            {performanceRequest.title}
          </h2>

          {performanceRequest.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-gray-700">
              {performanceRequest.description}
            </p>
          )}

        </section>

        {/* 募集条件 */}
        {(performanceRequest.instruments?.length >
          0 ||
          performanceRequest.genres?.length >
            0) && (
          <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">

            <h2 className="text-base font-bold text-gray-900">
              🎵 募集条件
            </h2>

            {performanceRequest.instruments?.length >
              0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-400">
                  募集楽器
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  {performanceRequest.instruments.map(
                    (instrument) => (
                      <span
                        key={instrument}
                        className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                      >
                        🎸 {instrument}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {performanceRequest.genres?.length >
              0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-400">
                  募集ジャンル
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  {performanceRequest.genres.map(
                    (genre) => (
                      <span
                        key={genre}
                        className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
                      >
                        🎵 {genre}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

          </section>
        )}

        {/* 施設情報 */}
        {facility && (
          <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">

            <p className="text-xs font-semibold text-gray-400">
              演奏先
            </p>

            <h2 className="mt-1 text-xl font-bold text-gray-900">
              🏢{" "}
              {facility.name ||
                "施設名未登録"}
            </h2>

            {facility.facility_type && (
              <p className="mt-1 text-sm text-gray-500">
                {facility.facility_type}
              </p>
            )}

            {facility.description && (
              <div className="mt-4 rounded-xl bg-gray-50 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
                  {facility.description}
                </p>
              </div>
            )}

          </section>
        )}

        {/* チャット */}
        <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">

          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xl">
              💬
            </div>

            <div>
              <h2 className="font-bold text-gray-900">
                施設との連絡
              </h2>

              <p className="mt-1 text-sm leading-6 text-gray-500">
                演奏時間や当日の流れなどを施設と確認できます。
              </p>
            </div>
          </div>

          <button
            onClick={() =>
              router.push(
                `/performer/matches/${matchId}/chat`
              )
            }
            disabled={
              match.status !== "active" ||
              match.performance_status ===
                "cancelled"
            }
            className="w-full mt-4 rounded-2xl bg-black px-5 py-4 text-sm font-bold text-white active:bg-gray-800 disabled:bg-gray-300"
          >
            💬 施設に連絡する
          </button>

        </section>

        {/* 評価 */}
        <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">

          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-yellow-50 text-xl">
              ⭐
            </div>

            <div>
              <h2 className="font-bold text-gray-900">
                施設を評価
              </h2>

              <p className="mt-1 text-xs text-gray-500">
                演奏後に施設への評価をお願いします。
              </p>
            </div>
          </div>

          {reviewed ? (
            <div className="mt-4 rounded-xl bg-gray-50 p-4">
              <p className="font-bold text-gray-700">
                評価済みです
              </p>

              <p className="mt-1 text-sm leading-6 text-gray-500">
                このマッチングはすでに評価しています。
              </p>
            </div>
          ) : (
            <button
              onClick={() =>
                router.push(
                  `/performer/matches/${matchId}/review`
                )
              }
              className="w-full mt-4 rounded-2xl bg-black px-5 py-4 text-sm font-bold text-white active:bg-gray-800"
            >
              ⭐ この施設を評価する
            </button>
          )}

        </section>

        {/* 下部ナビゲーション */}
        <button
          onClick={() =>
            router.push(
              "/performer/matches"
            )
          }
          className="w-full mt-6 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-600 shadow-sm active:bg-gray-50"
        >
          ← マッチング一覧に戻る
        </button>

        <p className="pb-5 pt-6 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>

      </div>
    </main>
  );
}