
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

export default function Home() {
  const [profile, setProfile] = useState<LineProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function initLiff() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("NEXT_PUBLIC_LIFF_ID が設定されていません。");
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (cancelled) return;

        if (!liff.isLoggedIn()) {
          liff.login({
            redirectUri: window.location.href,
          });
          return;
        }

        const lineProfile = await liff.getProfile();

        if (cancelled) return;

        setProfile({
          userId: lineProfile.userId,
          displayName: lineProfile.displayName,
          pictureUrl: lineProfile.pictureUrl,
        });

        const idToken = liff.getIDToken();

        if (!idToken) {
          throw new Error(
            "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
          );
        }

        // 登録済みの有効アカウントを確認
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

          throw new Error("登録済みユーザーの種別が不正です。");
        }

        if (response.status !== 404) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            data.error || "ユーザー情報の確認に失敗しました。"
          );
        }
      } catch (err) {
        console.error("LIFF / ユーザー確認エラー:", err);

        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : String(err)
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initLiff();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectUserType = async (userType: UserType) => {
    if (!profile) {
      alert("LINEプロフィールを取得できていません。");
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

        alert(data.error || "登録に失敗しました。");
        return;
      }

      // APIが返した実際の登録種別を基準に移動
      const registeredUser = data.user as RegisteredUser;

      if (registeredUser?.user_type === "performer") {
        window.location.replace("/performer");
        return;
      }

      if (registeredUser?.user_type === "facility") {
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

  if (loading) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6">
        <h1 className="text-xl font-bold">読み込み中…</h1>
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
            <pre className="text-sm whitespace-pre-wrap">{error}</pre>
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
            disabled={registering}
            className="w-full bg-black text-white rounded-xl p-4 disabled:opacity-50"
          >
            🎸 演奏したい
          </button>

          <button
            onClick={() => selectUserType("facility")}
            disabled={registering}
            className="w-full bg-white border rounded-xl p-4 disabled:opacity-50"
          >
            🏢 演奏を依頼したい
          </button>
        </div>

        {registering && (
          <p className="text-center text-sm text-gray-500 mt-4">
            登録しています…
          </p>
        )}
      </div>
    </main>
  );
}
