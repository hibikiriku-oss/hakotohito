"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";

export default function FacilityRequestPage() {
  const [lineUserId, setLineUserId] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [performanceDate, setPerformanceDate] =
    useState("");

  const [startTime, setStartTime] =
    useState("");

  const [endTime, setEndTime] =
    useState("");

  const [area, setArea] = useState("");
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
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <h1 className="text-2xl font-bold mb-2">
          🎵 演奏依頼を作成
        </h1>

        <p className="text-gray-600 mb-6">
          演奏してくれる方を募集するための依頼を登録してください。
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* タイトル */}
          <div>
            <label className="block font-bold mb-1">
              依頼タイトル
            </label>

            <input
              type="text"
              value={title}
              onChange={(e) =>
                setTitle(e.target.value)
              }
              placeholder="例：施設でのピアノ演奏"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 日付 */}
          <div>
            <label className="block font-bold mb-1">
              演奏日
            </label>

            <input
              type="date"
              value={performanceDate}
              onChange={(e) =>
                setPerformanceDate(
                  e.target.value
                )
              }
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 開始時間 */}
          <div>
            <label className="block font-bold mb-1">
              開始時間
            </label>

            <input
              type="time"
              value={startTime}
              onChange={(e) =>
                setStartTime(
                  e.target.value
                )
              }
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 終了時間 */}
          <div>
            <label className="block font-bold mb-1">
              終了時間
            </label>

            <input
              type="time"
              value={endTime}
              onChange={(e) =>
                setEndTime(
                  e.target.value
                )
              }
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* エリア */}
          <div>
            <label className="block font-bold mb-1">
              活動エリア
            </label>

            <input
              type="text"
              value={area}
              onChange={(e) =>
                setArea(e.target.value)
              }
              placeholder="例：名古屋市"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 楽器 */}
          <div>
            <label className="block font-bold mb-1">
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
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください
            </p>
          </div>

          {/* ジャンル */}
          <div>
            <label className="block font-bold mb-1">
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
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください
            </p>
          </div>

          {/* 謝礼 */}
          <div>
            <label className="block font-bold mb-1">
              謝礼
            </label>

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
                className="w-full border rounded-xl p-3 bg-white"
              />

              <span>
                円
              </span>
            </div>

            <p className="text-xs text-gray-500 mt-1">
              無償の場合は空欄でも登録できます
            </p>
          </div>

          {/* 詳細 */}
          <div>
            <label className="block font-bold mb-1">
              依頼内容
            </label>

            <textarea
              value={description}
              onChange={(e) =>
                setDescription(
                  e.target.value
                )
              }
              placeholder="演奏してほしい内容、施設のイベント内容など"
              rows={5}
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 登録ボタン */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
          >
            {loading
              ? "登録中..."
              : "演奏依頼を登録する"}
          </button>

        </form>
      </div>
    </main>
  );
}