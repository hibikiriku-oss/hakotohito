"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type Performer = {
  id: string;
  name: string | null;
  area: string | null;
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
  description: string | null;
  instruments: string[] | null;
  genres: string[] | null;
  area: string | null;
  lesson_date: string | null;
  start_time: string | null;
  end_time: string | null;
  lesson_fee: number;
  capacity: number;
  status: string;
  created_at: string;
  is_mine: boolean;
  target_levels?: string[] | null;
  performers: Performer | null;
};

type OfferFilter = "all" | "mine" | "others";

const instrumentOptions = [
  "ピアノ", "ギター", "ウクレレ", "バイオリン", "ビオラ",
  "チェロ", "コントラバス", "フルート", "クラリネット",
  "サックス", "トランペット", "トロンボーン", "リコーダー",
  "ハーモニカ", "オカリナ", "箏", "尺八", "和太鼓",
  "打楽器", "声楽・歌",
];

const genreOptions = [
  "クラシック", "ポップス", "ジャズ", "演歌・歌謡曲",
  "童謡・唱歌", "アニメ・ゲーム音楽", "映画音楽",
  "民謡", "邦楽", "ロック", "フォーク", "ゴスペル",
];

const levelOptions = ["初心者", "アマ", "プロ"];

const inputClass =
  "w-full border border-gray-200 rounded-xl px-3 py-3 bg-white text-gray-900 outline-none focus:ring-2 focus:ring-black";

function formatDate(date: string | null) {
  if (!date) return "日時未定";

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  return parsed.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export default function LessonListPage() {
  const router = useRouter();

  const [lineUserId, setLineUserId] = useState("");
  const [offers, setOffers] = useState<LessonOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [keyword, setKeyword] = useState("");
  const [area, setArea] = useState("");
  const [instrument, setInstrument] = useState("");
  const [genre, setGenre] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [applyingId, setApplyingId] = useState("");
  const [messageByOffer, setMessageByOffer] = useState<
    Record<string, string>
  >({});
  const [offerFilter, setOfferFilter] = useState<OfferFilter>("all");

  useEffect(() => {
    async function initLiff() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("NEXT_PUBLIC_LIFF_IDが設定されていません");
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineUserId(profile.userId);
      } catch (error) {
        console.error("レッスン一覧LIFFエラー:", error);
        setErrorMessage(
          "LINE情報の取得に失敗しました。LINEから画面を開き直してください。"
        );
        setLoading(false);
      }
    }

    initLiff();
  }, []);

  const fetchOffers = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams();

      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (area.trim()) params.set("area", area.trim());
      if (instrument) params.set("instrument", instrument);
      if (genre) params.set("genre", genre);

      const response = await fetch(
        `/api/lesson-offers?${params.toString()}`,
        {
          method: "GET",
          headers: lineUserId
            ? { "x-line-user-id": lineUserId }
            : {},
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "レッスン一覧の取得に失敗しました");
      }

      setOffers(Array.isArray(data.offers) ? data.offers : []);
    } catch (error) {
      console.error("レッスン一覧取得エラー:", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "レッスン一覧の取得に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }, [lineUserId, keyword, area, instrument, genre]);

  useEffect(() => {
    if (lineUserId) {
      fetchOffers();
    }
  }, [lineUserId, searchKey, fetchOffers]);

  const filteredOffers = offers.filter((offer) => {
    if (offerFilter === "mine") return offer.is_mine;
    if (offerFilter === "others") return !offer.is_mine;
    return true;
  });

  const handleApply = async (offer: LessonOffer) => {
    if (!lineUserId) {
      alert("LINEユーザー情報を取得できていません。画面を開き直してください。");
      return;
    }

    if (offer.is_mine) {
      alert("自分のレッスン募集には申し込めません。");
      return;
    }

    const confirmed = window.confirm(
      `「${offer.title}」に申し込みますか？\n\n` +
        `レッスン料：${
          offer.lesson_fee === 0
            ? "無料"
            : `${offer.lesson_fee.toLocaleString()}円`
        }\n\n` +
        "申し込みが成立すると、募集者にレッスン成立手数料が発生します。"
    );

    if (!confirmed) return;

    setApplyingId(offer.id);

    try {
      const response = await fetch(
        `/api/lesson-offers/${offer.id}/applications`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-user-id": lineUserId,
          },
          body: JSON.stringify({
            message: messageByOffer[offer.id]?.trim() || "",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || data.success === false) {
        alert(data.error || data.message || "申し込みに失敗しました");
        return;
      }

      const charged =
        typeof data.coins_charged === "number"
          ? data.coins_charged
          : null;

      alert(
        "レッスンへの申し込みが成立しました！" +
          (charged !== null
            ? `\n募集者の成立手数料：${charged}コイン`
            : "")
      );

      await fetchOffers();
    } catch (error) {
      console.error("レッスン申し込みエラー:", error);
      alert("通信エラーが発生しました。もう一度お試しください。");
    } finally {
      setApplyingId("");
    }
  };

  const clearSearch = () => {
    setKeyword("");
    setArea("");
    setInstrument("");
    setGenre("");
    setSearchKey((value) => value + 1);
  };

  const openDetails = (offer: LessonOffer) => {
    router.push(`/performer/lesson/${offer.id}`);
  };

  return (
    <main className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-md mx-auto px-4 py-5">
        <header className="mb-5">
          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="text-sm text-gray-500 mb-4"
          >
            ← ホームに戻る
          </button>

          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">演奏者向け</p>
              <h1 className="text-2xl font-bold text-gray-900 mt-1">
                🎹 レッスンを探す
              </h1>
              <p className="text-sm text-gray-500 mt-2">
                音楽を教えたい人と学びたい人をつなぎます。
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push("/performer/lesson/new")}
              className="shrink-0 bg-black text-white rounded-xl px-3 py-3 text-sm font-bold"
            >
              ＋ 募集する
            </button>
          </div>
        </header>

        <section className="bg-white border border-gray-200 rounded-2xl p-4 mb-5">
          <h2 className="font-bold text-gray-900 mb-3">
            条件を指定して探す
          </h2>

          <div className="space-y-3">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSearchKey((value) => value + 1);
                }
              }}
              placeholder="タイトル・レッスン内容"
              className={inputClass}
            />

            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="エリア（例：愛知県、名古屋市）"
              className={inputClass}
            />

            <select
              value={instrument}
              onChange={(e) => setInstrument(e.target.value)}
              className={inputClass}
            >
              <option value="">すべての楽器</option>
              {instrumentOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className={inputClass}
            >
              <option value="">すべてのジャンル</option>
              {genreOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSearchKey((value) => value + 1)}
                className="bg-black text-white rounded-xl py-3 font-bold"
              >
                検索する
              </button>
              <button
                type="button"
                onClick={clearSearch}
                className="border border-gray-300 rounded-xl py-3 font-bold text-gray-700"
              >
                条件をクリア
              </button>
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-2xl p-3 mb-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "all", label: "すべて" },
              { value: "mine", label: "自分の募集" },
              { value: "others", label: "他の人の募集" },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() =>
                  setOfferFilter(item.value as OfferFilter)
                }
                className={`rounded-xl px-2 py-3 text-sm font-bold ${
                  offerFilter === item.value
                    ? "bg-black text-white"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-900">レッスン募集一覧</h2>
          {!loading && (
            <span className="text-sm text-gray-500">
              {filteredOffers.length}件
            </span>
          )}
        </div>

        {loading && (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-gray-500">
            レッスンを読み込み中...
          </div>
        )}

        {!loading && errorMessage && (
          <div className="bg-white border border-red-200 rounded-2xl p-5">
            <p className="text-sm text-red-600">{errorMessage}</p>
            <button
              type="button"
              onClick={fetchOffers}
              className="mt-3 border border-gray-300 rounded-xl px-4 py-2 text-sm font-bold"
            >
              再読み込み
            </button>
          </div>
        )}

        {!loading && !errorMessage && filteredOffers.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-3">🎼</div>
            <p className="font-bold text-gray-800">
              該当するレッスン募集はありません
            </p>
            <p className="text-sm text-gray-500 mt-2">
              検索条件を変えるか、新しいレッスン募集を登録してください。
            </p>
            <button
              type="button"
              onClick={() => router.push("/performer/lesson/new")}
              className="mt-4 bg-black text-white rounded-xl px-4 py-3 text-sm font-bold"
            >
              レッスンを募集する
            </button>
          </div>
        )}

        {!loading && !errorMessage && filteredOffers.length > 0 && (
          <div className="space-y-4">
            {filteredOffers.map((offer) => {
              const teacher = offer.performers;
              const teacherName =
                teacher?.users?.display_name ||
                teacher?.name ||
                "演奏者";

              const targetLevels = (offer.target_levels || []).filter(
                (level) => levelOptions.includes(level)
              );

              return (
                <article
                  key={offer.id}
                  className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-bold text-gray-900 break-words">
                        {offer.title}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        講師：{teacherName}
                      </p>
                    </div>

                    {offer.is_mine && (
                      <span className="shrink-0 rounded-full bg-gray-100 text-gray-700 px-3 py-1 text-xs font-bold">
                        自分の募集
                      </span>
                    )}
                  </div>

                  <div className="mt-4 rounded-xl bg-gray-50 p-3">
                    <p className="text-2xl font-bold text-gray-900">
                      {offer.lesson_fee === 0
                        ? "無料"
                        : `${offer.lesson_fee.toLocaleString()}円`}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      1回あたりのレッスン料
                    </p>
                  </div>

                  <div className="mt-4">
                    <p className="text-sm font-bold text-gray-700 mb-2">
                      対象ランク
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {targetLevels.length > 0 ? (
                        targetLevels.map((level) => (
                          <span
                            key={level}
                            className="rounded-full bg-blue-50 text-blue-800 border border-blue-100 px-3 py-1 text-xs font-bold"
                          >
                            {level}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-gray-500">
                          指定なし
                        </span>
                      )}
                    </div>
                  </div>

                  {offer.description && (
                    <p className="text-sm text-gray-700 mt-4 whitespace-pre-wrap break-words">
                      {offer.description}
                    </p>
                  )}

                  <div className="mt-4 space-y-2 text-sm text-gray-700">
                    <p>
                      <span className="font-bold">📍 エリア：</span>
                      {offer.area || "未指定・オンライン等"}
                    </p>
                    <p>
                      <span className="font-bold">📅 日時：</span>
                      {formatDate(offer.lesson_date)}
                      {offer.start_time && offer.end_time
                        ? ` ${offer.start_time.slice(0, 5)}〜${offer.end_time.slice(0, 5)}`
                        : ""}
                    </p>
                    <p>
                      <span className="font-bold">👥 定員：</span>
                      {offer.capacity}人
                    </p>
                    <p>
                      <span className="font-bold">🎸 楽器：</span>
                      {offer.instruments?.length
                        ? offer.instruments.join("、")
                        : "未指定"}
                    </p>
                    <p>
                      <span className="font-bold">🎵 ジャンル：</span>
                      {offer.genres?.length
                        ? offer.genres.join("、")
                        : "未指定"}
                    </p>
                  </div>

                  {teacher?.bio && (
                    <div className="mt-4 border-t border-gray-100 pt-3">
                      <p className="text-xs font-bold text-gray-500 mb-1">
                        講師プロフィール
                      </p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {teacher.bio}
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => openDetails(offer)}
                    className="w-full mt-5 border border-gray-300 text-gray-900 rounded-xl py-3 font-bold hover:bg-gray-50"
                  >
                    募集の詳細を見る →
                  </button>

                  {!offer.is_mine && (
                    <div className="mt-5 border-t border-gray-100 pt-4">
                      <label
                        htmlFor={`lesson-message-${offer.id}`}
                        className="block text-sm font-bold text-gray-800 mb-2"
                      >
                        講師へのメッセージ（任意）
                      </label>
                      <textarea
                        id={`lesson-message-${offer.id}`}
                        value={messageByOffer[offer.id] || ""}
                        onChange={(e) =>
                          setMessageByOffer((previous) => ({
                            ...previous,
                            [offer.id]: e.target.value,
                          }))
                        }
                        placeholder="レッスンで学びたいことなど"
                        rows={2}
                        className={`${inputClass} resize-none`}
                      />

                      <button
                        type="button"
                        onClick={() => handleApply(offer)}
                        disabled={applyingId === offer.id || !lineUserId}
                        className="w-full mt-3 bg-black text-white rounded-xl py-3 font-bold disabled:bg-gray-300"
                      >
                        {applyingId === offer.id
                          ? "申し込み中..."
                          : "このレッスンに申し込む"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}