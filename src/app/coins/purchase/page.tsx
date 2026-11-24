"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import liff from "@line/liff";
import Link from "next/link";
type Config = { enabled: boolean; yenPerCoin: number; maxPurchaseYen: number; termsVersion: string };
export default function CoinPurchasePage() {
  const [cancelled, setCancelled] = useState(false); const [token, setToken] = useState(""); const [config, setConfig] = useState<Config | null>(null);
  const [coins, setCoins] = useState("100"); const [accepted, setAccepted] = useState(false); const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(""); const requestKey = useRef("");
  const amount = useMemo(() => Number(coins) * (config?.yenPerCoin ?? 10), [coins, config]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search); setCancelled(params.get("cancelled") === "1");
    let active = true;
    async function initialize() { try {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID; if (!liffId) throw new Error("LIFF設定がありません。");
      await liff.init({ liffId, withLoginOnExternalBrowser: true }); if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return; }
      const idToken = liff.getIDToken(); if (!idToken) throw new Error("LINEの本人確認情報を取得できません。");
      const response = await fetch("/api/stripe/coin-purchase", { headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "購入設定を取得できませんでした。"); if (!active) return;
      setToken(idToken); setConfig(data as Config); requestKey.current = crypto.randomUUID();
    } catch (e) { if (active) setError(e instanceof Error ? e.message : "初期化に失敗しました。"); } finally { if (active) setLoading(false); } }
    void initialize(); return () => { active = false; };
  }, []);
  async function startPurchase() {
    if (!token || !config || submitting || !accepted) return;
    const count = Number(coins); if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(amount) || amount > config.maxPurchaseYen) { setError("購入コイン数または購入金額を確認してください。"); return; }
    setSubmitting(true); setError("");
    try {
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
      const response = await fetch("/api/stripe/coin-purchase", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ coins: count, requestKey: requestKey.current, termsAccepted: true, termsVersion: config.termsVersion }) });
      const data = await response.json(); if (!response.ok || !data.url) throw new Error(data.error || "決済を開始できませんでした。");
      if (data.resumed === true) {
        const resumedCoins = Number(data.coins);
        const resumedAmount = Number(data.amountJpy);
        const resumedRate = Number(data.coinRateYen);
        const message = `未完了の購入手続きがあります。\n\n${resumedCoins.toLocaleString("ja-JP")}コイン / ${resumedAmount.toLocaleString("ja-JP")}円（当時のレート：1コイン=${resumedRate.toLocaleString("ja-JP")}円）\n\nこの既存の決済を再開しますか？`;
        if (!window.confirm(message)) { setSubmitting(false); return; }
      }
      window.location.assign(data.url);
    } catch (e) { setError(e instanceof Error ? e.message : "決済を開始できませんでした。"); setSubmitting(false); }
  }
  return <main className="mx-auto max-w-xl p-5"><header className="mb-6"><p className="text-sm text-gray-500">HAKOTOHITO</p><h1 className="mt-1 text-2xl font-bold">コイン購入</h1></header>
    {cancelled && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">決済はキャンセルされました。コインは付与されていません。</p>}
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <p>読み込み中…</p> : !config?.enabled ? <section className="rounded-2xl border p-5 text-sm text-gray-600">コイン購入は現在利用できません。</section> : <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <label htmlFor="coins" className="block font-bold">購入コイン数</label><input id="coins" type="number" min="1" step="1" value={coins} onChange={(e) => setCoins(e.target.value)} className="mt-2 w-full rounded-xl border p-3" />
      <div className="mt-4 space-y-2 rounded-xl bg-gray-50 p-4 text-sm"><div className="flex justify-between"><span>購入レート</span><strong>1コイン＝{config.yenPerCoin.toLocaleString("ja-JP")}円</strong></div><div className="flex justify-between"><span>お支払い金額</span><strong className="text-lg">{Number.isFinite(amount) ? amount.toLocaleString("ja-JP") : "—"}円</strong></div><p className="text-xs text-gray-500">1回の購入上限：{config.maxPurchaseYen.toLocaleString("ja-JP")}円</p></div>
      <div className="mt-4 rounded-xl border p-3 text-xs leading-6 text-gray-700">購入したコインはHakotohito内の対象機能で利用するものです。現金への換金・出金・現金との交換はできません。購入後の返金は原則お受けしていませんが、法令上必要な場合や決済事故等は別途対応します。購入前に<Link href="/terms" className="underline underline-offset-4">利用規約</Link>および<Link href="/specified-commercial-transactions" className="underline underline-offset-4">特定商取引法に基づく表記</Link>をご確認ください。</div>
      <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1" /><span>コインの利用条件・購入条件を確認し、同意します。</span></label>
      <button type="button" onClick={() => void startPurchase()} disabled={submitting || !accepted || !Number.isSafeInteger(Number(coins)) || Number(coins) < 1 || !Number.isSafeInteger(amount) || amount > config.maxPurchaseYen} className="mt-5 w-full rounded-xl bg-black p-4 font-bold text-white disabled:opacity-50">{submitting ? "決済画面へ移動中…" : "Stripeで購入する"}</button>
      <p className="mt-3 text-xs leading-5 text-gray-500">決済完了後、Stripe Webhookで支払いを確認してコインを付与します。決済画面から戻っただけでは付与されません。</p>
    </section>}
  </main>;
}
