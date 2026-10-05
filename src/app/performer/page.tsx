<<<<<<< HEAD
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
      alert("LINEユーザー情報を取得中です。少し待ってから再度お試しください。");
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
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <h1 className="text-2xl font-bold mb-2">
          🎸 演奏者プロフィール
        </h1>

        <p className="text-gray-600 mb-6">
          演奏を依頼する施設に表示される情報です。
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* 名前 */}
          <div>
            <label className="block font-bold mb-1">
              名前
            </label>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：山田太郎"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 活動エリア */}
          <div>
            <label className="block font-bold mb-1">
              活動エリア
            </label>

            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="例：名古屋市"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 楽器 */}
          <div>
            <label className="block font-bold mb-1">
              楽器
            </label>

            <input
              type="text"
              value={instruments}
              onChange={(e) => setInstruments(e.target.value)}
              placeholder="例：ギター, ピアノ"
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください
            </p>
          </div>

          {/* ジャンル */}
          <div>
            <label className="block font-bold mb-1">
              音楽ジャンル
            </label>

            <input
              type="text"
              value={genres}
              onChange={(e) => setGenres(e.target.value)}
              placeholder="例：J-POP, クラシック"
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください
            </p>
          </div>

          {/* 自己紹介 */}
          <div>
            <label className="block font-bold mb-1">
              自己紹介
            </label>

            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="演奏経験や活動内容など"
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
              : "プロフィールを登録する"}
          </button>

        </form>

      </div>
    </main>
  );
=======
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
      alert("LINEユーザー情報を取得中です。少し待ってから再度お試しください。");
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
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <h1 className="text-2xl font-bold mb-2">
          🎸 演奏者プロフィール
        </h1>

        <p className="text-gray-600 mb-6">
          演奏を依頼する施設に表示される情報です。
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* 名前 */}
          <div>
            <label className="block font-bold mb-1">
              名前
            </label>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：山田太郎"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 活動エリア */}
          <div>
            <label className="block font-bold mb-1">
              活動エリア
            </label>

            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="例：名古屋市"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 楽器 */}
          <div>
            <label className="block font-bold mb-1">
              楽器
            </label>

            <input
              type="text"
              value={instruments}
              onChange={(e) => setInstruments(e.target.value)}
              placeholder="例：ギター, ピアノ"
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください
            </p>
          </div>

          {/* ジャンル */}
          <div>
            <label className="block font-bold mb-1">
              音楽ジャンル
            </label>

            <input
              type="text"
              value={genres}
              onChange={(e) => setGenres(e.target.value)}
              placeholder="例：J-POP, クラシック"
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください
            </p>
          </div>

          {/* 自己紹介 */}
          <div>
            <label className="block font-bold mb-1">
              自己紹介
            </label>

            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="演奏経験や活動内容など"
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
              : "プロフィールを登録する"}
          </button>

        </form>

      </div>
    </main>
  );
>>>>>>> d0c800a (initial commit)
}