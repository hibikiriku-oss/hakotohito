"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type PerformanceRequest = {
  id: string;
  title: string;
  description: string | null;
  performance_date: string;
  application_deadline: string;
  start_time: string;
  end_time: string;
  area: string | null;
  instruments: string[];
  genres: string[];
  reward: number | null;
  status: "open" | "matched" | "closed";
};

function getJapanToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(date: string): string {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export default function FacilityRequestEditPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.id as string;

  const [request, setRequest] =
    useState<PerformanceRequest | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [performanceDate, setPerformanceDate] = useState("");
  const [applicationDeadline, setApplicationDeadline] =
    useState("");
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
    if (requestId) {
      void loadRequest();
    }
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

      setRequest(loadedRequest);

      if (loadedRequest.status !== "open") {
        setError(
          "マッチング済みまたは募集終了の案件は編集できません。"
        );
        return;
      }

      setTitle(loadedRequest.title || "");
      setDescription(loadedRequest.description || "");
      setPerformanceDate(loadedRequest.performance_date || "");
      setApplicationDeadline(
        loadedRequest.application_deadline || ""
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
      setInstruments(loadedRequest.instruments?.join(", ") || "");
      setGenres(loadedRequest.genres?.join(", ") || "");
      setReward(
        loadedRequest.reward !== null &&
          loadedRequest.reward !== undefined
          ? String(loadedRequest.reward)
          : ""
      );
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "案件情報を取得できませんでした"
      );
    } finally {
      setLoading(false);
    }
  }

  function convertToArray(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function handleSave() {
    setError("");

    if (!title.trim()) {
      setError("案件タイトルを入力してください");
      return;
    }

    if (!performanceDate) {
      setError("演奏日を入力してください");
      return;
    }

    if (!applicationDeadline) {
      setError("募集期限を入力してください");
      return;
    }

    if (performanceDate <= getJapanToday()) {
      setError("演奏日は明日以降の日付を指定してください");
      return;
    }

    if (applicationDeadline < getJapanToday()) {
      setError("募集期限は今日以降の日付を指定してください");
      return;
    }

    if (applicationDeadline >= performanceDate) {
      setError("募集期限は演奏日の前日までに設定してください");
      return;
    }

    if (!startTime || !endTime) {
      setError("開始時間と終了時間を入力してください");
      return;
    }

    if (reward.trim() !== "") {
      const rewardNumber = Number(reward);

      if (!Number.isFinite(rewardNumber)) {
        setError("報酬は数値で入力してください");
        return;
      }

      if (!Number.isInteger(rewardNumber) || rewardNumber < 0) {
        setError("報酬は0以上の整数で入力してください");
        return;
      }
    }

    try {
      setSaving(true);

      await liff.init({
        liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
      });

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile = await liff.getProfile();

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
            application_deadline: applicationDeadline,
            start_time: startTime,
            end_time: endTime,
            area: area.trim(),
            instruments: convertToArray(instruments),
            genres: convertToArray(genres),
            reward:
              reward.trim() === "" ? null : Number(reward),
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
      router.push(`/facility/requests/${requestId}`);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "案件の更新に失敗しました"
      );
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent";

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">
            ✏️ 案件を編集
          </h1>
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            案件情報を読み込んでいます…
          </div>
        </div>
      </main>
    );
  }

  if (!request || request.status !== "open") {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto px-4 py-6">
          <button
            type="button"
            onClick={() => router.push("/facility/requests")}
            className="text-sm text-gray-500 mb-5"
          >
            ← 案件一覧に戻る
          </button>
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h1 className="text-xl font-bold text-gray-900">
              案件を編集できません
            </h1>
            <p className="text-sm text-red-600 mt-3">
              {error || "案件が見つかりませんでした"}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">
        <header className="pb-6">
          <button
            type="button"
            onClick={() =>
              router.push(`/facility/requests/${requestId}`)
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
          <p className="text-sm text-gray-500 mt-2">
            案件の内容や募集期限を変更できます。
          </p>
        </header>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-100 rounded-2xl p-4">
            <p className="text-sm font-bold text-red-700">
              入力内容を確認してください
            </p>
            <p className="text-sm text-red-600 mt-1 leading-relaxed">
              {error}
            </p>
          </div>
        )}

        <div className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900">
              基本情報
            </h2>
            <p className="text-xs text-gray-400 mt-1 mb-5">
              演奏案件の基本的な情報を入力してください。
            </p>

            <div>
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                案件タイトル（必須）
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：施設でのピアノ演奏"
                className={inputClass}
              />
            </div>

            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                演奏日（必須）
              </label>
              <input
                type="date"
                value={performanceDate}
                min={getJapanToday()}
                onChange={(e) => setPerformanceDate(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="mt-5 rounded-xl bg-amber-50 border border-amber-200 p-4">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                ⏳ 募集期限（必須）
              </label>
              <input
                type="date"
                value={applicationDeadline}
                min={getJapanToday()}
                max={
                  performanceDate
                    ? (() => {
                        const d = new Date(
                          `${performanceDate}T00:00:00Z`
                        );
                        d.setUTCDate(d.getUTCDate() - 1);
                        return d.toISOString().slice(0, 10);
                      })()
                    : undefined
                }
                onChange={(e) =>
                  setApplicationDeadline(e.target.value)
                }
                className={inputClass}
              />
              <p className="text-xs text-gray-600 mt-2">
                現在の募集期限：
                {formatDate(request.application_deadline) || "未設定"}
              </p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                今日以降、演奏日の前日までを指定してください。
                募集期限を過ぎると演奏者は応募できなくなります。
              </p>
            </div>

            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                演奏時間（必須）
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 bg-gray-50"
                />
                <span className="text-gray-400">〜</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 bg-gray-50"
                />
              </div>
            </div>

            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                活動エリア
              </label>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="例：名古屋市"
                className={inputClass}
              />
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900">
              希望する演奏
            </h2>
            <p className="text-xs text-gray-400 mt-1 mb-5">
              希望する楽器や音楽ジャンルを設定してください。
            </p>

            <div>
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                希望する楽器
              </label>
              <input
                type="text"
                value={instruments}
                onChange={(e) => setInstruments(e.target.value)}
                placeholder="例：ピアノ, ギター, バイオリン"
                className={inputClass}
              />
              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」で区切ってください。
              </p>
            </div>

            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                希望するジャンル
              </label>
              <input
                type="text"
                value={genres}
                onChange={(e) => setGenres(e.target.value)}
                placeholder="例：クラシック, ジャズ"
                className={inputClass}
              />
              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」で区切ってください。
              </p>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-5">
              謝礼
            </h2>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                placeholder="例：5000"
                className={inputClass}
              />
              <span className="font-bold text-gray-600">円</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              未入力の場合は「応相談」として保存されます。
            </p>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-2">
              依頼内容
            </h2>
            <p className="text-xs text-gray-400 mt-1 mb-5">
              演奏してほしい内容やイベントについて記入してください。
            </p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder="演奏してほしい内容などを入力してください"
              className={`${inputClass} resize-none`}
            />
          </section>
        </div>

        <div className="mt-5 pb-6">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                router.push(`/facility/requests/${requestId}`)
              }
              disabled={saving}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5 font-bold text-gray-700 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-2xl bg-black px-4 py-3.5 font-bold text-white disabled:bg-gray-300"
            >
              {saving ? "保存中..." : "変更を保存"}
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