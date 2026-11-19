"use client";

import { useCallback, useEffect, useState } from "react";
import liff from "@line/liff";

type LobbyUser = { user_type: "performer" | "facility"; account_status: "active" | "pending_approval" };

export default function LobbyPage() {
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const checkStatus = useCallback(async (idToken: string) => {
    setChecking(true); setError("");
    try {
      const response = await fetch("/api/users", { headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.user) throw new Error(data.error || "登録状態を確認できませんでした。");
      const user = data.user as LobbyUser;
      if (user.account_status === "active") {
        window.location.replace(user.user_type === "performer" ? "/performer" : "/facility");
        return;
      }
      if (user.account_status !== "pending_approval") throw new Error("このアカウントは現在利用できません。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録状態を確認できませんでした。");
    } finally { setChecking(false); setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId) throw new Error("LINEログインの設定がありません。");
        await liff.init({ liffId, withLoginOnExternalBrowser: true });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return; }
        const idToken = liff.getIDToken();
        if (!idToken) throw new Error("LINEの本人確認情報を取得できません。");
        if (active) await checkStatus(idToken);
      } catch (e) {
        if (active) { setError(e instanceof Error ? e.message : "確認に失敗しました。"); setLoading(false); }
      }
    }
    void initialize();
    return () => { active = false; };
  }, [checkStatus]);

  const refresh = () => {
    const idToken = liff.getIDToken();
    if (idToken) void checkStatus(idToken);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <section className="w-full max-w-md rounded-3xl border bg-white p-7 text-center shadow-sm">
        <div className="text-4xl">🎵</div>
        <h1 className="mt-4 text-2xl font-bold">登録申請を受け付けました</h1>
        <p className="mt-4 leading-relaxed text-gray-700">現在、管理者による確認待ちです。承認されると、演奏マッチングの各機能をご利用いただけます。</p>
        <p className="mt-3 text-sm text-gray-500">承認されるまでは、募集・応募・メッセージなどの通常機能は利用できません。この画面を閉じても申請状態は保持されます。</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button type="button" disabled={loading || checking} onClick={refresh} className="mt-6 w-full rounded-xl bg-black p-4 font-bold text-white disabled:opacity-50">
          {loading || checking ? "確認中…" : "承認状況を確認する"}
        </button>
      </section>
    </main>
  );
}
