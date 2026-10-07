"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

export default function PerformerProfileEditPage() {
  const router = useRouter();

  const [lineUserId, setLineUserId] = useState("");

  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [instruments, setInstruments] = useState("");
  const [genres, setGenres] = useState("");
  const [bio, setBio] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // =========================
  // プロフィール取得
  // =========================
  const loadProfile = async (userId: string) => {
    try {
      const response = await fetch(
        "/api/performers/profile",
        {
          method: "GET",
          headers: {
            "x-line-user-id": userId,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "プロフィールの取得に失敗しました"
        );
      }

      const performer = data.performer;

      setName(performer.name || "");
      setArea(performer.area || "");

      setInstruments(
        Array.isArray(performer.instruments)
          ? performer.instruments.join(", ")
          : ""
      );

      setGenres(
        Array.isArray(performer.genres)
          ? performer.genres.join(", ")
          : ""
      );

      setBio(performer.bio || "");
    } catch (error) {
      console.error(
        "プロフィール取得エラー:",
        error
      );

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(
          "プロフィールの取得に失敗しました"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // LINE / LIFF 初期化
  // =========================
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

        setLineUserId(profile.userId);

        await loadProfile(profile.userId);
      } catch (error) {
        console.error(
          "LIFF初期化エラー:",
          error
        );

        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError(
            "LINE情報の取得に失敗しました"
          );
        }

        setLoading(false);
      }
    }

    initLiff();
  }, []);

  // =========================
  // プロフィール更新
  // =========================
  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

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
      setSaving(true);
      setError("");

      const response = await fetch(
        "/api/performers/profile",
        {
          method: "PATCH",
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
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "プロフィールの更新に失敗しました"
        );
      }

      alert("プロフィールを更新しました！");

      router.push("/performer/home");
    } catch (error) {
      console.error(
        "プロフィール更新エラー:",
        error
      );

      if (error instanceof Error) {
        setError(error.message);
        alert(error.message);
      } else {
        setError(
          "プロフィールの更新に失敗しました"
        );
        alert(
          "プロフィールの更新に失敗しました"
        );
      }
    } finally {
      setSaving(false);
    }
  };

  // =========================
  // 読み込み中
  // =========================
  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-center text-gray-600">
            プロフィールを読み込み中...
          </p>
        </div>
      </main>
    );
  }

  // =========================
  // エラー
  // =========================
  if (error && !name && !area) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h1 className="text-xl font-bold mb-4">
              プロフィール編集
            </h1>

            <p className="text-red-600 whitespace-pre-wrap">
              {error}
            </p>

            <button
              type="button"
              onClick={() =>
                router.push("/performer/home")
              }
              className="w-full mt-6 bg-black text-white rounded-xl p-4 font-bold"
            >
              戻る
            </button>
          </div>
        </div>
      </main>
    );
  }

  // =========================
  // 画面
  // =========================
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">
        <button
          type="button"
          onClick={() =>
            router.push("/performer/home")
          }
          className="text-gray-600 mb-4"
        >
          ← 戻る
        </button>

        <h1 className="text-2xl font-bold mb-2">
          🎸 プロフィール編集
        </h1>

        <p className="text-gray-600 mb-6">
          施設に表示されるプロフィールを編集できます。
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
              onChange={(event) =>
                setName(event.target.value)
              }
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
              onChange={(event) =>
                setArea(event.target.value)
              }
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
              onChange={(event) =>
                setInstruments(event.target.value)
              }
              placeholder="例：ギター, ピアノ"
              className="w-full border rounded-xl p-3 bg-white"
            />

            <p className="text-xs text-gray-500 mt-1">
              複数ある場合は「,」で区切ってください
            </p>
          </div>

          {/* 音楽ジャンル */}
          <div>
            <label className="block font-bold mb-1">
              音楽ジャンル
            </label>

            <input
              type="text"
              value={genres}
              onChange={(event) =>
                setGenres(event.target.value)
              }
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
              onChange={(event) =>
                setBio(event.target.value)
              }
              placeholder="演奏経験や活動内容など"
              rows={5}
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* エラー */}
          {error && (
            <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">
              {error}
            </div>
          )}

          {/* 更新ボタン */}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
          >
            {saving
              ? "更新中..."
              : "プロフィールを更新する"}
          </button>
        </form>
      </div>
    </main>
  );
}
