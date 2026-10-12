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

  const [title, setTitle] =
    useState("");

  const [description, setDescription] =
    useState("");

  const [performanceDate, setPerformanceDate] =
    useState("");

  const [startTime, setStartTime] =
    useState("");

  const [endTime, setEndTime] =
    useState("");

  const [area, setArea] =
    useState("");

  const [instruments, setInstruments] =
    useState("");

  const [genres, setGenres] =
    useState("");

  const [reward, setReward] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

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

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "案件情報を取得できませんでした"
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

      setTitle(
        loadedRequest.title || ""
      );

      setDescription(
        loadedRequest.description || ""
      );

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

      setArea(
        loadedRequest.area || ""
      );

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
        setError(
          "案件情報を取得できませんでした"
        );
      }
    } finally {
      setLoading(false);
    }
  }

  function convertToArray(
    value: string
  ) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function handleSave() {
    if (!title.trim()) {
      setError(
        "案件タイトルを入力してください"
      );
      return;
    }

    if (!performanceDate) {
      setError(
        "演奏日を入力してください"
      );
      return;
    }

    if (!startTime || !endTime) {
      setError(
        "開始時間と終了時間を入力してください"
      );
      return;
    }

    if (reward.trim() !== "") {
      const rewardNumber =
        Number(reward);

      if (Number.isNaN(rewardNumber)) {
        setError(
          "報酬は数値で入力してください"
        );
        return;
      }

      if (!Number.isInteger(rewardNumber)) {
        setError(
          "報酬は整数で入力してください"
        );
        return;
      }
    }

    try {
      setSaving(true);
      setError("");

      await liff.init({
        liffId:
          process.env.NEXT_PUBLIC_LIFF_ID!,
      });

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile =
        await liff.getProfile();

      const instrumentsArray =
        convertToArray(instruments);

      const genresArray =
        convertToArray(genres);

      const rewardValue =
        reward.trim() === ""
          ? null
          : Number(reward);

      const response =
        await fetch(
          `/api/performance-requests/${requestId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
              "x-line-user-id":
                profile.userId,
            },
            body: JSON.stringify({
              title: title.trim(),
              description:
                description.trim(),
              performance_date:
                performanceDate,
              start_time: startTime,
              end_time: endTime,
              area: area.trim(),
              instruments:
                instrumentsArray,
              genres: genresArray,
              reward: rewardValue,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "案件の更新に失敗しました"
        );
      }

      alert(
        "案件を更新しました"
      );

      router.push(
        `/facility/requests/${requestId}`
      );
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(
          "案件の更新に失敗しました"
        );
      }
    } finally {
      setSaving(false);
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
              ✏️ 案件を編集
            </h1>
          </header>

          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            <div className="text-3xl">
              ✏️
            </div>

            <p className="text-sm text-gray-500 mt-3">
              案件情報を読み込んでいます…
            </p>
          </div>

        </div>
      </main>
    );
  }

  if (!request) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">

          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm text-gray-500 mb-5"
          >
            ← 戻る
          </button>

          <div className="bg-white border border-gray-200 rounded-2xl p-6">

            <div className="text-3xl">
              ⚠️
            </div>

            <h1 className="text-xl font-bold text-gray-900 mt-3">
              案件を編集できません
            </h1>

            <p className="text-sm text-red-600 mt-3 leading-relaxed">
              {error ||
                "案件が見つかりませんでした"}
            </p>

          </div>

        </div>
      </main>
    );
  }

  if (request.status !== "open") {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">

          <button
            type="button"
            onClick={() =>
              router.push(
                `/facility/requests/${requestId}`
              )
            }
            className="text-sm text-gray-500 mb-5"
          >
            ← 案件詳細に戻る
          </button>

          <div className="bg-white border border-gray-200 rounded-2xl p-6">

            <div className="text-3xl">
              🔒
            </div>

            <h1 className="text-xl font-bold text-gray-900 mt-3">
              案件を編集できません
            </h1>

            <p className="text-sm text-red-600 mt-3 leading-relaxed">
              {error}
            </p>

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
                `/facility/requests/${requestId}`
              )
            }
            className="text-sm text-gray-500 mb-4"
          >
            ← 案件詳細に戻る
          </button>

          <p className="text-sm font-medium text-gray-500">
            案件管理
          </p>

          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            ✏️ 案件を編集
          </h1>

          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            案件の内容を変更できます。
          </p>

        </header>

        {/* エラー */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-100 rounded-2xl p-4">
            <div className="flex gap-3">

              <span className="text-xl">
                ⚠️
              </span>

              <div>
                <p className="text-sm font-bold text-red-700">
                  入力内容を確認してください
                </p>

                <p className="text-sm text-red-600 mt-1 leading-relaxed">
                  {error}
                </p>
              </div>

            </div>
          </div>
        )}

        <div className="space-y-4">

          {/* 基本情報 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">

            <div className="mb-5">
              <h2 className="font-bold text-gray-900">
                基本情報
              </h2>

              <p className="text-xs text-gray-400 mt-1">
                演奏案件の基本的な情報を入力してください。
              </p>
            </div>

            {/* タイトル */}
            <div>
              <label className="flex items-center gap-2 font-bold text-sm text-gray-800 mb-2">
                案件タイトル

                <span className="text-[10px] font-bold text-red-500 bg-red-50 rounded-full px-2 py-0.5">
                  必須
                </span>
              </label>

              <input
                type="text"
                value={title}
                onChange={(event) =>
                  setTitle(
                    event.target.value
                  )
                }
                placeholder="例：施設でのピアノ演奏"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />
            </div>

            {/* 演奏日 */}
            <div className="mt-5">
              <label className="flex items-center gap-2 font-bold text-sm text-gray-800 mb-2">
                演奏日

                <span className="text-[10px] font-bold text-red-500 bg-red-50 rounded-full px-2 py-0.5">
                  必須
                </span>
              </label>

              <input
                type="date"
                value={performanceDate}
                onChange={(event) =>
                  setPerformanceDate(
                    event.target.value
                  )
                }
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />
            </div>

            {/* 演奏時間 */}
            <div className="mt-5">
              <label className="flex items-center gap-2 font-bold text-sm text-gray-800 mb-2">
                演奏時間

                <span className="text-[10px] font-bold text-red-500 bg-red-50 rounded-full px-2 py-0.5">
                  必須
                </span>
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) =>
                    setStartTime(
                      event.target.value
                    )
                  }
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
                />

                <span className="text-gray-400 font-medium">
                  〜
                </span>

                <input
                  type="time"
                  value={endTime}
                  onChange={(event) =>
                    setEndTime(
                      event.target.value
                    )
                  }
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
                />
              </div>
            </div>

            {/* エリア */}
            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                活動エリア
              </label>

              <input
                type="text"
                value={area}
                onChange={(event) =>
                  setArea(
                    event.target.value
                  )
                }
                placeholder="例：名古屋市"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />
            </div>

          </section>

          {/* 希望条件 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">

            <div className="mb-5">
              <h2 className="font-bold text-gray-900">
                希望する演奏
              </h2>

              <p className="text-xs text-gray-400 mt-1">
                希望する楽器や音楽ジャンルを設定してください。
              </p>
            </div>

            {/* 楽器 */}
            <div>
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                希望する楽器
              </label>

              <input
                type="text"
                value={instruments}
                onChange={(event) =>
                  setInstruments(
                    event.target.value
                  )
                }
                placeholder="例：ピアノ, ギター, バイオリン"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />

              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」で区切ってください
              </p>
            </div>

            {/* ジャンル */}
            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                希望するジャンル
              </label>

              <input
                type="text"
                value={genres}
                onChange={(event) =>
                  setGenres(
                    event.target.value
                  )
                }
                placeholder="例：クラシック, ジャズ"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />

              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」で区切ってください
              </p>
            </div>

          </section>

          {/* 謝礼 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">

            <div className="mb-5">
              <h2 className="font-bold text-gray-900">
                謝礼
              </h2>

              <p className="text-xs text-gray-400 mt-1">
                演奏に対する謝礼を設定できます。
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={reward}
                onChange={(event) =>
                  setReward(
                    event.target.value
                  )
                }
                placeholder="例：5000"
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />

              <span className="font-bold text-gray-600">
                円
              </span>
            </div>

            <p className="text-xs text-gray-400 mt-2">
              未入力の場合は「応相談」として保存されます。
            </p>

          </section>

          {/* 詳細 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">

            <div className="mb-5">
              <h2 className="font-bold text-gray-900">
                依頼内容
              </h2>

              <p className="text-xs text-gray-400 mt-1">
                演奏してほしい内容やイベントについて記入してください。
              </p>
            </div>

            <textarea
              value={description}
              onChange={(event) =>
                setDescription(
                  event.target.value
                )
              }
              rows={6}
              placeholder="演奏してほしい内容などを入力してください"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent resize-none"
            />

          </section>

        </div>

        {/* アクション */}
        <div className="mt-5 pb-6">

          <div className="grid grid-cols-2 gap-3">

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/facility/requests/${requestId}`
                )
              }
              disabled={saving}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5 font-bold text-gray-700 shadow-sm disabled:opacity-50"
            >
              キャンセル
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-2xl bg-black px-4 py-3.5 font-bold text-white shadow-sm active:scale-[0.99] transition disabled:bg-gray-300 disabled:text-gray-500"
            >
              {saving
                ? "保存中..."
                : "変更を保存"}
            </button>

          </div>

          <p className="text-center text-xs text-gray-400 mt-3">
            変更内容を確認してから保存してください。
          </p>

        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          演奏者と施設をつなぐ、演奏マッチング
        </p>

      </div>
    </main>
  );
}