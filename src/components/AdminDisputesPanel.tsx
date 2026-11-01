
"use client";

import { useCallback, useEffect, useState } from "react";

type DisputeAction = {
  id: string;
  admin_line_user_id: string;
  action_type: "started" | "note" | "resolved";
  note: string;
  created_at: string;
};

type DisputeCase = {
  id: string;
  match_id: string;
  status: "in_progress" | "resolved";
  dispute_reason: string;
  disputed_by: string;
  disputed_at: string;
  resolved_at: string | null;
  resolved_by_line_user_id: string | null;
  resolution_note: string | null;
  resolution_source: "admin" | "bilateral_agreement" | null;
  created_at: string;
  updated_at: string;
  matches: {
    id: string;
    request_id: string;
    performer_id: string | null;
    band_id: string | null;
    performance_status: string;
    performer_completion_reported_at: string | null;
    facility_completion_reported_at: string | null;
    completion_dispute_facility_agreed_at: string | null;
    completion_dispute_performer_agreed_at: string | null;
    performance_requests: {
      id: string;
      title: string;
      performance_date: string;
      facility_id: string;
      facilities: {
        id: string;
        name: string;
      } | null;
    } | null;
    performers: {
      id: string;
      name: string;
    } | null;
  } | null;
  completion_dispute_admin_actions: DisputeAction[];
};

type Props = {
  token: string;
};

type FilterStatus = "all" | "in_progress" | "resolved";

const ACTION_LABELS: Record<DisputeAction["action_type"], string> = {
  started: "対応開始",
  note: "対応記録",
  resolved: "解決",
};

export default function AdminDisputesPanel({ token }: Props) {
  const [disputes, setDisputes] = useState<DisputeCase[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("in_progress");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDisputes = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/disputes?status=${filter}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "異議申し立て一覧を取得できませんでした。"
        );
      }

      setDisputes(data.disputes ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "異議申し立て一覧の取得に失敗しました。"
      );
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => {
    void loadDisputes();
  }, [loadDisputes]);

  const executeAction = async (
    dispute: DisputeCase,
    actionType: "started" | "note" | "resolved"
  ) => {
    const note = (drafts[dispute.id] ?? "").trim();

    if (!note) {
      setError("記録内容を入力してください。");
      return;
    }

    if (actionType === "resolved") {
      const confirmed = window.confirm(
        "この異議申し立てを管理者判断で解決しますか？\n\n" +
          "異議申し立て状態は解除されますが、演奏完了扱いやコイン手数料の徴収は行われません。"
      );

      if (!confirmed) return;
    }

    setSavingId(dispute.id);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/admin/disputes/${dispute.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            actionType,
            note,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "異議申し立ての更新に失敗しました。"
        );
      }

      setDrafts((previous) => ({
        ...previous,
        [dispute.id]: "",
      }));

      setNotice(
        actionType === "resolved"
          ? "管理者判断で解決しました。"
          : actionType === "started"
            ? "対応開始を記録しました。"
            : "対応記録を追加しました。"
      );

      await loadDisputes();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "処理に失敗しました。"
      );
    } finally {
      setSavingId("");
    }
  };

  const formatDate = (value: string | null) => {
    if (!value) return "—";

    return new Date(value).toLocaleString("ja-JP");
  };

  const getActorLabel = (lineUserId: string) => {
    return lineUserId === "system" ? "システム" : "管理者";
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-bold">
          異議申し立て管理
        </h2>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["in_progress", "対応中"],
              ["resolved", "解決済み"],
              ["all", "すべて"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${
                filter === value
                  ? "bg-black text-white"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-sm text-gray-500">
          表示件数：{disputes.length}件（最大100件）
        </p>
      </section>

      {error && (
        <div
          role="alert"
          className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800"
        >
          {notice}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-white p-8 text-center text-gray-500">
          読み込み中…
        </div>
      ) : disputes.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-gray-500">
          該当する異議申し立てはありません。
        </div>
      ) : (
        disputes.map((dispute) => {
          const match = dispute.matches;
          const request = match?.performance_requests;
          const facility = request?.facilities;
          const performer = match?.performers;
          const isSaving = savingId === dispute.id;
          const isOpen = dispute.status === "in_progress";

          const actions = [
            ...(dispute.completion_dispute_admin_actions ?? []),
          ].sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
          );

          return (
            <article
              key={dispute.id}
              className="space-y-4 rounded-2xl bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    isOpen
                      ? "bg-orange-100 text-orange-800"
                      : "bg-green-100 text-green-800"
                  }`}
                >
                  {isOpen ? "対応中" : "解決済み"}
                </span>

                <span className="text-xs text-gray-500">
                  受付：{formatDate(dispute.disputed_at)}
                </span>
              </div>

              <div>
                <h3 className="break-words text-lg font-bold">
                  {request?.title || "案件名不明"}
                </h3>

                <div className="mt-2 space-y-1 text-sm text-gray-600">
                  <p>
                    施設：{facility?.name || "不明"}
                  </p>
                  <p>
                    演奏者：
                    {match?.band_id
                      ? "バンド"
                      : performer?.name || "不明"}
                  </p>
                  <p>
                    演奏日：
                    {request?.performance_date
                      ? new Date(
                          request.performance_date
                        ).toLocaleDateString("ja-JP")
                      : "不明"}
                  </p>
                  <p>
                    申し立て側：
                    {dispute.disputed_by === "performer"
                      ? "演奏者"
                      : dispute.disputed_by === "facility"
                        ? "施設"
                        : dispute.disputed_by}
                  </p>
                </div>
              </div>

              <section className="rounded-xl bg-orange-50 p-4">
                <h4 className="mb-2 text-sm font-bold">
                  申し立て理由
                </h4>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                  {dispute.dispute_reason}
                </p>
              </section>

              <section>
                <h4 className="mb-3 font-bold">
                  対応履歴
                </h4>

                {actions.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    対応履歴はありません。
                  </p>
                ) : (
                  <div className="space-y-3">
                    {actions.map((action) => (
                      <div
                        key={action.id}
                        className="rounded-xl border p-3"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="text-sm font-bold">
                            {ACTION_LABELS[action.action_type] ??
                              action.action_type}
                            {" · "}
                            {getActorLabel(
                              action.admin_line_user_id
                            )}
                          </span>

                          <span className="text-xs text-gray-500">
                            {formatDate(action.created_at)}
                          </span>
                        </div>

                        <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                          {action.note}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {!isOpen && (
                <section className="rounded-xl bg-gray-50 p-4">
                  <h4 className="font-bold">
                    解決結果
                  </h4>

                  <p className="mt-2 text-sm">
                    解決方法：
                    {dispute.resolution_source ===
                    "bilateral_agreement"
                      ? "双方合意"
                      : "管理者判断"}
                  </p>

                  <p className="mt-1 text-sm">
                    解決日時：
                    {formatDate(dispute.resolved_at)}
                  </p>

                  {dispute.resolution_note && (
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {dispute.resolution_note}
                    </p>
                  )}
                </section>
              )}

              {isOpen && (
                <section className="space-y-3 border-t pt-4">
                  <label
                    htmlFor={`dispute-note-${dispute.id}`}
                    className="block text-sm font-bold"
                  >
                    対応内容・記録
                  </label>

                  <textarea
                    id={`dispute-note-${dispute.id}`}
                    value={drafts[dispute.id] ?? ""}
                    onChange={(event) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [dispute.id]: event.target.value,
                      }))
                    }
                    rows={4}
                    maxLength={2000}
                    placeholder="確認した内容や対応結果を記録してください。"
                    className="w-full rounded-xl border p-3 text-sm"
                    disabled={isSaving}
                  />

                  <p className="text-right text-xs text-gray-500">
                    {(drafts[dispute.id] ?? "").length}/2000文字
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      void executeAction(dispute, "note")
                    }
                    disabled={isSaving || !drafts[dispute.id]?.trim()}
                    className="w-full rounded-xl border border-gray-300 p-3 font-bold disabled:opacity-50"
                  >
                    {isSaving ? "保存中…" : "対応記録を追加"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void executeAction(dispute, "resolved")
                    }
                    disabled={isSaving || !drafts[dispute.id]?.trim()}
                    className="w-full rounded-xl bg-black p-3 font-bold text-white disabled:opacity-50"
                  >
                    管理者判断で解決する
                  </button>

                  <p className="text-xs leading-5 text-gray-500">
                    管理者判断で解決しても、演奏完了やコイン手数料の徴収は行われません。
                  </p>
                </section>
              )}
            </article>
          );
        })
      )}

      <button
        type="button"
        onClick={() => void loadDisputes()}
        disabled={loading || !token}
        className="w-full rounded-xl border bg-white p-3 font-bold disabled:opacity-50"
      >
        再読み込み
      </button>
    </div>
  );
}
