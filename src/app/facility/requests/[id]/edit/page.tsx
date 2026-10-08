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

export default function FacilityRequestEditPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [request, setRequest] =
    useState<PerformanceRequest | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [performanceDate, setPerformanceDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [area, setArea] = useState("");
  const [instruments, setInstruments] = useState("");
  const [genres, setGenres] = useState("");
  const [reward, setReward] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

      const loadedRequest =
        data.request as PerformanceRequest;

      if (loadedRequest.status !== "open") {
        setError(
          "マッチング済みまたは募集終了の案件は編集できません。"
        );
        setRequest(loadedRequest);
        return;
      }

      setRequest(loadedRequest);

      setTitle(loadedRequest.title || "");
      setDescription(loadedRequest.description || "");
      setPerformanceDate(
        loadedRequest.performance_date || ""
      );
      setStartTime(
        loadedRequest.start_time
          ? loadedRequest.start_time.slice(0, 5)
          : ""
      );
      setEndTime(
        loadedRequest.end_time
          ? loadedRequest.end_time.slice(0, 5)
          : ""
      );
      setArea(loadedRequest.area || "");
      setInstruments(
        loadedRequest.instruments?.join(", ") || ""
      );
      setGenres(
        loadedRequest.genres?.join(", ") || ""
      );
      setReward(
        loadedRequest.reward !== null &&
          loadedRequest.reward !== undefined
          ? String(loadedRequest.reward)
          : ""
      );
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

  function convertToArray(value: string) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function handleSave() {
    if (!title.trim()) {
      setError("案件タイトルを入力してください");
      return;
    }

    if (!performanceDate) {
      setError("演奏日を入力してください");
      return;
    }

    if (!startTime || !endTime) {
      setError("開始時間と終了時間を入力してください");
      return;
    }

    if (reward.trim() !== "") {
      const rewardNumber = Number(reward);

      if (Number.isNaN(rewardNumber)) {
        setError("報酬は数値で入力してください");
        return;
      }

      if (!Number.isInteger(rewardNumber)) {
        setError("報酬は整数で入力してください");
        return;
      }
    }

    try {
      setSaving(true);
      setError("");

      await liff.init({
        liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
      });

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile = await liff.getProfile();

      const instrumentsArray =
        convertToArray(instruments);

      const genresArray = convertToArray(genres);

      const rewardValue =
        reward.trim() === ""
          ? null
          : Number(reward);

      const response = await fetch(
        `/api/performance-requests/${requestId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-line-user-id": profile.userId,
          },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            performance_date: performanceDate,
            start_time: startTime,
            end_time: endTime,
            area: area.trim(),
            instruments: instrumentsArray,
            genres: genresArray,
            reward: rewardValue,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "案件の更新に失敗しました"
        );
      }

      alert("案件を更新しました");

      router.push(
        `/facility/requests/${requestId}`
      );
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("案件の更新に失敗しました");
      }
    } finally {
      setSaving(false);
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
              案件を編集できません
            </h1>

            <p className="mt-3 text-sm text-red-600">
              {error || "案件が見つかりませんでした"}
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (request.status !== "open") {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={() =>
              router.push(
                `/facility/requests/${requestId}`
              )
            }
            className="mb-6 text-sm text-blue-600"
          >
            ← 案件詳細に戻る
          </button>

          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">
              案件を編集できません
            </h1>

            <p className="mt-3 text-sm text-red-600">
              {error}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() =>
            router.push(
              `/facility/requests/${requestId}`
            )
          }
          className="mb-6 text-sm text-blue-600"
        >
          ← 案件詳細に戻る
        </button>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">
            案件を編集
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            案件の内容を変更できます。
          </p>

          {error && (
            <div className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                案件タイトル
              </label>

              <input
                type="text"
                value={title}
                onChange={(event) =>
                  setTitle(event.target.value)
                }
                placeholder="例：施設でのピアノ演奏"
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                案件内容
              </label>

              <textarea
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value)
                }
                rows={5}
                placeholder="演奏してほしい内容などを入力してください"
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                演奏日
              </label>

              <input
                type="date"
                value={performanceDate}
                onChange={(event) =>
                  setPerformanceDate(
                    event.target.value
                  )
                }
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  開始時間
                </label>

                <input
                  type="time"
                  value={startTime}
                  onChange={(event) =>
                    setStartTime(event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  終了時間
                </label>

                <input
                  type="time"
                  value={endTime}
                  onChange={(event) =>
                    setEndTime(event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                エリア
              </label>

              <input
                type="text"
                value={area}
                onChange={(event) =>
                  setArea(event.target.value)
                }
                placeholder="例：名古屋市"
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                希望する楽器
              </label>

              <input
                type="text"
                value={instruments}
                onChange={(event) =>
                  setInstruments(event.target.value)
                }
                placeholder="例：ピアノ, ギター, バイオリン"
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
              />

              <p className="mt-1 text-xs text-gray-500">
                複数ある場合はカンマ（,）で区切ってください。
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                希望するジャンル
              </label>

              <input
                type="text"
                value={genres}
                onChange={(event) =>
                  setGenres(event.target.value)
                }
                placeholder="例：クラシック, ジャズ"
                className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500"
              />

              <p className="mt-1 text-xs text-gray-500">
                複数ある場合はカンマ（,）で区切ってください。
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                報酬
              </label>

              <div className="relative mt-2">
                <input
                  type="number"
                  min="0"
                  value={reward}
                  onChange={(event) =>
                    setReward(event.target.value)
                  }
                  placeholder="例：5000"
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 pr-12 outline-none focus:border-blue-500"
                />

                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                  円
                </span>
              </div>

              <p className="mt-1 text-xs text-gray-500">
                未入力の場合は「応相談」として保存されます。
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/facility/requests/${requestId}`
                )
              }
              disabled={saving}
              className="rounded-xl border border-gray-300 bg-white px-4 py-3 font-medium text-gray-800 disabled:opacity-50"
            >
              キャンセル
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-50"
            >
              {saving ? "保存中..." : "変更を保存"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}