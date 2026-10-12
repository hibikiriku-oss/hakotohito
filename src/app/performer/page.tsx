"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";

export default function PerformerPage() {
  const [lineUserId, setLineUserId] = useState("");
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [instruments, setInstruments] = useState("");
  const [genres, setGenres] = useState("");
  const [bio, setBio] = useState("");

  const [loading, setLoading] = useState(false);

  // =========================
  // LINE / LIFF 初期化
  // =========================
  useEffect(() => {
    async function initLiff() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

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

        const profile = await liff.getProfile();

        console.log("LINEプロフィール:", profile);

        setLineUserId(profile.userId);
      } catch (error) {
        console.error("LIFF ERROR:", error);
        alert("LINE情報の取得に失敗しました");
      }
    }

    initLiff();
  }, []);

  // =========================
  // プロフィール登録
  // =========================
  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (!name || !area || !instruments || !genres) {
      alert("必須項目を入力してください");
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

      console.log("プロフィール登録開始");

      const response = await fetch("/api/performers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-user-id": lineUserId,
        },
        body: JSON.stringify({
          name,
          area,
          instruments: instruments
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          genres: genres
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          bio,
        }),
      });

      console.log("APIステータス:", response.status);

      const data = await response.json();

      console.log("API結果:", data);

      if (!response.ok) {
        alert(data.error || "登録に失敗しました");
        return;
      }

      alert("プロフィールを登録しました！");

      window.location.href = "/performer/home";
    } catch (error) {
      console.error("登録エラー:", error);
      alert("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // 画面
  // =========================
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 pt-6 pb-10">
        {/* ヘッダー */}
        <div className="mb-6">
          <div className="w-14 h-14 rounded-2xl bg-black text-white flex items-center justify-center text-3xl shadow-sm mb-4">
            🎸
          </div>

          <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
            演奏者として登録
          </p>

          <h1 className="text-2xl font-bold text-gray-900 leading-tight">
            演奏者プロフィール
          </h1>

          <p className="text-sm text-gray-500 mt-2 leading-6">
            施設に表示されるプロフィールを登録しましょう。
            あなたに演奏を依頼したい施設から見つけてもらいやすくなります。
          </p>
        </div>

        {/* 登録フォーム */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
        >
          <div className="p-5 space-y-6">
            {/* 基本情報 */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-sm">
                  👤
                </div>

                <div>
                  <p className="font-bold text-gray-900">
                    基本情報
                  </p>

                  <p className="text-xs text-gray-400 mt-0.5">
                    施設に表示される名前と活動エリア
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {/* 名前 */}
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-2">
                    名前
                    <span className="text-red-500 ml-1">
                      *
                    </span>
                  </label>

                  <input
                    type="text"
                    value={name}
                    onChange={(e) =>
                      setName(e.target.value)
                    }
                    placeholder="例：山田太郎"
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                  />
                </div>

                {/* 活動エリア */}
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-2">
                    活動エリア
                    <span className="text-red-500 ml-1">
                      *
                    </span>
                  </label>

                  <input
                    type="text"
                    value={area}
                    onChange={(e) =>
                      setArea(e.target.value)
                    }
                    placeholder="例：名古屋市"
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100" />

            {/* 演奏情報 */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-sm">
                  🎵
                </div>

                <div>
                  <p className="font-bold text-gray-900">
                    演奏情報
                  </p>

                  <p className="text-xs text-gray-400 mt-0.5">
                    得意な楽器や音楽ジャンル
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {/* 楽器 */}
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-2">
                    楽器
                    <span className="text-red-500 ml-1">
                      *
                    </span>
                  </label>

                  <input
                    type="text"
                    value={instruments}
                    onChange={(e) =>
                      setInstruments(e.target.value)
                    }
                    placeholder="例：ギター, ピアノ"
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                  />

                  <p className="text-xs text-gray-400 mt-2">
                    複数ある場合は「,」で区切ってください
                  </p>
                </div>

                {/* ジャンル */}
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-2">
                    音楽ジャンル
                    <span className="text-red-500 ml-1">
                      *
                    </span>
                  </label>

                  <input
                    type="text"
                    value={genres}
                    onChange={(e) =>
                      setGenres(e.target.value)
                    }
                    placeholder="例：J-POP, クラシック"
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                  />

                  <p className="text-xs text-gray-400 mt-2">
                    複数ある場合は「,」で区切ってください
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100" />

            {/* 自己紹介 */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-sm">
                  💬
                </div>

                <div>
                  <p className="font-bold text-gray-900">
                    自己紹介
                  </p>

                  <p className="text-xs text-gray-400 mt-0.5">
                    演奏経験や活動内容など
                  </p>
                </div>
              </div>

              <textarea
                value={bio}
                onChange={(e) =>
                  setBio(e.target.value)
                }
                placeholder="演奏経験や活動内容などを入力してください"
                rows={5}
                className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 outline-none resize-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100 leading-6"
              />
            </div>
          </div>

          {/* 登録エリア */}
          <div className="bg-gray-50 border-t border-gray-100 p-5">
            <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">
                  💡
                </span>

                <p className="text-xs text-gray-500 leading-5">
                  登録したプロフィールは、演奏を依頼したい施設から確認できます。
                  名前・活動エリア・楽器・ジャンルは必須項目です。
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white rounded-2xl py-4 font-bold shadow-sm transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  登録中...
                </span>
              ) : (
                "プロフィールを登録する"
              )}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}