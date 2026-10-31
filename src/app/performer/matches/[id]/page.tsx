"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
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
  band_id: string | null;
  band: {
    id: string;
    name: string | null;
    description: string | null;
    status: string;
  } | null;
  isBandLeader: boolean;
  matched_at: string;
  status: string;
  performance_status: "scheduled" | "completed" | "cancelled";
  completed_at: string | null;
  performer_completion_reported_at: string | null;
  facility_completion_reported_at: string | null;
  completion_disputed_at: string | null;
  completion_disputed_by: string | null;
  completion_dispute_reason: string | null;
  completion_dispute_facility_agreed_at: string | null;
  completion_dispute_performer_agreed_at: string | null;
  completion_method: string | null;
  performance_requests: PerformanceRequest | null;
};

export default function PerformerMatchDetailPage() {
  const router = useRouter();
  const params = useParams();
  const matchId = params.id as string;

  const [match, setMatch] = useState<Match | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agreeingDispute, setAgreeingDispute] = useState(false);

  useEffect(() => {
    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("LINE MINI Appの設定がありません");
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const idToken = liff.getIDToken();

        if (!idToken) {
          throw new Error(
            "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
          );
        }

        const response = await fetch(
          `/api/performer/matches/${matchId}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
            cache: "no-store",
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "マッチング情報の取得に失敗しました"
          );
        }

        setMatch(data.match);

        const reviewResponse = await fetch(
          `/api/reviews?match_id=${matchId}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
            cache: "no-store",
          }
        );

        if (reviewResponse.ok) {
          const reviewData = await reviewResponse.json();
          setReviewed(reviewData.reviewed === true);
        }
      } catch (err) {
        console.error("マッチング詳細取得エラー:", err);
        setError(
          err instanceof Error
            ? err.message
            : "マッチング情報の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, [matchId]);

  async function handleComplete() {
    if (!match || completing) return;

    const confirmed = window.confirm(
      "演奏完了を報告しますか？\n\n双方の報告がそろうと、演奏完了が確定します。"
    );

    if (!confirmed) return;

    try {
      setCompleting(true);
      setError("");
      setNotice("");

      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

      if (!liffId) {
        throw new Error("LINE MINI Appの設定がありません");
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken = liff.getIDToken();

      if (!idToken) {
        throw new Error(
          "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
        );
      }

      const response = await fetch(
        `/api/performer/matches/${matchId}/complete`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "演奏完了の報告に失敗しました"
        );
      }

      setNotice(
        data.completed
          ? "双方の報告がそろい、演奏完了が確定しました。"
          : data.message ||
              "演奏完了を報告しました。施設側の確認を待っています。"
      );

      const refreshIdToken = liff.getIDToken();

      if (!refreshIdToken) {
        throw new Error(
          "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
        );
      }

      const refreshResponse = await fetch(
        `/api/performer/matches/${matchId}`,
        {
          headers: {
            Authorization: `Bearer ${refreshIdToken}`,
          },
          cache: "no-store",
        }
      );

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        throw new Error(
          refreshData.error ||
            "最新の演奏状況を取得できませんでした"
        );
      }

      setMatch(refreshData.match);
    } catch (err) {
      console.error("演奏完了報告エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "演奏完了の報告に失敗しました"
      );
    } finally {
      setCompleting(false);
    }
  }

  async function handleAgreeDispute() {
    if (!match || agreeingDispute) return;

    if (match.completion_dispute_performer_agreed_at) {
      setNotice(
        "演奏者側はすでに同意済みです。施設側の同意を待っています。"
      );
      return;
    }

    const confirmed = window.confirm(
      "異議申し立ての取り下げに同意しますか？\n\n双方が同意すると異議申し立てが解除され、演奏完了の報告を再開できます。\n\n一度同意すると、現在の仕組みでは取り消せません。内容を確認してから同意してください。"
    );

    if (!confirmed) return;

    try {
      setAgreeingDispute(true);
      setError("");
      setNotice("");

      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

      if (!liffId) {
        throw new Error("LINE MINI Appの設定がありません");
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken = liff.getIDToken();

      if (!idToken) {
        throw new Error(
          "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
        );
      }

      const response = await fetch(
        `/api/performer/matches/${matchId}/dispute/agree`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "取り下げへの同意に失敗しました"
        );
      }

      setNotice(
        data.message ||
          "同意を記録しました。相手側の同意を待っています。"
      );

      const refreshResponse = await fetch(
        `/api/performer/matches/${matchId}`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          cache: "no-store",
        }
      );

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        throw new Error(
          refreshData.error ||
            "最新の演奏状況を取得できませんでした"
        );
      }

      setMatch(refreshData.match);
    } catch (err) {
      console.error(
        "異議申し立て取り下げ同意エラー:",
        err
      );
      setError(
        err instanceof Error
          ? err.message
          : "取り下げへの同意に失敗しました"
      );
    } finally {
      setAgreeingDispute(false);
    }
  }

  async function handleCancel() {
    if (!match || cancelling) return;

    const confirmed = window.confirm(
      "この出演をキャンセルしますか？\n\nキャンセルすると、このマッチングでは演奏できなくなります。"
    );

    if (!confirmed) return;

    try {
      setCancelling(true);
      setError("");
      setNotice("");

      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

      if (!liffId) {
        throw new Error("LINE MINI Appの設定がありません");
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const idToken = liff.getIDToken();

      if (!idToken) {
        throw new Error(
          "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
        );
      }

      const response = await fetch(
        `/api/performer/matches/${matchId}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "マッチングのキャンセルに失敗しました"
        );
      }

      setMatch((currentMatch) => {
        if (!currentMatch) return currentMatch;

        return {
          ...currentMatch,
          status: "cancelled",
          performance_status: "cancelled",
        };
      });

      setNotice(
        data.message || "マッチングをキャンセルしました。"
      );
    } catch (err) {
      console.error("マッチングキャンセル処理エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "マッチングのキャンセルに失敗しました"
      );
    } finally {
      setCancelling(false);
    }
  }

  function formatDate(date: string) {
    const [year, month, day] = date.split("-");
    return `${year}年${month}月${day}日`;
  }

  function formatTime(time: string) {
    return time.slice(0, 5);
  }

  function formatDateTime(date: string) {
    const value = new Date(date);

    return (
      value.getFullYear() +
      "年" +
      (value.getMonth() + 1) +
      "月" +
      value.getDate() +
      "日 " +
      value.getHours() +
      ":" +
      String(value.getMinutes()).padStart(2, "0")
    );
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
            <div className="text-3xl">🎵</div>
            <p className="mt-3 text-sm text-gray-500">
              マッチング情報を読み込んでいます...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error && !match) {
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
              {error}
            </p>
          </div>

          <button
            onClick={() => router.push("/performer/matches")}
            className="w-full mt-5 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-700 shadow-sm active:bg-gray-50"
          >
            ← マッチング一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  if (!match) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <div className="rounded-2xl bg-red-50 border border-red-200 p-5">
            <p className="text-sm text-red-600">
              マッチング情報が見つかりません。
            </p>
          </div>

          <button
            onClick={() => router.push("/performer/matches")}
            className="w-full mt-5 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-700 shadow-sm"
          >
            ← マッチング一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  const performanceRequest = match.performance_requests;
  const facility = performanceRequest?.facilities;

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
            onClick={() => router.push("/performer/matches")}
            className="w-full mt-5 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-700 shadow-sm"
          >
            ← マッチング一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  const japanDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const japanYear =
    japanDateParts.find((part) => part.type === "year")?.value ?? "";
  const japanMonth =
    japanDateParts.find((part) => part.type === "month")?.value ?? "";
  const japanDay =
    japanDateParts.find((part) => part.type === "day")?.value ?? "";

  const japanToday = `${japanYear}-${japanMonth}-${japanDay}`;
  const performanceDate =
    performanceRequest.performance_date?.slice(0, 10) ?? "";

  const isBeforePerformanceDate =
    !!performanceDate && performanceDate > japanToday;

  // 個人マッチングは本人が操作可能。
  // バンドマッチングはAPIが返すリーダー情報に基づいて表示を制御する。
  const canManageMatch = !match.band_id || match.isBandLeader;

  const isCancelled =
    match.performance_status === "cancelled";
  const isCompleted =
    match.performance_status === "completed";
  const isDisputed = Boolean(match.completion_disputed_at);

  const performerReported = Boolean(
    match.performer_completion_reported_at
  );
  const facilityReported = Boolean(
    match.facility_completion_reported_at
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 py-6">
        <button
          onClick={() => router.push("/performer/matches")}
          className="inline-flex items-center text-sm font-medium text-gray-500 active:text-gray-800"
        >
          ← マッチング一覧へ戻る
        </button>

        <header className="mt-5">
          <p className="text-sm font-semibold text-gray-500">
            マッチング詳細
          </p>
          <h1 className="mt-1 text-2xl font-bold leading-8 text-gray-900">
            {performanceRequest.title}
          </h1>
        </header>

        {match.band && (
          <section className="mt-4 rounded-2xl border border-purple-100 bg-purple-50 p-4">
            <p className="text-xs font-bold text-purple-700">
              🎸 バンド応募
            </p>

            <h2 className="mt-1 text-lg font-bold text-purple-900">
              {match.band.name || "バンド名未設定"}
            </h2>

            {match.band.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-purple-800">
                {match.band.description}
              </p>
            )}

            <p className="mt-2 text-xs text-purple-700">
              {match.band.status === "disbanded"
                ? "このバンドは解散済みです。ここでは過去のマッチング状況のみ確認できます。"
                : match.isBandLeader
                  ? "あなたはこのバンドのリーダーです"
                  : "バンドメンバーとして参加しています"}
            </p>

            {match.band.status === "active" && (
              <button
                type="button"
                onClick={() =>
                  router.push(`/performer/bands/${match!.band!.id}/chat`)
                }
                className="mt-3 w-full rounded-xl bg-purple-700 py-3 font-bold text-white"
              >
                💬 バンドチャットを開く
              </button>
            )}
          </section>
        )}

        {!canManageMatch && (
          <div className="mt-4 rounded-xl border border-purple-100 bg-white p-4">
            <p className="text-sm font-bold text-purple-900">
              バンドメンバーとして参加しています
            </p>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              演奏完了報告・キャンセル・異議申し立て・施設評価などの操作は、バンドリーダーが代表して行います。
            </p>
          </div>
        )}

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
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl">
              {isCancelled ? "⚠️" : isCompleted ? "✅" : "🎉"}
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

        <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs font-semibold text-gray-400">
                演奏日
              </p>
              <p className="mt-1 text-sm font-bold text-gray-900">
                📅 {formatDate(performanceRequest.performance_date)}
              </p>
            </div>

            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs font-semibold text-gray-400">
                時間
              </p>
              <p className="mt-1 text-sm font-bold text-gray-900">
                🕐 {formatTime(performanceRequest.start_time)}
              </p>
              <p className="text-xs text-gray-500">
                ～ {formatTime(performanceRequest.end_time)}
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

        {/* 演奏完了の報告状況 */}
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
                <p className="mt-2 text-xs text-blue-600">
                  完了日時：{formatDateTime(match.completed_at)}
                </p>
              )}

              <div className="mt-4 space-y-3 text-sm">
                <p className="text-green-700">
                  演奏者側：報告済み
                  {match.performer_completion_reported_at &&
                    `（${formatDateTime(match.performer_completion_reported_at)}）`}
                </p>
                <p className="text-green-700">
                  施設側：報告済み
                  {match.facility_completion_reported_at &&
                    `（${formatDateTime(match.facility_completion_reported_at)}）`}
                </p>
              </div>

              <p className="mt-3 text-sm text-gray-600">
                双方の報告がそろい、演奏完了が確定しています。
              </p>
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
          ) : isDisputed ? (
            <>
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4">
                <p className="font-bold text-amber-800">
                  ⚠️ 演奏完了について異議申し立て中
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-700">
                  異議申し立てが行われているため、完了報告はできません。
                  内容を確認し、施設とご相談ください。
                </p>

                {match.completion_dispute_reason && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-gray-700">
                      申し立て理由
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-gray-700">
                      {match.completion_dispute_reason}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-xl bg-white border border-amber-200 p-4">
                <p className="font-bold text-gray-800">
                  🤝 取り下げへの同意状況
                </p>

                <p className="mt-3 text-sm">
                  施設側：
                  {match.completion_dispute_facility_agreed_at ? (
                    <span className="text-green-700 font-bold">
                      ✅ 同意済み
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      未同意
                    </span>
                  )}
                </p>

                <p className="mt-2 text-sm">
                  演奏者側：
                  {match.completion_dispute_performer_agreed_at ? (
                    <span className="text-green-700 font-bold">
                      ✅ 同意済み
                    </span>
                  ) : (
                    <span className="text-gray-500">
                      未同意
                    </span>
                  )}
                </p>

                {match.completion_dispute_performer_agreed_at ? (
                  <div className="mt-4 rounded-lg bg-green-50 p-3">
                    <p className="text-sm font-bold text-green-700">
                      演奏者側は同意済みです
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      施設側の同意がそろうと、異議申し立てが解除されます。
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="mt-3 text-sm text-gray-600">
                      双方が取り下げに同意すると、異議申し立てが解除され、演奏完了の報告を再開できます。
                    </p>

                    {canManageMatch ? (
                      <button
                        onClick={handleAgreeDispute}
                        disabled={agreeingDispute}
                        className="w-full mt-4 rounded-2xl bg-green-600 px-5 py-4 text-sm font-bold text-white shadow-sm disabled:opacity-50"
                      >
                        {agreeingDispute
                          ? "同意を登録中..."
                          : "🤝 取り下げに同意する"}
                      </button>
                    ) : (
                      <div className="mt-4 rounded-lg bg-gray-50 p-3">
                        <p className="text-sm text-gray-600">
                          取り下げへの同意は、バンドリーダーが代表して行います。
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-4">
                <p className="font-bold text-gray-800">
                  📋 双方の報告状況
                </p>

                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-lg border bg-white p-3">
                    <p className="font-medium">演奏者側の報告</p>
                    <p
                      className={`mt-1 ${
                        performerReported
                          ? "text-green-700"
                          : "text-gray-500"
                      }`}
                    >
                      {performerReported ? "✅ 報告済み" : "未報告"}
                    </p>
                    {match.performer_completion_reported_at && (
                      <p className="mt-1 text-xs text-gray-500">
                        {formatDateTime(
                          match.performer_completion_reported_at
                        )}
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border bg-white p-3">
                    <p className="font-medium">施設側の報告</p>
                    <p
                      className={`mt-1 ${
                        facilityReported
                          ? "text-green-700"
                          : "text-gray-500"
                      }`}
                    >
                      {facilityReported ? "✅ 報告済み" : "未報告"}
                    </p>
                    {match.facility_completion_reported_at && (
                      <p className="mt-1 text-xs text-gray-500">
                        {formatDateTime(
                          match.facility_completion_reported_at
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <p className="mt-4 text-sm leading-6 text-gray-600">
                  {performerReported && facilityReported
                    ? "双方の報告が記録されています。最新の状態を再読み込みしてください。"
                    : performerReported
                      ? "演奏者側は報告済みです。施設側の確認を待っています。"
                      : facilityReported
                        ? "施設側から完了報告が届いています。演奏が完了していることを確認して報告してください。"
                        : "演奏終了後、双方が完了報告を行います。双方の報告がそろうと演奏完了が確定します。"}
                </p>
              </div>

              {!performerReported ? (
                canManageMatch ? (
                  <>
                    <button
                      onClick={handleComplete}
                      disabled={
                        completing ||
                        cancelling ||
                        isBeforePerformanceDate
                      }
                      className="w-full mt-4 rounded-2xl bg-green-600 px-5 py-4 text-sm font-bold text-white shadow-sm active:bg-green-700 disabled:opacity-50"
                    >
                      {completing
                        ? "報告中..."
                        : "🎵 演奏完了を報告"}
                    </button>

                    {isBeforePerformanceDate && (
                      <p className="mt-2 text-sm text-amber-600">
                        演奏予定日当日以降に完了報告できます。
                      </p>
                    )}
                  </>
                ) : (
                  <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-4">
                    <p className="font-bold text-gray-700">
                      演奏者側は未報告です
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      バンドリーダーが代表して報告します。
                    </p>
                  </div>
                )
              ) : (
                <div className="mt-4 rounded-xl bg-green-50 border border-green-200 p-4">
                  <p className="font-bold text-green-700">
                    ✅ 演奏者側は報告済みです
                  </p>
                  {!facilityReported && (
                    <p className="mt-1 text-sm text-gray-600">
                      施設側の報告を待っています。
                    </p>
                  )}
                </div>
              )}

              {canManageMatch && (
                <>
                  <button
                    onClick={() =>
                      router.push(
                        `/performer/matches/${matchId}/dispute`
                      )
                    }
                    disabled={completing || cancelling}
                    className="w-full mt-4 rounded-2xl border border-amber-400 bg-white px-5 py-3 text-sm font-semibold text-amber-800 active:bg-amber-50 disabled:opacity-50"
                  >
                    ⚠️ 演奏完了に異議を申し立てる
                  </button>

                  <p className="mt-2 text-center text-xs leading-5 text-gray-400">
                    演奏が完了していない場合や、報告内容に相違がある場合に利用してください。
                  </p>

                  <button
                    onClick={handleCancel}
                    disabled={completing || cancelling}
                    className="w-full mt-5 rounded-2xl border border-red-200 bg-white px-5 py-4 text-sm font-bold text-red-600 active:bg-red-50 disabled:opacity-50"
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
            </>
          )}
        </section>

        {notice && (
          <div className="mt-4 rounded-2xl bg-green-50 border border-green-200 p-4">
            <p className="text-sm leading-6 text-green-700">
              {notice}
            </p>
          </div>
        )}

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
        {(performanceRequest.instruments?.length > 0 ||
          performanceRequest.genres?.length > 0) && (
          <section className="mt-4 rounded-2xl bg-white border border-gray-200 p-5 shadow-sm">
            <h2 className="text-base font-bold text-gray-900">
              🎵 募集条件
            </h2>

            {performanceRequest.instruments?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-400">
                  募集楽器
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {performanceRequest.instruments.map((instrument) => (
                    <span
                      key={instrument}
                      className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    >
                      🎸 {instrument}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {performanceRequest.genres?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-gray-400">
                  募集ジャンル
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {performanceRequest.genres.map((genre) => (
                    <span
                      key={genre}
                      className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
                    >
                      🎵 {genre}
                    </span>
                  ))}
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
              🏢 {facility.name || "施設名未登録"}
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

        {/* 個人マッチングでは施設とのチャットを表示。
            バンドマッチングはページ上部のバンドチャットを使用する。 */}
        {!match.band && (
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
                match.performance_status === "cancelled"
              }
              className="w-full mt-4 rounded-2xl bg-black px-5 py-4 text-sm font-bold text-white active:bg-gray-800 disabled:bg-gray-300"
            >
              💬 施設に連絡する
            </button>
          </section>
        )}

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

          {match.band_id && !canManageMatch ? (
            <div className="mt-4 rounded-xl bg-gray-50 p-4">
              <p className="font-bold text-gray-700">
                バンドリーダーが代表して施設を評価します
              </p>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                バンドの評価はリーダーに集約されます。
              </p>
            </div>
          ) : reviewed ? (
            <div className="mt-4 rounded-xl bg-gray-50 p-4">
              <p className="font-bold text-gray-700">
                評価済みです
              </p>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                このマッチングはすでに評価しています。
              </p>
            </div>
          ) : isCompleted ? (
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
          ) : (
            <div className="mt-4 rounded-xl bg-gray-50 p-4">
              <p className="font-bold text-gray-700">
                演奏完了後に評価できます
              </p>
              <p className="mt-1 text-sm leading-6 text-gray-500">
                双方の完了報告がそろうと、施設を評価できるようになります。
              </p>
            </div>
          )}
        </section>

        <button
          onClick={() => router.push("/performer/matches")}
          className="w-full mt-6 rounded-2xl bg-white border border-gray-200 px-5 py-4 text-sm font-semibold text-gray-600 shadow-sm active:bg-gray-50"
        >
          ← マッチング一覧へ戻る
        </button>

        <p className="pb-5 pt-6 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>
      </div>
    </main>
  );
}