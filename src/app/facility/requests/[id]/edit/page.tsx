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
  request_type: string;
  participation_fee: number | null;
  rental_fee: number | null;
  target_levels: string[] | null;
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

const PARTICIPATION_TYPES = ["live", "festival", "session"];

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
  const [participationFee, setParticipationFee] = useState("");
  const [rentalFee, setRentalFee] = useState("");
  const [targetLevels, setTargetLevels] = useState<string[]>([
    "beginner",
    "amateur",
    "pro",
  ]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isParticipationType =
    !!request && PARTICIPATION_TYPES.includes(request.request_type);
  const isRental = request?.request_type === "rental";

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
          data.error || "オファー情報を取得できませんでした"
        );
      }

      const loadedRequest =
        data.request as PerformanceRequest;

      setRequest(loadedRequest);

      if (loadedRequest.status !== "open") {
        setError(
          "マッチング済みまたは募集終了のオファーは編集できません。"
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
      setParticipationFee(
        loadedRequest.participation_fee !== null &&
          loadedRequest.participation_fee !== undefined
          ? String(loadedRequest.participation_fee)
          : ""
      );
      setRentalFee(
        loadedRequest.rental_fee !== null &&
          loadedRequest.rental_fee !== undefined
          ? String(loadedRequest.rental_fee)
          : ""
      );

      // 旧案件で募集対象ランクが未設定の場合は、従来の応募仕様に合わせて全ランクを選択する。
      const validTargetLevels = ["beginner", "amateur", "pro"];
      const savedTargetLevels = Array.isArray(loadedRequest.target_levels)
        ? loadedRequest.target_levels.filter((level) =>
            validTargetLevels.includes(level)
          )
        : [];

      setTargetLevels(
        savedTargetLevels.length > 0
          ? Array.from(new Set(savedTargetLevels))
          : validTargetLevels
      );
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "オファー情報を取得できませんでした"
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

  function validateOptionalFee(
    value: string,
    label: string
  ): number | null {
    if (value.trim() === "") return null;

    const number = Number(value);

    if (!Number.isInteger(number) || number < 0) {
      throw new Error(`${label}は0以上の整数で入力してください`);
    }

    return number;
  }

  async function handleSave() {
    setError("");

    if (!title.trim()) {
      setError("オファータイトルを入力してください");
      return;
    }

    if (targetLevels.length === 0) {
      setError("募集対象ランクを1つ以上選択してください");
      return;
    }

    if (!performanceDate) {
      setError("開催日を入力してください");
      return;
    }

    if (!applicationDeadline) {
      setError("募集期限を入力してください");
      return;
    }

    if (performanceDate <= getJapanToday()) {
      setError("開催日は明日以降の日付を指定してください");
      return;
    }

    if (applicationDeadline < getJapanToday()) {
      setError("募集期限は今日以降の日付を指定してください");
      return;
    }

    if (applicationDeadline >= performanceDate) {
      setError("募集期限は開催日の前日までに設定してください");
      return;
    }

    if (!startTime || !endTime) {
      setError("開始時間と終了時間を入力してください");
      return;
    }

    if (reward.trim() !== "") {
      const rewardNumber = Number(reward);

      if (!Number.isInteger(rewardNumber) || rewardNumber < 0) {
        setError("謝礼は0以上の整数で入力してください");
        return;
      }
    }

    let participationFeeNumber: number | null = null;
    let rentalFeeNumber: number | null = null;

    try {
      if (isParticipationType) {
        participationFeeNumber = validateOptionalFee(
          participationFee,
          "参加費"
        );
      }

      if (isRental) {
        rentalFeeNumber = validateOptionalFee(
          rentalFee,
          "レンタル利用料金"
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "料金の入力を確認してください"
      );
      return;
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
            participation_fee: participationFeeNumber,
            rental_fee: rentalFeeNumber,
            target_levels: targetLevels,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "オファーの更新に失敗しました"
        );
      }

      alert("オファーを更新しました");
      router.push(`/facility/requests/${requestId}`);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "オファーの更新に失敗しました"
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
            ✏️ オファーを編集
          </h1>
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            オファー情報を読み込んでいます…
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
            ← オファー一覧に戻る
          </button>
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h1 className="text-xl font-bold text-gray-900">
              オファーを編集できません
            </h1>
            <p className="text-sm text-red-600 mt-3">
              {error || "オファーが見つかりませんでした"}
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
            ← オファー詳細に戻る
          </button>

          <p className="text-sm font-medium text-gray-500">
            オファー管理
          </p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            ✏️ オファーを編集
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            オファーの内容や料金、募集期限を変更できます。
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
              オファーの基本的な情報を入力してください。
            </p>

            <div>
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                オファータイトル（必須）
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
                開催日・利用日（必須）
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
                今日以降、開催日の前日までを指定してください。
                募集期限を過ぎると演奏者は応募できなくなります。
              </p>
            </div>

            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                開始時間・終了時間（必須）
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
                エリア
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
            <h2 className="font-bold text-gray-900">
              募集対象ランク
            </h2>
            <p className="text-xs text-gray-500 mt-1 mb-4">
              応募できる演奏者のランクを選択してください。複数選択できます。
            </p>
            <div className="space-y-3">
              {[
                { value: "beginner", label: "初心者" },
                { value: "amateur", label: "アマチュア" },
                { value: "pro", label: "プロ" },
              ].map((level) => (
                <label
                  key={level.value}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 p-3"
                >
                  <input
                    type="checkbox"
                    checked={targetLevels.includes(level.value)}
                    onChange={(event) => {
                      setTargetLevels((current) =>
                        event.target.checked
                          ? [...current, level.value]
                          : current.filter((item) => item !== level.value)
                      );
                    }}
                    className="h-4 w-4 accent-black"
                  />
                  <span className="text-sm font-medium text-gray-800">
                    {level.label}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {request.request_type !== "rental" && (
            <section className="bg-white border border-gray-200 rounded-2xl p-5">
              <h2 className="font-bold text-gray-900 mb-5">
                演奏者への謝礼
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
          )}

          {isParticipationType && (
            <section className="bg-white border border-gray-200 rounded-2xl p-5">
              <h2 className="font-bold text-gray-900 mb-2">
                参加費
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                参加者が支払う料金を設定できます。
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={participationFee}
                  onChange={(e) =>
                    setParticipationFee(e.target.value)
                  }
                  placeholder="例：1000"
                  className={inputClass}
                />
                <span className="font-bold text-gray-600">円</span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                未入力の場合は参加費未設定として保存されます。
              </p>
            </section>
          )}

          {isRental && (
            <section className="bg-white border border-gray-200 rounded-2xl p-5">
              <h2 className="font-bold text-gray-900 mb-2">
                レンタル利用料金
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                施設を利用するための料金を設定できます。
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={rentalFee}
                  onChange={(e) => setRentalFee(e.target.value)}
                  placeholder="例：3000"
                  className={inputClass}
                />
                <span className="font-bold text-gray-600">円</span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                未入力の場合はレンタル利用料金未設定として保存されます。
              </p>
            </section>
          )}

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-2">
              オファー内容
            </h2>
            <p className="text-xs text-gray-400 mt-1 mb-5">
              オファーの詳細やイベント、施設利用について記入してください。
            </p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder="オファーの詳細を入力してください"
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