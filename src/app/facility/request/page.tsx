"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";

export default function FacilityRequestPage() {
  const [lineUserId, setLineUserId] =
    useState("");

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
    useState(false);

  useEffect(() => {
    async function initLiff() {
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

        console.log(
          "LINEプロフィール:",
          profile
        );

        setLineUserId(profile.userId);
      } catch (error) {
        console.error(
          "LIFF ERROR:",
          error
        );

        alert(
          "LINE情報の取得に失敗しました"
        );
      }
    }

    initLiff();
  }, []);

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (
      !title ||
      !performanceDate ||
      !startTime ||
      !endTime
    ) {
      alert(
        "必須項目を入力してください"
      );
      return;
    }

    if (startTime >= endTime) {
      alert(
        "終了時間は開始時間より後にしてください"
      );
      return;
    }

    if (!lineUserId) {
      alert(
        "LINEユーザー情報を取得中です。少し待ってから再度お試しください。"
      );
      return;
    }

    try {
      setLoading(true);

      console.log(
        "演奏依頼登録開始"
      );

      const response = await fetch(
        "/api/performance-requests",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            "x-line-user-id":
              lineUserId,
          },
          body: JSON.stringify({
            title,
            description,
            performanceDate,
            startTime,
            endTime,
            area,
            instruments:
              instruments
                .split(",")
                .map(
                  (item) =>
                    item.trim()
                )
                .filter(Boolean),
            genres:
              genres
                .split(",")
                .map(
                  (item) =>
                    item.trim()
                )
                .filter(Boolean),
            reward,
          }),
        }
      );

      console.log(
        "APIステータス:",
        response.status
      );

      const data =
        await response.json();

      console.log(
        "API結果:",
        data
      );

      if (!response.ok) {
        alert(
          data.error ||
            "登録に失敗しました"
        );
        return;
      }

      alert(
        "演奏依頼を登録しました！"
      );

      window.location.href =
        "/facility/home";
    } catch (error) {
      console.error(
        "登録エラー:",
        error
      );

      alert(
        "通信エラーが発生しました"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">

        {/* ヘッダー */}
        <header className="pb-6">

          <button
            type="button"
            onClick={() =>
              window.history.back()
            }
            className="text-sm text-gray-500 mb-4"
          >
            ← 戻る
          </button>

          <p className="text-sm font-medium text-gray-500">
            案件管理
          </p>

          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            🎵 演奏依頼を作成
          </h1>

          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            演奏してくれる方を募集するための依頼を登録してください。
          </p>

        </header>

        {/* フォーム */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

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
                依頼タイトル
                <span className="text-[10px] font-bold text-red-500 bg-red-50 rounded-full px-2 py-0.5">
                  必須
                </span>
              </label>

              <input
                type="text"
                value={title}
                onChange={(e) =>
                  setTitle(e.target.value)
                }
                placeholder="例：施設でのピアノ演奏"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />
            </div>

            {/* 日付 */}
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
                onChange={(e) =>
                  setPerformanceDate(
                    e.target.value
                  )
                }
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />
            </div>

            {/* 時間 */}
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
                  onChange={(e) =>
                    setStartTime(
                      e.target.value
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
                  onChange={(e) =>
                    setEndTime(
                      e.target.value
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
                onChange={(e) =>
                  setArea(e.target.value)
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
                演奏してほしい楽器や音楽ジャンルを入力してください。
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
                onChange={(e) =>
                  setInstruments(
                    e.target.value
                  )
                }
                placeholder="例：ピアノ, ギター"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent"
              />

              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」で区切ってください
              </p>
            </div>

            {/* ジャンル */}
            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                希望する音楽ジャンル
              </label>

              <input
                type="text"
                value={genres}
                onChange={(e) =>
                  setGenres(
                    e.target.value
                  )
                }
                placeholder="例：J-POP, クラシック"
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
                onChange={(e) =>
                  setReward(
                    e.target.value
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
              無償の場合は空欄でも登録できます
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
              onChange={(e) =>
                setDescription(
                  e.target.value
                )
              }
              placeholder="演奏してほしい内容、施設のイベント内容など"
              rows={6}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent resize-none"
            />

          </section>

          {/* 登録 */}
          <div className="pt-1 pb-6">

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white rounded-2xl p-4 font-bold shadow-sm active:scale-[0.99] transition disabled:bg-gray-300 disabled:text-gray-500"
            >
              {loading
                ? "登録中..."
                : "🎵 演奏依頼を登録する"}
            </button>

            <p className="text-center text-xs text-gray-400 mt-3 leading-relaxed">
              登録した依頼は「自分の依頼」から確認できます。
            </p>

          </div>

        </form>

      </div>
    </main>
  );
}