"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import liff from "@line/liff";

type PendingUser = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
  user_type: "performer" | "facility";
  created_at: string;
};

export default function AdminApprovalsPage() {
  const [token, setToken] = useState("");
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (idToken: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users/approvals", {
        headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "承認待ち一覧を取得できませんでした。");
      setUsers(data.users ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "承認待ち一覧を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId) throw new Error("NEXT_PUBLIC_LIFF_ID が設定されていません。");
        await liff.init({ liffId, withLoginOnExternalBrowser: true });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return; }
        const idToken = liff.getIDToken();
        if (!idToken) throw new Error("LINEの本人確認情報を取得できません。");
        if (!active) return;
        setToken(idToken);
        await load(idToken);
      } catch (e) {
        if (active) { setError(e instanceof Error ? e.message : "管理者認証に失敗しました。"); setLoading(false); }
      }
    }
    void initialize();
    return () => { active = false; };
  }, [load]);

  const approve = async (user: PendingUser) => {
    if (!token || savingId) return;
    const label = user.display_name || "名前未設定";
    if (!window.confirm(`${label} さん（${user.user_type === "performer" ? "演奏者" : "施設"}）の登録を承認しますか？`)) return;
    setSavingId(user.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/users/approvals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "承認に失敗しました。");
      setUsers(previous => previous.filter(item => item.id !== user.id));
      setNotice(`${label} さんの登録を承認しました。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "承認に失敗しました。");
    } finally {
      setSavingId("");
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/admin/coins" className="text-sm text-gray-600">← 管理者メニューへ戻る</Link>
        <header className="py-5">
          <p className="text-sm text-gray-500">ADMINISTRATION</p>
          <h1 className="mt-1 text-2xl font-bold">新規登録の承認</h1>
          <p className="mt-2 text-sm text-gray-600">承認されるまで、登録者はロビーで待機し、通常機能を利用できません。</p>
        </header>
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>}
        {notice && <p role="status" className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-green-800">{notice}</p>}
        <div className="mb-4 flex items-center justify-between">
          <p className="font-bold">承認待ち：{users.length}件</p>
          <button type="button" disabled={!token || loading} onClick={() => void load(token)} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50">再読み込み</button>
        </div>
        {loading ? <p className="py-10 text-center text-gray-500">読み込み中…</p> : users.length === 0 ? (
          <div className="rounded-2xl border bg-white p-8 text-center text-gray-500">現在、承認待ちのユーザーはいません。</div>
        ) : (
          <div className="space-y-3">
            {users.map(user => (
              <section key={user.id} className="rounded-2xl border bg-white p-5">
                <div className="flex items-start gap-3">
                  {user.picture_url ? <img src={user.picture_url} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="h-12 w-12 rounded-full bg-gray-100" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{user.display_name || "名前未設定"}</p>
                    <p className="mt-1 text-sm text-gray-600">{user.user_type === "performer" ? "演奏者" : "施設"}</p>
                    <p className="mt-1 text-xs text-gray-400">登録日時：{new Date(user.created_at).toLocaleString("ja-JP")}</p>
                  </div>
                </div>
                <button type="button" disabled={savingId !== ""} onClick={() => void approve(user)} className="mt-4 w-full rounded-xl bg-black p-3 font-bold text-white disabled:opacity-50">
                  {savingId === user.id ? "承認中…" : "このユーザーを承認して利用開始"}
                </button>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
