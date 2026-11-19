"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import liff from "@line/liff";
export default function CoinPurchaseCompletePage() {
  const [message, setMessage] = useState("Stripeから決済結果を確認しています。コイン付与にはWebhook処理が必要です。");
  const [status, setStatus] = useState("checking");
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id") ?? ""; let active = true;
    async function check() { try {
      if (!sessionId) { if (active) { setStatus("invalid"); setMessage("決済セッション情報を確認できません。"); } return; }
      const id = process.env.NEXT_PUBLIC_LIFF_ID; if (!id) throw new Error("LIFF設定がありません。"); await liff.init({ liffId: id, withLoginOnExternalBrowser: true });
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return; }
      const token = liff.getIDToken(); if (!token) throw new Error("本人確認情報を取得できません。");
      const response = await fetch(`/api/stripe/coin-purchase/status?session_id=${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "購入状態を確認できませんでした。"); if (!active) return;
      if (data.status === "paid") { setStatus("paid"); setMessage(`${Number(data.coins).toLocaleString("ja-JP")}コインの購入が完了しました。コイン履歴をご確認ください。`); }
      else if (data.status === "paid_review") { setStatus("paid_review"); setMessage("お支払いは確認できましたが、安全確認のためコイン付与を保留しています。管理者が決済状況を確認します。重複購入せず、そのままお問い合わせください。"); }
      else if (data.status === "pending") { setStatus("pending"); setMessage("決済確認中です。Webhook処理後にコインが付与されます。少し待ってから再読み込みしてください。"); }
      else { setStatus("not-paid"); setMessage("この注文は購入完了になっていません。決済状態をご確認ください。"); }
    } catch (e) { if (active) { setStatus("error"); setMessage(e instanceof Error ? e.message : "購入状態を確認できませんでした。"); } } }
    void check(); return () => { active = false; };
  }, []);
  return <main className="mx-auto max-w-xl p-5"><section className="rounded-2xl border bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold">購入手続き</h1><p className="mt-4 text-sm leading-6 text-gray-600">{message}</p><p className="mt-2 text-xs text-gray-400">確認状態：{status}</p><div className="mt-6 flex flex-col gap-3"><button onClick={() => window.location.reload()} className="rounded-xl border p-3 font-bold">再読み込み</button>{status === "paid_review" && <Link href="/inquiry" className="rounded-xl bg-amber-100 p-3 font-bold text-amber-900">運営に問い合わせる</Link>}<Link href="/coins/history" className="rounded-xl bg-black p-3 font-bold text-white">コイン履歴を見る</Link><Link href="/coins/purchase" className="rounded-xl border p-3 font-bold">購入画面に戻る</Link></div></section></main>;
}
