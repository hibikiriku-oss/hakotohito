
"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";

type LineProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type UserType = "performer" | "facility";

type RegisteredUser = {
  id: string;
  user_type: UserType;
};

// スプラッシュ画面の最低表示時間
const MIN_SPLASH_DURATION_MS = 1600;

export default function Home() {
  const [profile, setProfile] = useState<LineProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function initLiff() {
      const startedAt = Date.now();
      let redirectingToLine = false;

      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "NEXT_PUBLIC_LIFF_ID が設定されていません。"
          );
        }

        // LINE LIFF 初期化
        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (cancelled) return;

        // 未ログインの場合はLINEログインへ移動
        if (!liff.isLoggedIn()) {
          redirectingToLine = true;

          liff.login({
            redirectUri: window.location.href,
          });

          return;
        }

        // LINEプロフィール取得
        const lineProfile = await liff.getProfile();

        if (cancelled) return;

        setProfile({
          userId: lineProfile.userId,
          displayName: lineProfile.displayName,
          pictureUrl: lineProfile.pictureUrl,
        });

        // サーバー側で本人確認するためのIDトークン
        const idToken = liff.getIDToken();

        if (!idToken) {
          throw new Error(
            "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
          );
        }

        // 登録済みアカウントの確認
        const response = await fetch("/api/users", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          cache: "no-store",
        });

        if (cancelled) return;

        if (response.ok) {
          const data = await response.json();
          const user = data.user as RegisteredUser;

          if (user.user_type === "performer") {
            window.location.replace("/performer");
            return;
          }

          if (user.user_type === "facility") {
            window.location.replace("/facility");
            return;
          }

          throw new Error(
            "登録済みユーザーの種別が不正です。"
          );
        }

        // 404 は未登録ユーザーとして扱う
        if (response.status !== 404) {
          const data = await response.json().catch(() => ({}));

          throw new Error(
            data.error ||
              "ユーザー情報の確認に失敗しました。"
          );
        }
      } catch (err) {
        console.error(
          "LIFF / ユーザー確認エラー:",
          err
        );

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : String(err)
          );
        }
      } finally {
        // LINEログインへの移動中はスプラッシュを維持
        if (!cancelled && !redirectingToLine) {
          const elapsed = Date.now() - startedAt;

          const remaining = Math.max(
            0,
            MIN_SPLASH_DURATION_MS - elapsed
          );

          if (remaining > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, remaining)
            );
          }

          if (!cancelled) {
            setLoading(false);
          }
        }
      }
    }

    initLiff();

    return () => {
      cancelled = true;
    };
  }, []);

  // ユーザー登録
  const selectUserType = async (userType: UserType) => {
    if (!profile) {
      alert(
        "LINEプロフィールを取得できていません。"
      );
      return;
    }

    if (registering) return;

    setRegistering(true);

    try {
      if (!liff.isLoggedIn()) {
        liff.login({
          redirectUri: window.location.href,
        });
        return;
      }

      const idToken = liff.getIDToken();

      if (!idToken) {
        alert(
          "LINEの本人確認情報を取得できませんでした。LINEに再ログインしてください。"
        );
        return;
      }

      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          idToken,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl,
          userType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("ユーザー登録APIエラー:", {
          status: response.status,
          error: data.error,
        });

        alert(
          data.error || "登録に失敗しました。"
        );
        return;
      }

      const registeredUser =
        data.user as RegisteredUser;

      if (
        registeredUser?.user_type === "performer"
      ) {
        window.location.replace("/performer");
        return;
      }

      if (
        registeredUser?.user_type === "facility"
      ) {
        window.location.replace("/facility");
        return;
      }

      alert("登録情報を確認できませんでした。");
    } catch (err) {
      console.error("ユーザー登録エラー:", err);
      alert("通信エラーが発生しました。");
    } finally {
      setRegistering(false);
    }
  };

  // スプラッシュ画面
  if (loading) {
    return (
      <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#fff8ed] px-6 py-12">
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-[#25a7a1]/10 blur-3xl" />

        <div className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-[#f2a65a]/15 blur-3xl" />

        <div className="relative z-10 flex w-full max-w-sm flex-col items-center text-center">
          <img
            src="/mmatch-splash-logo.png"
            alt="MMatch Music × Matching"
            className="mb-8 w-full max-w-[340px] object-contain"
          />

          <p className="text-xl font-bold leading-relaxed tracking-wide text-[#17324d]">
            音楽でつながる、
            <br />
            新しい出会い
          </p>

          <div className="mt-8 h-1.5 w-24 overflow-hidden rounded-full bg-[#25a7a1]/20">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[#25a7a1]" />
          </div>

          <p className="mt-5 text-sm text-[#17324d]/65">
            LINEとの接続を確認しています
          </p>
        </div>
      </main>
    );
  }

  // エラー画面
  if (error) {
    return (
      <main className="min-h-screen bg-[#fff8ed] p-6">
        <div className="mx-auto max-w-md">
          <h1 className="text-xl font-bold text-red-600">
            接続エラーが発生しました
          </h1>

          <div className="mt-4 rounded-xl bg-red-50 p-4">
            <pre className="whitespace-pre-wrap text-sm text-red-800">
              {error}
            </pre>
          </div>
        </div>
      </main>
    );
  }

  // プロフィール未取得
  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff8ed] p-6">
        LINEログインが必要です。
      </main>
    );
  }

  // 未登録ユーザーの登録画面
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <h1 className="mb-2 text-2xl font-bold">
          🎵 演奏マッチング
        </h1>

        <p className="mb-8 text-gray-600">
          楽器を演奏したい人と、
          演奏を聞きたい施設をつなぎます。
        </p>

        <h2 className="mb-3 font-bold">
          あなたはどちらですか？
        </h2>

        <div className="space-y-3">
          <button
            onClick={() =>
              selectUserType("performer")
            }
            disabled={registering}
            className="w-full rounded-xl bg-black p-4 text-white disabled:opacity-50"
          >
            🎸 演奏したい
          </button>

          <button
            onClick={() =>
              selectUserType("facility")
            }
            disabled={registering}
            className="w-full rounded-xl border bg-white p-4 disabled:opacity-50"
          >
            🏢 演奏を依頼したい
          </button>
        </div>

        {registering && (
          <p className="mt-4 text-center text-sm text-gray-500">
            登録しています…
          </p>
        )}
      </div>
    </main>
  );
}
