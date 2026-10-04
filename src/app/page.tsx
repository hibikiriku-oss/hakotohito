"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";

type LineProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

export default function Home() {
  const [profile, setProfile] = useState<LineProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function initLiff() {
      try {
        console.log("① LIFF初期化開始");

        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        console.log("② LIFF ID:", liffId);
        console.log("③ 現在のURL:", window.location.href);

        if (!liffId) {
          throw new Error(
            "NEXT_PUBLIC_LIFF_ID が設定されていません。"
          );
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        console.log("④ LIFF初期化完了");
        console.log("⑤ LINEアプリ内:", liff.isInClient());
        console.log("⑥ ログイン状態:", liff.isLoggedIn());

        if (!liff.isLoggedIn()) {
          console.log("⑦ LINEログイン開始");
          liff.login();
          return;
        }

        console.log("⑧ LINEログイン済み");

        const lineProfile = await liff.getProfile();

        console.log("⑨ プロフィール取得成功", lineProfile);

        setProfile({
          userId: lineProfile.userId,
          displayName: lineProfile.displayName,
          pictureUrl: lineProfile.pictureUrl,
        });

      } catch (err) {
        console.error("LIFF ERROR:", err);

        const message =
          err instanceof Error
            ? err.message
            : String(err);

        setError(message);

      } finally {
        setLoading(false);
      }
    }

    initLiff();
  }, []);

  // ★ここに移動
  const selectUserType = async (
    userType: "performer" | "facility"
  ) => {
    if (!profile) {
      alert("LINEプロフィールを取得できていません");
      return;
    }

    try {
      console.log("ユーザー種別登録開始:", userType);

      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lineUserId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl,
          userType,
        }),
      });

      console.log("APIレスポンス:", response.status);

      const data = await response.json();

      console.log("API結果:", data);

      if (!response.ok) {
        alert(data.error || "登録に失敗しました");
        return;
      }

      if (userType === "performer") {
        window.location.href = "/performer";
      } else {
        window.location.href = "/facility";
      }

    } catch (error) {
      console.error("APIエラー:", error);
      alert("通信エラーが発生しました");
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6">
        <h1 className="text-xl font-bold">
          読み込み中…
        </h1>

        <p className="mt-4 text-sm text-gray-500">
          LINEとの接続を確認しています
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen p-6">
        <div className="max-w-md mx-auto">

          <h1 className="text-xl font-bold text-red-600">
            エラーが発生しました
          </h1>

          <div className="mt-4 p-4 bg-red-50 rounded-xl">
            <pre className="text-sm whitespace-pre-wrap">
              {error}
            </pre>
          </div>

          <div className="mt-6 text-sm">
            <p>現在のURL：</p>
            <p className="break-all">
              {typeof window !== "undefined"
                ? window.location.href
                : ""}
            </p>
          </div>

        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        LINEログインが必要です。
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <h1 className="text-2xl font-bold mb-2">
          🎵 演奏マッチング
        </h1>

        <p className="text-gray-600 mb-8">
          楽器を演奏したい人と、
          演奏を聞きたい施設をつなぎます。
        </p>

        <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
          <p className="text-sm text-gray-500">
            LINEアカウント
          </p>

          <p className="text-lg font-bold">
            {profile.displayName}
          </p>
        </div>

        <h2 className="font-bold mb-3">
          あなたはどちらですか？
        </h2>

        <div className="space-y-3">

          <button
            onClick={() => selectUserType("performer")}
            className="w-full bg-black text-white rounded-xl p-4"
          >
            🎸 演奏したい
          </button>

          <button
            onClick={() => selectUserType("facility")}
            className="w-full bg-white border rounded-xl p-4"
          >
            🏢 演奏を依頼したい
          </button>

        </div>

      </div>
    </main>
  );
}