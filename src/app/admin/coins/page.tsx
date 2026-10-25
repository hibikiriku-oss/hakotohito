"use client";

import { useCallback, useEffect, useState } from "react";
import liff from "@line/liff";

type AdminUser = {
  id: string;
  displayName: string;
  userType: string;
  coinBalance: number;
  createdAt: string;
};

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
    | { display_name: string | null; user_type: string | null }
    | { display_name: string | null; user_type: string | null }[]
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

type AdminTab = "coins" | "inquiries" | "rates";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "不具合・エラー",
  account: "アカウント",
  coins: "コイン",
  suggestion: "改善要望",
  other: "その他",
};

const STATUS_LABELS: Record<Inquiry["status"], string> = {
  open: "未対応",
  in_progress: "対応中",
  resolved: "対応済み",
};

function getUserTypeLabel(userType: string) {
  if (userType === "performer") return "演奏者";
  if (userType === "facility") return "施設";
  return userType || "未設定";
}

function getInquiryUser(inquiry: Inquiry) {
  if (Array.isArray(inquiry.users)) return inquiry.users[0] ?? null;
  return inquiry.users;
}

export default function AdminCoinsPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("coins");
  const [idToken, setIdToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [keyword, setKeyword] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState("100");
  const [description, setDescription] = useState("");

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [statusDrafts, setStatusDrafts] = useState<
    Record<string, Inquiry["status"]>
  >({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");
  const [inquiryLoading, setInquiryLoading] = useState(false);
  const [inquiriesLoaded, setInquiriesLoaded] = useState(false);

  const getAuthorizationHeaders = useCallback(() => {
    const token = liff.getIDToken();

    if (!token) {
      throw new Error(
        "LINEの本人確認情報を取得できません。LINEに再ログインしてください。"
      );
    }

    setIdToken(token);
    return { Authorization: `Bearer ${token}` };
  }, []);

  const loadInquiries = useCallback(
    async (token: string, status: string) => {
      setInquiryLoading(true);
      setError("");
      setNotice("");

      try {
        const response = await fetch(
          `/api/admin/inquiries?status=${encodeURIComponent(status)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "問い合わせ一覧を取得できませんでした。");
        }

        const items: Inquiry[] = data.inquiries ?? [];
        setInquiries(items);
        setStatusDrafts((previous) => {
          const next = { ...previous };
          for (const inquiry of items) next[inquiry.id] = inquiry.status;
          return next;
        });
        setReplyDrafts((previous) => {
          const next = { ...previous };
          for (const inquiry of items) next[inquiry.id] = inquiry.admin_reply ?? "";
          return next;
        });
        setInquiriesLoaded(true);
      } catch (err) {
        console.error("問い合わせ一覧取得エラー:", err);
        setError(
          err instanceof Error
            ? err.message
            : "問い合わせ一覧を取得できませんでした。"
        );
        setInquiries([]);
      } finally {
        setInquiryLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId) {
          throw new Error("NEXT_PUBLIC_LIFF_ID が設定されていません。");
        }

        await liff.init({ liffId, withLoginOnExternalBrowser: true });

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }

        const token = liff.getIDToken();
        if (!token) {
          throw new Error(
            "LINEの本人確認情報を取得できません。再ログインしてください。"
          );
        }
        if (!active) return;

        setIdToken(token);
        const response = await fetch("/api/admin/users", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await response.json();

        if (!response.ok) {
          const message =
            data.error || "管理者権限を確認できませんでした。";

          if (
            response.status === 401 &&
            message.includes("本人確認に失敗")
          ) {
            liff.logout();
            liff.login({ redirectUri: window.location.href });
            return;
          }

          throw new Error(message);
        }
        if (!active) return;

        setUsers(data.users ?? []);
        setAuthorized(true);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "管理者画面を開けませんでした。"
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authorized && idToken) {
      void loadInquiries(idToken, statusFilter);
    }
  }, [authorized, idToken, statusFilter, loadInquiries]);

  const searchUsers = async () => {
    setSearching(true);
    setError("");
    setNotice("");
    setSelectedUser(null);

    try {
      const headers = getAuthorizationHeaders();
      const params = new URLSearchParams();
      if (keyword.trim()) params.set("q", keyword.trim());

      const response = await fetch(`/api/admin/users?${params.toString()}`, {
        headers,
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "ユーザー検索に失敗しました。");
      }
      setUsers(data.users ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ユーザー検索に失敗しました。"
      );
    } finally {
      setSearching(false);
    }
  };

  const grantCoins = async () => {
    if (!selectedUser) {
      setError("付与するユーザーを選択してください。");
      return;
    }

    const parsedAmount = Number(amount);
    const trimmedDescription = description.trim();
    if (
      !Number.isSafeInteger(parsedAmount) ||
      parsedAmount <= 0 ||
      parsedAmount > 1000000
    ) {
      setError("付与コイン数は1〜1,000,000の整数で入力してください。");
      return;
    }
    if (!trimmedDescription || trimmedDescription.length > 200) {
      setError("付与理由を1〜200文字で入力してください。");
      return;
    }

    const confirmed = window.confirm(
      `${selectedUser.displayName || "名前未設定"} さんに\n` +
        `${parsedAmount.toLocaleString()} コインを付与します。\n\n` +
        `理由：${trimmedDescription}\n\n` +
        "この操作を実行しますか？"
    );
    if (!confirmed) return;

    setGranting(true);
    setError("");
    setNotice("");
    const idempotencyKey = `admin-grant-${crypto.randomUUID()}`;

    try {
      const headers = getAuthorizationHeaders();
      const response = await fetch("/api/admin/coins", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          amount: parsedAmount,
          description: trimmedDescription,
          idempotencyKey,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "コイン付与に失敗しました。");
      }

      setNotice(
        `${data.user.displayName || "ユーザー"} さんに` +
          ` ${data.amount.toLocaleString()} コインを付与しました。` +
          ` 現在の残高：${data.balanceAfter.toLocaleString()} コイン`
      );
      setDescription("");

      const searchHeaders = getAuthorizationHeaders();
      const params = new URLSearchParams();
      if (keyword.trim()) params.set("q", keyword.trim());
      const refreshResponse = await fetch(
        `/api/admin/users?${params.toString()}`,
        { headers: searchHeaders, cache: "no-store" }
      );
      const refreshData = await refreshResponse.json();

      if (refreshResponse.ok) {
        const refreshedUsers: AdminUser[] = refreshData.users ?? [];
        setUsers(refreshedUsers);
        const refreshedSelected = refreshedUsers.find(
          (user) => user.id === selectedUser.id
        );
        if (refreshedSelected) {
          setSelectedUser(refreshedSelected);
        } else {
          setSelectedUser({ ...selectedUser, coinBalance: data.balanceAfter });
        }
      } else {
        setSelectedUser({ ...selectedUser, coinBalance: data.balanceAfter });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "コイン付与に失敗しました。");
    } finally {
      setGranting(false);
    }
  };

  async function saveInquiry(inquiry: Inquiry) {
    if (!idToken || savingId) return;

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
          body: JSON.stringify({ status, adminReply }),
        }
      );
      const data: InquiryUpdateResponse = await response.json();
      if (!response.ok || !data.inquiry) {
        throw new Error(data.error || "問い合わせを保存できませんでした。");
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
      setStatusDrafts((previous) => ({ ...previous, [inquiry.id]: updated.status }));
      setReplyDrafts((previous) => ({
        ...previous,
        [inquiry.id]: updated.admin_reply ?? "",
      }));
      setNotice(`「${inquiry.subject}」を保存しました。`);
    } catch (err) {
      console.error("問い合わせ更新エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "通信エラーが発生しました。もう一度お試しください。"
      );
    } finally {
      setSavingId("");
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p>管理者権限を確認しています…</p>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="mb-3 text-xl font-bold">管理者画面を開けません</h1>
          <p role="alert" className="whitespace-pre-wrap text-sm text-red-600">
            {error || "管理者権限がありません。"}
          </p>
          <p className="mt-4 text-sm text-gray-500">
            管理者として登録されたLINEアカウントで開いているか確認してください。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-sm text-gray-500">ADMINISTRATION</p>
          <h1 className="mt-1 text-2xl font-bold">管理者メニュー</h1>
          <p className="mt-2 text-sm text-gray-600">
            コイン付与と問い合わせ対応を管理できます。
          </p>
        </header>

      <div
        className="mb-5 grid grid-cols-3 gap-2 rounded-2xl bg-white p-2 shadow-sm"
        role="tablist"
        aria-label="管理機能"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "coins"}
          onClick={() => {
            setActiveTab("coins");
            setError("");
            setNotice("");
          }}
          className={`rounded-xl px-2 py-3 text-sm font-bold ${
            activeTab === "coins"
              ? "bg-black text-white"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          🪙 コイン管理
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "inquiries"}
          onClick={() => {
            setActiveTab("inquiries");
            setError("");
            setNotice("");
            if (!inquiriesLoaded && idToken) {
              void loadInquiries(idToken, statusFilter);
            }
          }}
          className={`rounded-xl px-2 py-3 text-sm font-bold ${
            activeTab === "inquiries"
              ? "bg-black text-white"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          📩 問い合わせ管理
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "rates"}
          onClick={() => {
            setActiveTab("rates");
            setError("");
            setNotice("");
          }}
          className={`rounded-xl px-2 py-3 text-sm font-bold ${
            activeTab === "rates"
              ? "bg-black text-white"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          ⚙️ 消費コイン設定
        </button>
      </div>
        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 whitespace-pre-wrap">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-green-800">
            {notice}
          </div>
        )}

        {activeTab === "rates" ? (
            <CoinRateSettingsPanel token={idToken} />
        ) : activeTab === "coins" ? (
          <>
            <section className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-bold">1. ユーザーを検索</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchUsers();
                }}
                className="flex flex-col gap-2 sm:flex-row"
              >
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  maxLength={100}
                  placeholder="LINEの表示名で検索（空欄で全件）"
                  className="min-w-0 flex-1 rounded-xl border p-3"
                />
                <button type="submit" disabled={searching} className="rounded-xl bg-black px-5 py-3 text-white disabled:opacity-50">
                  {searching ? "検索中…" : "検索"}
                </button>
              </form>
              <p className="mt-2 text-xs text-gray-500">最大50件を表示します。</p>
              <div className="mt-4 space-y-2">
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedUser(user);
                      setError("");
                      setNotice("");
                    }}
                    className={`w-full rounded-xl border p-4 text-left ${selectedUser?.id === user.id ? "border-black bg-gray-100" : "border-gray-200"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-bold">{user.displayName || "名前未設定"}</p>
                        <p className="mt-1 text-sm text-gray-500">{getUserTypeLabel(user.userType)}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-bold">{user.coinBalance.toLocaleString()}</p>
                        <p className="text-xs text-gray-500">コイン</p>
                      </div>
                    </div>
                  </button>
                ))}
                {users.length === 0 && <p className="py-4 text-sm text-gray-500">該当するユーザーがいません。</p>}
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="mb-3 font-bold">2. コインを付与</h2>
              {!selectedUser ? (
                <p className="text-sm text-gray-500">先に検索結果からユーザーを選択してください。</p>
              ) : (
                <>
                  <div className="mb-4 rounded-xl bg-gray-50 p-4">
                    <p className="font-bold">{selectedUser.displayName || "名前未設定"}</p>
                    <p className="mt-1 text-sm text-gray-600">{getUserTypeLabel(selectedUser.userType)}</p>
                    <p className="mt-2 text-sm">現在の残高：<strong>{selectedUser.coinBalance.toLocaleString()} コイン</strong></p>
                  </div>
                  <label htmlFor="coin-amount" className="mb-2 block text-sm font-medium">付与コイン数</label>
                  <input id="coin-amount" type="number" min="1" max="1000000" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} className="mb-4 w-full rounded-xl border p-3" />
                  <label htmlFor="coin-description" className="mb-2 block text-sm font-medium">付与理由</label>
                  <textarea id="coin-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} rows={3} placeholder="例：キャンペーン特典、問い合わせ対応" className="mb-2 w-full rounded-xl border p-3" />
                  <p className="mb-4 text-right text-xs text-gray-500">{description.length}/200文字</p>
                  <button type="button" onClick={() => void grantCoins()} disabled={granting} className="w-full rounded-xl bg-black p-4 font-bold text-white disabled:opacity-50">
                    {granting ? "付与処理中…" : "内容を確認してコインを付与"}
                  </button>
                  <p className="mt-3 text-xs text-gray-500">付与操作は履歴に記録されます。実行前の確認画面が表示されます。</p>
                </>
              )}
            </section>
          </>
        ) : (
          <>
            <section className="mb-5 rounded-2xl bg-white p-4 shadow-sm">
              <label htmlFor="inquiry-status-filter" className="mb-2 block text-sm font-bold">対応状況で絞り込む</label>
              <select id="inquiry-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full rounded-xl border p-3">
                <option value="all">すべて</option>
                <option value="open">未対応</option>
                <option value="in_progress">対応中</option>
                <option value="resolved">対応済み</option>
              </select>
              <p className="mt-3 text-sm text-gray-500">表示件数：{inquiries.length}件（最大100件）</p>
            </section>

            {inquiryLoading ? (
              <div className="rounded-2xl bg-white p-6 text-center text-gray-500">問い合わせを読み込んでいます…</div>
            ) : inquiries.length === 0 ? (
              <div className="rounded-2xl bg-white p-6 text-center text-gray-500">問い合わせはありません。</div>
            ) : (
              <div className="space-y-4">
                {inquiries.map((inquiry) => {
                  const user = getInquiryUser(inquiry);
                  const draftStatus = statusDrafts[inquiry.id] ?? inquiry.status;
                  const draftReply = replyDrafts[inquiry.id] ?? inquiry.admin_reply ?? "";
                  const isSaving = savingId === inquiry.id;

                  return (
                    <article key={inquiry.id} className="rounded-2xl bg-white p-5 shadow-sm">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs">{CATEGORY_LABELS[inquiry.category] ?? inquiry.category}</span>
                        <span className={`rounded-full px-3 py-1 text-xs ${inquiry.status === "resolved" ? "bg-green-100 text-green-800" : inquiry.status === "in_progress" ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800"}`}>
                          現在：{STATUS_LABELS[inquiry.status]}
                        </span>
                      </div>
                      <h2 className="mb-2 break-words text-lg font-bold">{inquiry.subject}</h2>
                      <p className="mb-3 whitespace-pre-wrap break-words text-sm leading-6">{inquiry.message}</p>
                      <div className="border-t pt-3 text-xs leading-5 text-gray-500">
                        <p>送信者：{user?.display_name || "名前未設定"}</p>
                        <p>ユーザー種別：{user?.user_type === "performer" ? "演奏者" : user?.user_type === "facility" ? "施設" : "未設定"}</p>
                        <p>受付日時：{new Date(inquiry.created_at).toLocaleString("ja-JP")}</p>
                      </div>
                      <div className="mt-5 border-t pt-4">
                        <label htmlFor={`inquiry-status-${inquiry.id}`} className="mb-2 block text-sm font-bold">対応状況</label>
                        <select id={`inquiry-status-${inquiry.id}`} value={draftStatus} onChange={(event) => setStatusDrafts((previous) => ({ ...previous, [inquiry.id]: event.target.value as Inquiry["status"] }))} className="w-full rounded-xl border p-3" disabled={isSaving}>
                          <option value="open">未対応</option>
                          <option value="in_progress">対応中</option>
                          <option value="resolved">対応済み</option>
                        </select>
                        <label htmlFor={`inquiry-reply-${inquiry.id}`} className="mb-2 mt-4 block text-sm font-bold">管理者からの返信</label>
                        <textarea id={`inquiry-reply-${inquiry.id}`} value={draftReply} onChange={(event) => setReplyDrafts((previous) => ({ ...previous, [inquiry.id]: event.target.value }))} maxLength={5000} rows={5} placeholder="問い合わせへの返信を入力してください" className="w-full rounded-xl border p-3 text-sm leading-6" disabled={isSaving} />
                        <p className="mt-1 text-right text-xs text-gray-500">{draftReply.length}/5000文字</p>
                        {inquiry.admin_reply && (
                          <p className="mt-2 text-xs text-gray-500">前回の返信日時：{inquiry.replied_at ? new Date(inquiry.replied_at).toLocaleString("ja-JP") : "記録なし"}</p>
                        )}
                        <button type="button" onClick={() => void saveInquiry(inquiry)} disabled={Boolean(savingId) || !idToken} className="mt-3 w-full rounded-xl bg-blue-600 p-3 font-bold text-white disabled:opacity-50">
                          {isSaving ? "保存中…" : "返信・対応状況を保存"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <button type="button" onClick={() => { if (idToken) void loadInquiries(idToken, statusFilter); }} disabled={inquiryLoading || !idToken || Boolean(savingId)} className="mt-6 w-full rounded-xl border bg-white p-3 font-bold disabled:opacity-50">
              再読み込み
            </button>
          </>
        )}
      </div>
    </main>
  );
}

type CoinRateDraft = {
  application_fee_coins: string;
  direct_invitation_fee_coins: string;
  match_fee_coins: string;
  completion_fee_percent: string;
  free_lesson_match_fee_coins: string;
  paid_lesson_fee_percent: string;
};

type CoinRateKey = keyof CoinRateDraft;

type CoinRateField = {
  key: CoinRateKey;
  label: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
};

const COIN_RATE_FIELDS: CoinRateField[] = [
  {
    key: "application_fee_coins",
    label: "演奏案件への応募料",
    description: "個人での応募・バンドでの応募に適用",
    unit: "コイン",
    min: 1,
    max: 1000000,
    step: 1,
    integer: true,
  },
  {
    key: "direct_invitation_fee_coins",
    label: "施設からの直接依頼料",
    description: "施設が演奏者へ直接依頼するときに適用",
    unit: "コイン",
    min: 1,
    max: 1000000,
    step: 1,
    integer: true,
  },
  {
    key: "match_fee_coins",
    label: "マッチング成立手数料",
    description: "通常案件のマッチング成立時に適用",
    unit: "コイン",
    min: 1,
    max: 1000000,
    step: 1,
    integer: true,
  },
  {
    key: "completion_fee_percent",
    label: "演奏完了時の手数料",
    description: "報酬・イベント参加費・レンタル料に対する割合",
    unit: "%",
    min: 0,
    max: 100,
    step: 0.01,
    integer: false,
  },
  {
    key: "free_lesson_match_fee_coins",
    label: "無料レッスンの成立手数料",
    description: "無料レッスンの成立1人あたりに適用",
    unit: "コイン / 人",
    min: 1,
    max: 1000000,
    step: 1,
    integer: true,
  },
  {
    key: "paid_lesson_fee_percent",
    label: "有料レッスンの成立手数料",
    description: "レッスン料金に対する割合。計算結果は切り上げ",
    unit: "%",
    min: 0,
    max: 100,
    step: 0.01,
    integer: false,
  },
];

const DEFAULT_COIN_RATE_DRAFT: CoinRateDraft = {
  application_fee_coins: "10",
  direct_invitation_fee_coins: "100",
  match_fee_coins: "100",
  completion_fee_percent: "1",
  free_lesson_match_fee_coins: "5",
  paid_lesson_fee_percent: "1",
};

type CoinRateRecord = CoinRateDraft & {
  id: number;
  updated_at: string;
  updated_by_line_user_id: string | null;
};

function CoinRateSettingsPanel({ token }: { token: string }) {
  const [rates, setRates] = useState<CoinRateDraft>(
    DEFAULT_COIN_RATE_DRAFT
  );
  const [updatedAt, setUpdatedAt] = useState("");
  const [loadingRates, setLoadingRates] = useState(true);
  const [savingRates, setSavingRates] = useState(false);
  const [ratesLoaded, setRatesLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadRates = useCallback(async () => {
    if (!token) return;

    setLoadingRates(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/coin-rates", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.rates) {
        throw new Error(
          data.error || "消費コイン設定を取得できませんでした。"
        );
      }

      const saved = data.rates as CoinRateRecord;

      setRates({
        application_fee_coins: String(saved.application_fee_coins),
        direct_invitation_fee_coins: String(
          saved.direct_invitation_fee_coins
        ),
        match_fee_coins: String(saved.match_fee_coins),
        completion_fee_percent: String(saved.completion_fee_percent),
        free_lesson_match_fee_coins: String(
          saved.free_lesson_match_fee_coins
        ),
        paid_lesson_fee_percent: String(saved.paid_lesson_fee_percent),
      });

      setUpdatedAt(saved.updated_at || "");
      setRatesLoaded(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "消費コイン設定を取得できませんでした。"
      );
    } finally {
      setLoadingRates(false);
    }
  }, [token]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  function updateRate(key: CoinRateKey, value: string) {
    setRates((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  async function saveRates() {
    if (!token || savingRates) return;

    if (!ratesLoaded) {
      setError("保存前に現在の設定を読み込んでください。");
      return;
    }

    const numericRates = {} as Record<CoinRateKey, number>;

    for (const field of COIN_RATE_FIELDS) {
      const rawValue = rates[field.key];

      if (!rawValue.trim()) {
        setError(`${field.label}を入力してください。`);
        return;
      }

      const value = Number(rawValue);

      if (
        !Number.isFinite(value) ||
        value < field.min ||
        value > field.max ||
        (field.integer && !Number.isSafeInteger(value)) ||
        (!field.integer && Math.round(value * 100) !== value * 100)
      ) {
        setError(
          field.integer
            ? `${field.label}は${field.min.toLocaleString()}〜${field.max.toLocaleString()}の整数で入力してください。`
            : `${field.label}は0〜100の範囲で小数第2位まで入力してください。`
        );
        return;
      }

      numericRates[field.key] = value;
    }

    const confirmed = window.confirm(
      "消費コイン設定を変更します。\n\n" +
        `応募料：${numericRates.application_fee_coins} コイン\n` +
        `直接依頼料：${numericRates.direct_invitation_fee_coins} コイン\n` +
        `成立手数料：${numericRates.match_fee_coins} コイン\n` +
        `完了手数料率：${numericRates.completion_fee_percent}%\n` +
        `無料レッスン：${numericRates.free_lesson_match_fee_coins} コイン / 人\n` +
        `有料レッスン：${numericRates.paid_lesson_fee_percent}%\n\n` +
        "この内容で保存しますか？"
    );

    if (!confirmed) return;

    setSavingRates(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/coin-rates", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(numericRates),
      });

      const data = await response.json();

      if (!response.ok || !data.rates) {
        throw new Error(
          data.error || "消費コイン設定を保存できませんでした。"
        );
      }

      const saved = data.rates as CoinRateRecord;

      setRates({
        application_fee_coins: String(saved.application_fee_coins),
        direct_invitation_fee_coins: String(
          saved.direct_invitation_fee_coins
        ),
        match_fee_coins: String(saved.match_fee_coins),
        completion_fee_percent: String(saved.completion_fee_percent),
        free_lesson_match_fee_coins: String(
          saved.free_lesson_match_fee_coins
        ),
        paid_lesson_fee_percent: String(saved.paid_lesson_fee_percent),
      });

      setUpdatedAt(saved.updated_at || "");
      setNotice(
        "設定を保存しました。実際の消費・返金への反映確認は、DB関数の更新後に行います。"
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "消費コイン設定を保存できませんでした。"
      );
    } finally {
      setSavingRates(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">⚙️ 消費コイン設定</h2>

      <p className="mt-2 text-sm leading-6 text-gray-600">
        各機能で消費するコイン数や手数料率を設定します。
        固定料金は1〜1,000,000コイン、割合は0〜100%で指定できます。
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 whitespace-pre-wrap rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800"
        >
          {notice}
        </div>
      )}

      {loadingRates ? (
        <p className="mt-6 text-center text-gray-500">
          設定を読み込んでいます…
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {COIN_RATE_FIELDS.map((field) => (
            <div key={field.key} className="border-b pb-5 last:border-b-0">
              <label
                htmlFor={`coin-rate-${field.key}`}
                className="block font-bold"
              >
                {field.label}
              </label>

              <p className="mt-1 text-sm leading-5 text-gray-500">
                {field.description}
              </p>

              <div className="mt-3 flex items-center gap-3">
                <input
                  id={`coin-rate-${field.key}`}
                  type="number"
                  inputMode="decimal"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={rates[field.key]}
                  onChange={(event) =>
                    updateRate(field.key, event.target.value)
                  }
                  disabled={savingRates}
                  className="min-w-0 flex-1 rounded-xl border p-3 disabled:bg-gray-100"
                />

                <span className="shrink-0 text-sm text-gray-600">
                  {field.unit}
                </span>
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-3 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={() => void saveRates()}
              disabled={savingRates || !ratesLoaded}
              className="flex-1 rounded-xl bg-black p-4 font-bold text-white disabled:opacity-50"
            >
              {savingRates ? "保存中…" : "設定を確認して保存"}
            </button>

            <button
              type="button"
              onClick={() => void loadRates()}
              disabled={loadingRates || savingRates}
              className="rounded-xl border p-4 font-bold disabled:opacity-50"
            >
              再読み込み
            </button>
          </div>

          {updatedAt && (
            <p className="text-xs text-gray-500">
              最終更新：{new Date(updatedAt).toLocaleString("ja-JP")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}