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
  facilities?: {
    name: string | null;
    facility_type: string | null;
    address: string | null;
    description: string | null;
  } | null;
};

function formatDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(timeString: string) {
  if (!timeString) {
    return "";
  }

  return timeString.slice(0, 5);
}

function getStatusLabel(status: PerformanceRequest["status"]) {
  switch (status) {
    case "open":
      return "募集中";
    case "matched":
      return "マッチング済み";
    case "closed":
      return "募集終了";
    default:
      return status;
  }
}

export default function FacilityRequestDetailPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [request, setRequest] = useState<PerformanceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestId) {
      return;
    }

    loadRequest();
  }, [requestId]);

  async function loadRequest() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        `/api/performance-requests/${requestId}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "案件情報を取得できませんでした"
        );
      }

      setRequest(data.request);
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("案件情報を取得できませんでした");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!request) {
      return;
    }

    const confirmed = window.confirm(
      "この案件を削除しますか？\n\n応募者がいる場合、その応募情報も削除されます。\nこの操作は元に戻せません。"
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      setError("");

      let lineUserId = "";

      try {
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        lineUserId = profile.userId;
      } catch (error) {
        console.error("LINE認証エラー:", error);

        setError(
          "LINEユーザー情報を取得できませんでした"
        );

        setDeleting(false);
        return;
      }

      const response = await fetch(
        `/api/performance-requests/${requestId}`,
        {
          method: "DELETE",
          headers: {
            "x-line-user-id": lineUserId,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "案件の削除に失敗しました"
        );
      }

      alert("案件を削除しました");

      router.push("/facility/requests");
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("案件の削除に失敗しました");
      }
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-2xl">
          <p className="text-center text-gray-600">
            案件情報を読み込んでいます...
          </p>
        </div>
      </main>
    );
  }

  if (!request) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-6 text-sm text-blue-600"
          >
            ← 戻る
          </button>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">
              案件を表示できません
            </h1>

            <p className="mt-3 text-sm text-red-600">
              {error || "案件が見つかりませんでした"}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const canEdit = request.status === "open";

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() => router.push("/facility/requests")}
          className="mb-6 text-sm text-blue-600"
        >
          ← 案件一覧に戻る
        </button>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="border-b border-gray-100 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-blue-600">
                  演奏案件
                </p>

                <h1 className="mt-2 text-2xl font-bold text-gray-900">
                  {request.title}
                </h1>
              </div>

              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                  request.status === "open"
                    ? "bg-green-100 text-green-700"
                    : request.status === "matched"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {getStatusLabel(request.status)}
              </span>
            </div>
          </div>

          <div className="space-y-6 p-6">
            <section>
              <h2 className="text-sm font-bold text-gray-500">
                案件内容
              </h2>

              <p className="mt-2 whitespace-pre-wrap text-gray-800">
                {request.description || "説明はありません"}
              </p>
            </section>

            <section className="rounded-xl bg-gray-50 p-4">
              <h2 className="text-sm font-bold text-gray-500">
                演奏日時
              </h2>

              <p className="mt-2 font-medium text-gray-900">
                {formatDate(request.performance_date)}
              </p>

              <p className="mt-1 text-gray-800">
                {formatTime(request.start_time)}
                {" ～ "}
                {formatTime(request.end_time)}
              </p>
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500">
                エリア
              </h2>

              <p className="mt-2 text-gray-900">
                {request.area || "指定なし"}
              </p>
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500">
                希望する楽器
              </h2>

              {request.instruments &&
              request.instruments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {request.instruments.map((instrument) => (
                    <span
                      key={instrument}
                      className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700"
                    >
                      {instrument}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-gray-900">
                  指定なし
                </p>
              )}
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500">
                希望するジャンル
              </h2>

              {request.genres &&
              request.genres.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {request.genres.map((genre) => (
                    <span
                      key={genre}
                      className="rounded-full bg-purple-50 px-3 py-1 text-sm text-purple-700"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-gray-900">
                  指定なし
                </p>
              )}
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500">
                報酬
              </h2>

              <p className="mt-2 text-xl font-bold text-gray-900">
                {request.reward !== null
                  ? `${request.reward.toLocaleString()}円`
                  : "応相談"}
              </p>
            </section>

            {request.facilities && (
              <section className="border-t border-gray-100 pt-6">
                <h2 className="text-sm font-bold text-gray-500">
                  施設情報
                </h2>

                <div className="mt-3 space-y-2">
                  <p className="font-medium text-gray-900">
                    {request.facilities.name || "施設名未設定"}
                  </p>

                  {request.facilities.facility_type && (
                    <p className="text-sm text-gray-600">
                      種別：{request.facilities.facility_type}
                    </p>
                  )}

                  {request.facilities.address && (
                    <p className="text-sm text-gray-600">
                      住所：{request.facilities.address}
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>

          <div className="border-t border-gray-100 p-6">
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/facility/requests/${requestId}/applications`
                )
              }
              className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white"
            >
              👥 応募者を見る
            </button>

            {canEdit && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      `/facility/requests/${requestId}/edit`
                    )
                  }
                  className="rounded-xl border border-gray-300 bg-white px-4 py-3 font-medium text-gray-800"
                >
                  ✏️ 編集
                </button>

                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-xl border border-red-200 bg-white px-4 py-3 font-medium text-red-600 disabled:opacity-50"
                >
                  {deleting ? "削除中..." : "🗑️ 削除"}
                </button>
              </div>
            )}

            {!canEdit && (
              <p className="mt-4 text-center text-sm text-gray-500">
                マッチング済みまたは募集終了のため、編集・削除できません。
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}