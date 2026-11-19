"use client";

import { useCallback, useEffect, useState } from "react";
import liff from "@line/liff";

type Inquiry = {
  id: string;
  user_id: string;
  category: string;
  subject: string;
  message: string;
  status: "open" | "in_progress" | "resolved";
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at?: string;
  users:
    | {
        display_name: string | null;
        user_type: string | null;
      }
    | {
        display_name: string | null;
        user_type: string | null;
      }[]
    | null;
};

type InquiryUpdateResponse = {
  success?: boolean;
  error?: string;
  inquiry?: Partial<Inquiry> & {
    id: string;
    status: Inquiry["status"];
    admin_reply: string | null;
    replied_at: string | null;
  };
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: "不具合・エラー",
  account: "アカウント",
  coins: "コイン",
  suggestion: "改善要望",
  other: "その他",
};

const STATUS_LABELS: Record<string, string> = {
  open: "未対応",
  in_progress: "対応中",
  resolved: "対応済み",
};

function getUser(inquiry: Inquiry) {
  if (Array.isArray(inquiry.users)) {
    return inquiry.users[0] ?? null;
  }

  return inquiry.users;
}

export default function AdminInquiriesPage() {
  const [ready, setReady] = useState(false);
  const [idToken, setIdToken] = useState("");
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [statusDrafts, setStatusDrafts] = useState<
    Record<string, Inquiry["status"]>
  >({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadInquiries = useCallback(
    async (token: string, status: string) => {
      setLoading(true);
      setError("");
      setNotice("");

      try {
        const response = await fetch(
          `/api/admin/inquiries?status=${encodeURIComponent(status)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          }
        );

        const data = await response.json();

        if (!response.ok) {
          setError(data.error || "問い合わせ一覧を取得できませんでした。");
          setInquiries([]);
          return;
        }

        const items: Inquiry[] = data.inquiries ?? [];
        setInquiries(items);

        setStatusDrafts((previous) => {
          const next = { ...previous };

          for (const inquiry of items) {
            next[inquiry.id] = inquiry.status;
          }

          return next;
        });

        setReplyDrafts((previous) => {
          const next = { ...previous };

          for (const inquiry of items) {
            next[inquiry.id] = inquiry.admin_reply ?? "";
          }

          return next;
        });
      } catch (err) {
        console.error("問い合わせ一覧取得エラー:", err);
        setError("通信エラーが発生しました。");
        setInquiries([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("LINEの設定が見つかりません。");
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }

        const token = liff.getIDToken();

        if (!token) {
          setError(
            "LINEの本人確認情報を取得できません。再ログインしてください。"
          );
          setLoading(false);
          return;
        }

        setIdToken(token);
        setReady(true);
      } catch (err) {
        console.error("管理者問い合わせ画面の初期化エラー:", err);
        setError(
          "LINEの初期化に失敗しました。画面を開き直してください。"
        );
        setLoading(false);
      }
    }

    void initialize();
  }, []);

  useEffect(() => {
    if (ready && idToken) {
      void loadInquiries(idToken, statusFilter);
    }
  }, [ready, idToken, statusFilter, loadInquiries]);

  async function saveInquiry(inquiry: Inquiry) {
    if (!idToken || savingId) {
      return;
    }

    const status = statusDrafts[inquiry.id] ?? inquiry.status;
    const adminReply = replyDrafts[inquiry.id] ?? "";

    if (adminReply.length > 5000) {
      setError("返信は5000文字以内で入力してください。");
      return;
    }

    setSavingId(inquiry.id);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/admin/inquiries/${encodeURIComponent(inquiry.id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status,
            adminReply,
          }),
        }
      );

      const data: InquiryUpdateResponse = await response.json();

      if (!response.ok || !data.inquiry) {
        setError(data.error || "問い合わせを保存できませんでした。");
        return;
      }

      const updated = data.inquiry;

      setInquiries((previous) =>
        previous.map((item) =>
          item.id === inquiry.id
            ? {
                ...item,
                ...updated,
                admin_reply: updated.admin_reply ?? null,
                replied_at: updated.replied_at ?? null,
                status: updated.status,
              }
            : item
        )
      );

      setStatusDrafts((previous) => ({
        ...previous,
        [inquiry.id]: updated.status,
      }));

      setReplyDrafts((previous) => ({
        ...previous,
        [inquiry.id]: updated.admin_reply ?? "",
      }));

      setNotice(`「${inquiry.subject}」を保存しました。`);
    } catch (err) {
      console.error("問い合わせ更新エラー:", err);
      setError("通信エラーが発生しました。もう一度お試しください。");
    } finally {
      setSavingId("");
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-5">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/coins";
          }}
          className="mb-5 text-sm text-gray-600"
        >
          ← コイン管理へ戻る
        </button>

        <h1 className="mb-2 text-2xl font-bold">
          📩 お問い合わせ管理
        </h1>

        <p className="mb-6 text-sm text-gray-600">
          問い合わせへの返信と対応状況の更新ができます。
        </p>

        <div className="mb-5 rounded-2xl bg-white p-4 shadow-sm">
          <label
            htmlFor="statusFilter"
            className="mb-2 block text-sm font-bold"
          >
            対応状況で絞り込む
          </label>

          <select
            id="statusFilter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full rounded-xl border p-3"
          >
            <option value="all">すべて</option>
            <option value="open">未対応</option>
            <option value="in_progress">対応中</option>
            <option value="resolved">対応済み</option>
          </select>

          <p className="mt-3 text-sm text-gray-500">
            表示件数：{inquiries.length}件（最大100件）
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-green-800"
          >
            {notice}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl bg-white p-6 text-center text-gray-500">
            問い合わせを読み込んでいます…
          </div>
        ) : inquiries.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-gray-500">
            問い合わせはありません。
          </div>
        ) : (
          <div className="space-y-4">
            {inquiries.map((inquiry) => {
              const user = getUser(inquiry);
              const draftStatus =
                statusDrafts[inquiry.id] ?? inquiry.status;
              const draftReply =
                replyDrafts[inquiry.id] ?? inquiry.admin_reply ?? "";
              const isSaving = savingId === inquiry.id;

              return (
                <article
                  key={inquiry.id}
                  className="rounded-2xl bg-white p-5 shadow-sm"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs">
                      {CATEGORY_LABELS[inquiry.category] ??
                        inquiry.category}
                    </span>

                    <span
                      className={`rounded-full px-3 py-1 text-xs ${
                        inquiry.status === "resolved"
                          ? "bg-green-100 text-green-800"
                          : inquiry.status === "in_progress"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-orange-100 text-orange-800"
                      }`}
                    >
                      現在：{STATUS_LABELS[inquiry.status]}
                    </span>
                  </div>

                  <h2 className="mb-2 break-words text-lg font-bold">
                    {inquiry.subject}
                  </h2>

                  <p className="mb-3 whitespace-pre-wrap break-words text-sm leading-6">
                    {inquiry.message}
                  </p>

                  <div className="border-t pt-3 text-xs leading-5 text-gray-500">
                    <p>送信者：{user?.display_name || "名前未設定"}</p>
                    <p>
                      ユーザー種別：
                      {user?.user_type === "performer"
                        ? "演奏者"
                        : user?.user_type === "facility"
                          ? "施設"
                          : "未設定"}
                    </p>
                    <p>
                      受付日時：
                      {new Date(inquiry.created_at).toLocaleString("ja-JP")}
                    </p>
                  </div>

                  <div className="mt-5 border-t pt-4">
                    <label
                      htmlFor={`status-${inquiry.id}`}
                      className="mb-2 block text-sm font-bold"
                    >
                      対応状況
                    </label>

                    <select
                      id={`status-${inquiry.id}`}
                      value={draftStatus}
                      onChange={(event) =>
                        setStatusDrafts((previous) => ({
                          ...previous,
                          [inquiry.id]: event.target
                            .value as Inquiry["status"],
                        }))
                      }
                      className="w-full rounded-xl border p-3"
                      disabled={isSaving}
                    >
                      <option value="open">未対応</option>
                      <option value="in_progress">対応中</option>
                      <option value="resolved">対応済み</option>
                    </select>

                    <label
                      htmlFor={`reply-${inquiry.id}`}
                      className="mb-2 mt-4 block text-sm font-bold"
                    >
                      管理者からの返信
                    </label>

                    <textarea
                      id={`reply-${inquiry.id}`}
                      value={draftReply}
                      onChange={(event) =>
                        setReplyDrafts((previous) => ({
                          ...previous,
                          [inquiry.id]: event.target.value,
                        }))
                      }
                      maxLength={5000}
                      rows={5}
                      placeholder="問い合わせへの返信を入力してください"
                      className="w-full rounded-xl border p-3 text-sm leading-6"
                      disabled={isSaving}
                    />

                    <p className="mt-1 text-right text-xs text-gray-500">
                      {draftReply.length}/5000文字
                    </p>

                    {inquiry.admin_reply && (
                      <p className="mt-2 text-xs text-gray-500">
                        前回の返信日時：
                        {inquiry.replied_at
                          ? new Date(inquiry.replied_at).toLocaleString(
                              "ja-JP"
                            )
                          : "記録なし"}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => void saveInquiry(inquiry)}
                      disabled={Boolean(savingId) || !idToken}
                      className="mt-3 w-full rounded-xl bg-blue-600 p-3 font-bold text-white disabled:opacity-50"
                    >
                      {isSaving ? "保存中…" : "返信・対応状況を保存"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (idToken) {
              void loadInquiries(idToken, statusFilter);
            }
          }}
          disabled={loading || !idToken || Boolean(savingId)}
          className="mt-6 w-full rounded-xl border bg-white p-3 font-bold disabled:opacity-50"
        >
          再読み込み
        </button>
      </div>
    </main>
  );
}