
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Performer = {
  id: string;
  name?: string | null;
  area?: string | null;
  areas?: string[] | null;
  instruments?: string[] | null;
  genres?: string[] | null;
  bio?: string | null;
  status_level?: string | null;
  users?: {
    display_name?: string | null;
    picture_url?: string | null;
  } | null;
};

type LessonOffer = {
  id: string;
  performer_id: string;
  title: string;
  description?: string | null;
  instruments?: string[] | null;
  genres?: string[] | null;
  area?: string | null;
  lesson_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  lesson_fee: number;
  capacity: number;
  target_levels?: string[] | null;
  status: string;
  created_at?: string;
  is_mine: boolean;
  performers?: Performer | Performer[] | null;
};

function listText(values?: string[] | null) {
  return values?.length ? values.join("、") : "指定なし";
}

function formatDate(value?: string | null) {
  if (!value) return "未設定";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export default function LessonDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const offerId = params.id;

  const [offer, setOffer] = useState<LessonOffer | null>(null);
  const [lineUserId, setLineUserId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadOffer = useCallback(async (userId: string) => {
    try {
      const response = await fetch(
        `/api/lesson-offers/${offerId}`,
        {
          headers: {
            "x-line-user-id": userId,
          },
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "レッスン募集を取得できませんでした"
        );
      }

      setOffer(data.offer);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "レッスン募集を取得できませんでした"
      );
    } finally {
      setLoading(false);
    }
  }, [offerId]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("LIFF IDが設定されていません");
        }

        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();

        if (cancelled) return;

        setLineUserId(profile.userId);
        await loadOffer(profile.userId);
      } catch (e) {
        if (cancelled) return;

        setError(
          e instanceof Error
            ? e.message
            : "初期化に失敗しました"
        );
        setLoading(false);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [loadOffer]);

  async function handleApply() {
    if (!offer || !lineUserId || applying) return;

    if (offer.is_mine) {
      setError("自分が募集したレッスンには応募できません");
      return;
    }

    if (offer.status !== "open") {
      setError("このレッスンは現在募集していません");
      return;
    }

    setApplying(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/lesson-offers/${offer.id}/applications`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-user-id": lineUserId,
          },
          body: JSON.stringify({ message: message.trim() }),
        }
      );

      const data = await response.json();

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error || "応募できませんでした"
        );
      }

      setNotice("レッスンに応募しました！");
      setMessage("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "応募に失敗しました"
      );
    } finally {
      setApplying(false);
    }
  }

  function handleEdit() {
    if (!offer?.is_mine) {
      setError("自分が募集したレッスンだけ編集できます");
      return;
    }

    router.push(`/performer/lesson/${offer.id}/edit`);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <p className="py-12 text-center">読み込み中…</p>
      </main>
    );
  }

  if (!offer) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <button
          type="button"
          onClick={() => router.push("/performer/lesson")}
          className="mb-4 rounded-lg border px-4 py-2"
        >
          ← レッスン一覧に戻る
        </button>
        <p className="rounded-lg bg-red-50 p-4 text-red-700">
          {error || "レッスン募集が見つかりません"}
        </p>
      </main>
    );
  }

  const performer = Array.isArray(offer.performers)
    ? offer.performers[0]
    : offer.performers;

  const teacherName =
    performer?.users?.display_name ||
    performer?.name ||
    "演奏者";

  const isOpen = offer.status === "open";

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 pb-10">
      <button
        type="button"
        onClick={() => router.push("/performer/lesson")}
        className="rounded-lg border px-4 py-2 text-sm"
      >
        ← レッスン一覧に戻る
      </button>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {notice && (
        <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      )}

      <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {(offer.target_levels ?? []).length > 0 ? (
            offer.target_levels!.map((level) => (
              <span
                key={level}
                className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700"
              >
                {level}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
              対象レベル指定なし
            </span>
          )}

          <span
            className={`rounded-full px-3 py-1 text-sm ${
              isOpen
                ? "bg-green-50 text-green-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {isOpen ? "募集中" : "募集終了"}
          </span>
        </div>

        <h1 className="text-2xl font-bold">{offer.title}</h1>

        <div className="rounded-xl bg-gray-50 p-4">
          <p className="text-sm text-gray-500">レッスン料金</p>
          <p className="text-2xl font-bold">
            {offer.lesson_fee === 0
              ? "無料"
              : `¥${offer.lesson_fee.toLocaleString("ja-JP")}`}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm text-gray-500">先生</p>
            <p className="font-semibold">{teacherName}</p>
            {performer?.status_level && (
              <p className="mt-1 text-sm text-gray-600">
                レベル：{performer.status_level}
              </p>
            )}
            {performer?.bio && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                {performer.bio}
              </p>
            )}
          </div>

          <div>
            <p className="text-sm text-gray-500">楽器</p>
            <p>{listText(offer.instruments)}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">ジャンル</p>
            <p>{listText(offer.genres)}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">開催エリア</p>
            <p>{offer.area || "未設定"}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">開催日</p>
            <p>{formatDate(offer.lesson_date)}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">時間</p>
            <p>
              {offer.start_time || "未設定"}
              {" ～ "}
              {offer.end_time || "未設定"}
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-500">募集人数</p>
            <p>{offer.capacity}人</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">レッスン内容</p>
            <p className="whitespace-pre-wrap leading-7">
              {offer.description || "説明はありません"}
            </p>
          </div>
        </div>
      </section>

      {offer.is_mine ? (
        <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm leading-6 text-amber-900">
            これはあなたが募集しているレッスンです。
            募集内容を変更する場合は、下のボタンから編集してください。
          </p>
          <button
            type="button"
            onClick={handleEdit}
            className="w-full rounded-xl bg-black px-4 py-3 font-bold text-white"
          >
            ✏️ 募集内容を編集する
          </button>
        </section>
      ) : isOpen ? (
        <section className="space-y-3 rounded-2xl border p-5">
          <h2 className="text-lg font-bold">このレッスンに応募する</h2>
          <p className="text-sm leading-6 text-gray-600">
            先生へのメッセージを入力できます（任意）。
          </p>

          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={1000}
            rows={4}
            placeholder="例：ピアノを始めたばかりです。基礎から教えていただきたいです。"
            className="w-full rounded-lg border p-3 text-sm"
          />

          <button
            type="button"
            onClick={handleApply}
            disabled={applying || !lineUserId}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? "応募中…" : "このレッスンに応募する"}
          </button>

          <p className="text-xs leading-5 text-gray-500">
            応募時に、応募者側のコインが差し引かれることはありません。
          </p>
        </section>
      ) : (
        <section className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
          このレッスンは現在応募できません。
        </section>
      )}
    </main>
  );
}
