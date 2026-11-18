"use client";

import { useCallback, useEffect, useState } from "react";

type Settings = { coin_purchase_enabled: boolean };
type IncidentAction = {
  id: string;
  admin_line_user_id: string;
  action_type: "under_review" | "resolved" | "dismissed";
  note: string;
  created_at: string;
};
type RelatedOrder = {
  id: string;
  payer_user_id: string;
  status: string;
  coin_amount: number;
  amount_jpy: number;
  created_at: string;
};
type Incident = {
  id: string;
  payment_order_id: string;
  incident_type: string;
  stripe_payment_intent_id: string | null;
  amount_jpy: number;
  currency: string;
  details: Record<string, unknown> | null;
  resolution_status: "open" | "under_review" | "resolved" | "dismissed";
  created_at: string;
  resolved_at: string | null;
  payment_orders: RelatedOrder | RelatedOrder[] | null;
  stripe_payment_incident_actions: IncidentAction[] | null;
};
type IncidentFilter = "all" | "open" | "under_review" | "resolved" | "dismissed";
type IncidentActionType = "under_review" | "resolved" | "dismissed";

const STATUS_LABELS: Record<IncidentFilter, string> = {
  all: "すべて", open: "未対応", under_review: "確認中", resolved: "対応済み", dismissed: "対象外",
};
const ACTION_LABELS: Record<IncidentActionType, string> = {
  under_review: "確認中にする", resolved: "対応済みにする", dismissed: "対象外にする",
};
function getOrder(value: Incident["payment_orders"]): RelatedOrder | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}
function getIncidentLabel(value: string) {
  if (value.startsWith("refund:") || value.startsWith("charge_refunded:")) return "返金イベント";
  if (value.startsWith("dispute:")) return "チャージバック・紛争";
  if (value === "paid_after_account_withdrawal") return "退会後の決済";
  return value;
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
}

export default function AdminPaymentSettingsPanel({ token }: { token: string }) {
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentPage, setIncidentPage] = useState(1);
  const [incidentTotal, setIncidentTotal] = useState(0);
  const [incidentHasMore, setIncidentHasMore] = useState(false);
  const [incidentFilter, setIncidentFilter] = useState<IncidentFilter>("open");
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [incidentSavingId, setIncidentSavingId] = useState("");
  const [incidentNotes, setIncidentNotes] = useState<Record<string, string>>({});
  const [incidentError, setIncidentError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/payment-settings", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.settings) throw new Error(data.error || "設定を取得できませんでした。");
      setEnabled(data.settings.coin_purchase_enabled === true);
      setConfigured(data.stripeConfigured === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "設定を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadIncidents = useCallback(async () => {
    setIncidentLoading(true);
    setIncidentError("");
    try {
      const response = await fetch(`/api/admin/stripe-incidents?status=${incidentFilter}&page=${incidentPage}&pageSize=25`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.incidents)) throw new Error(data.error || "決済事故一覧を取得できませんでした。");
      setIncidents(data.incidents as Incident[]);
      setIncidentTotal(typeof data.total === "number" ? data.total : data.incidents.length);
      setIncidentHasMore(data.hasMore === true);
    } catch (e) {
      setIncidentError(e instanceof Error ? e.message : "決済事故一覧を取得できませんでした。");
    } finally {
      setIncidentLoading(false);
    }
  }, [incidentFilter, incidentPage, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadIncidents(); }, [loadIncidents]);

  async function save() {
    if (saving) return;
    if (enabled && !configured) { setError("Stripe環境変数が未設定のため有効化できません。"); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/payment-settings", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ coin_purchase_enabled: enabled }),
      });
      const data = await response.json();
      if (!response.ok || !data.settings) throw new Error(data.error || "設定を保存できませんでした。");
      setNotice("コイン購入設定を保存しました。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "設定を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function updateIncident(incidentId: string, actionType: IncidentActionType) {
    const note = (incidentNotes[incidentId] ?? "").trim();
    if (!note) { setIncidentError("対応記録を入力してください。"); return; }
    if (incidentSavingId) return;
    setIncidentSavingId(incidentId); setIncidentError("");
    try {
      const response = await fetch(`/api/admin/stripe-incidents/${incidentId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ actionType, note }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "対応記録を保存できませんでした。");
      setIncidentNotes((current) => ({ ...current, [incidentId]: "" }));
      await loadIncidents();
    } catch (e) {
      setIncidentError(e instanceof Error ? e.message : "対応記録を保存できませんでした。");
    } finally {
      setIncidentSavingId("");
    }
  }

  return <div className="space-y-5">
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Stripeコイン購入設定</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600">今回の限定公開で有効化できるStripe機能はアプリ内コイン購入のみです。Connect・サービス決済・送金はサーバー側で無効化されます。</p>
      <p className={`mt-3 rounded-xl p-3 text-sm ${configured ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>Stripe APIキー／Webhook設定：{configured ? "環境変数を検出" : "未設定または不足"}</p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {loading ? <p className="mt-5">読み込み中…</p> : <>
        <label className="mt-4 flex items-center justify-between gap-4 py-4"><span><span className="block font-bold">コイン購入</span><span className="mt-1 block text-xs text-gray-500">演奏者・施設がStripeでアプリ内コインを購入</span></span><input type="checkbox" checked={enabled} disabled={saving || (!configured && !enabled)} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 shrink-0" /></label>
        <div className="flex gap-3 pt-3"><button onClick={() => void save()} disabled={saving} className="flex-1 rounded-xl bg-black p-3 font-bold text-white disabled:opacity-50">{saving ? "保存中…" : "設定を保存"}</button><button onClick={() => void load()} disabled={loading || saving} className="rounded-xl border px-4 font-bold">再読み込み</button></div>
      </>}
      <p className="mt-4 text-xs leading-5 text-gray-500">本番利用は法的確認・Stripeテスト・DB整合性確認が完了してから有効化してください。</p>
    </section>

    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold">Stripe返金・紛争・要確認一覧</h2><p className="mt-1 text-xs leading-5 text-gray-500">Webhookで記録した決済事故を確認します。コイン残高の自動減算・自動返金は行いません。</p></div>
        <button type="button" onClick={() => void loadIncidents()} disabled={incidentLoading} className="rounded-xl border px-3 py-2 text-sm font-bold">再読み込み</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(STATUS_LABELS) as IncidentFilter[]).map((status) => <button key={status} type="button" onClick={() => { setIncidentPage(1); setIncidentFilter(status); }} aria-pressed={incidentFilter === status} className={`rounded-full px-3 py-2 text-xs font-bold ${incidentFilter === status ? "bg-black text-white" : "bg-gray-100 text-gray-700"}`}>{STATUS_LABELS[status]}</button>)}
      </div>
      {incidentError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{incidentError}</p>}
      {incidentLoading ? <p className="mt-5 text-sm text-gray-500">決済事故を読み込み中…</p> : incidents.length === 0 ? <p className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">該当する決済事故はありません。</p> : <div className="mt-4 space-y-4">
        {incidents.map((incident) => {
          const order = getOrder(incident.payment_orders);
          const details = incident.details ?? {};
          const actions = incident.stripe_payment_incident_actions ?? [];
          return <article key={incident.id} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-bold">{getIncidentLabel(incident.incident_type)}</p><p className="mt-1 text-xs text-gray-500">{formatDate(incident.created_at)}</p></div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold">{STATUS_LABELS[incident.resolution_status]}</span>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-gray-500">対象注文</dt><dd className="break-all">{incident.payment_order_id}</dd></div>
              <div><dt className="text-xs text-gray-500">購入金額</dt><dd>{incident.amount_jpy.toLocaleString("ja-JP")}円</dd></div>
              <div><dt className="text-xs text-gray-500">購入コイン</dt><dd>{order ? `${order.coin_amount.toLocaleString("ja-JP")}コイン` : "注文情報なし"}</dd></div>
              <div><dt className="text-xs text-gray-500">購入者ID</dt><dd className="break-all">{order?.payer_user_id ?? "—"}</dd></div>
              <div><dt className="text-xs text-gray-500">Stripeイベント</dt><dd>{String(details.stripe_event_type ?? "—")}</dd></div>
              <div><dt className="text-xs text-gray-500">Stripe実際の金額</dt><dd>{typeof details.actual_amount === "number" ? `${details.actual_amount.toLocaleString("ja-JP")} ${String(details.actual_currency ?? incident.currency).toUpperCase()}` : "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-gray-500">理由</dt><dd>{String(details.reason ?? details.account_status_at_fulfillment ?? "—")}</dd></div>
            </dl>
            {actions.length > 0 && <div className="mt-3 rounded-lg bg-gray-50 p-3"><p className="text-xs font-bold text-gray-600">対応履歴</p><ul className="mt-2 space-y-2">{actions.map((action) => <li key={action.id} className="text-xs"><span className="font-bold">{STATUS_LABELS[action.action_type]}</span> · {formatDate(action.created_at)}<p className="mt-1 whitespace-pre-wrap text-gray-600">{action.note}</p></li>)}</ul></div>}
            <label className="mt-4 block text-xs font-bold">対応記録（必須）<textarea value={incidentNotes[incident.id] ?? ""} onChange={(e) => setIncidentNotes((current) => ({ ...current, [incident.id]: e.target.value }))} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" placeholder="確認内容・Stripe側の処理・コイン残高の扱いなど" /></label>
            <div className="mt-3 flex flex-wrap gap-2">{(Object.keys(ACTION_LABELS) as IncidentActionType[]).map((action) => <button key={action} type="button" onClick={() => void updateIncident(incident.id, action)} disabled={incidentSavingId === incident.id} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">{incidentSavingId === incident.id ? "保存中…" : ACTION_LABELS[action]}</button>)}</div>
          </article>;
        })}
      </div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-gray-500">全{incidentTotal.toLocaleString("ja-JP")}件 · {incidentPage}ページ</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setIncidentPage((page) => Math.max(1, page - 1))} disabled={incidentLoading || incidentPage <= 1} className="rounded-lg border px-3 py-2 disabled:opacity-40">前へ</button>
          <button type="button" onClick={() => setIncidentPage((page) => page + 1)} disabled={incidentLoading || !incidentHasMore} className="rounded-lg border px-3 py-2 disabled:opacity-40">次へ</button>
        </div>
      </div>
      <p className="mt-4 text-xs leading-5 text-gray-500">「対応済み」「対象外」は管理記録の更新です。Stripeでの返金実行やコインの減算は行いません。返金・紛争の判断と残高調整は個別に確認してください。</p>
    </section>
  </div>;
}
