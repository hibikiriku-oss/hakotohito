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

function getUserTypeLabel(userType: string) {
  if (userType === "performer") return "演奏者";
  if (userType === "facility") return "施設";
  return userType || "未設定";
}

export default function AdminCoinsPage() {
  const [idToken, setIdToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [keyword, setKeyword] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] =
    useState<AdminUser | null>(null);

  const [amount, setAmount] = useState("100");
  const [description, setDescription] = useState("");

  const getAuthorizationHeaders = useCallback(() => {
    const token = liff.getIDToken();

    if (!token) {
      throw new Error(
        "LINEの本人確認情報を取得できません。LINEに再ログインしてください。"
      );
    }

    setIdToken(token);

    return {
      Authorization: `Bearer ${token}`,
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "NEXT_PUBLIC_LIFF_ID が設定されていません。"
          );
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login({
            redirectUri: window.location.href,
          });
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
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "管理者権限を確認できませんでした。"
          );
        }

        if (!active) return;

        setUsers(data.users ?? []);
        setAuthorized(true);
      } catch (err) {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : "管理者画面を開けませんでした。"
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    initialize();

    return () => {
      active = false;
    };
  }, []);

  const searchUsers = async () => {
    setSearching(true);
    setError("");
    setNotice("");
    setSelectedUser(null);

    try {
      const headers = getAuthorizationHeaders();
      const params = new URLSearchParams();

      if (keyword.trim()) {
        params.set("q", keyword.trim());
      }

      const response = await fetch(
        `/api/admin/users?${params.toString()}`,
        {
          headers,
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "ユーザー検索に失敗しました。");
      }

      setUsers(data.users ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ユーザー検索に失敗しました。"
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

    // 同じ操作の再送時に二重付与しないため、
    // リクエスト中はボタンを無効にする。
    const idempotencyKey =
      `admin-grant-${crypto.randomUUID()}`;

    try {
      const headers = getAuthorizationHeaders();

      const response = await fetch("/api/admin/coins", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
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

      // 付与後の残高を再取得
      const searchHeaders = getAuthorizationHeaders();
      const params = new URLSearchParams();

      if (keyword.trim()) {
        params.set("q", keyword.trim());
      }

      const refreshResponse = await fetch(
        `/api/admin/users?${params.toString()}`,
        {
          headers: searchHeaders,
          cache: "no-store",
        }
      );

      const refreshData = await refreshResponse.json();

      if (refreshResponse.ok) {
        const refreshedUsers: AdminUser[] =
          refreshData.users ?? [];

        setUsers(refreshedUsers);

        const refreshedSelected = refreshedUsers.find(
          (user) => user.id === selectedUser.id
        );

        if (refreshedSelected) {
          setSelectedUser(refreshedSelected);
        } else {
          setSelectedUser({
            ...selectedUser,
            coinBalance: data.balanceAfter,
          });
        }
      } else {
        setSelectedUser({
          ...selectedUser,
          coinBalance: data.balanceAfter,
        });
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "コイン付与に失敗しました。"
      );
    } finally {
      setGranting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p>管理者権限を確認しています…</p>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-lg mx-auto bg-white rounded-2xl p-6 shadow-sm">
          <h1 className="text-xl font-bold mb-3">
            管理者画面を開けません
          </h1>
          <p className="text-sm text-red-600 whitespace-pre-wrap">
            {error || "管理者権限がありません。"}
          </p>
          <p className="text-sm text-gray-500 mt-4">
            管理者として登録されたLINEアカウントで開いているか確認してください。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <p className="text-sm text-gray-500">ADMINISTRATION</p>
          <h1 className="text-2xl font-bold mt-1">
            🪙 コイン手動付与
          </h1>
          <p className="text-sm text-gray-600 mt-2">
            ユーザーを検索し、付与するコイン数と理由を指定します。
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4 whitespace-pre-wrap"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-4 mb-4"
          >
            {notice}
          </div>
        )}

        <section className="bg-white rounded-2xl p-5 shadow-sm mb-5">
          <h2 className="font-bold mb-3">1. ユーザーを検索</h2>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void searchUsers();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              maxLength={100}
              placeholder="LINEの表示名で検索（空欄で全件）"
              className="flex-1 min-w-0 border rounded-xl p-3"
            />

            <button
              type="submit"
              disabled={searching}
              className="bg-black text-white rounded-xl px-5 py-3 disabled:opacity-50"
            >
              {searching ? "検索中…" : "検索"}
            </button>
          </form>

          <p className="text-xs text-gray-500 mt-2">
            最大50件を表示します。
          </p>

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
                className={`w-full text-left border rounded-xl p-4 ${
                  selectedUser?.id === user.id
                    ? "border-black bg-gray-100"
                    : "border-gray-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold break-words">
                      {user.displayName || "名前未設定"}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {getUserTypeLabel(user.userType)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold">
                      {user.coinBalance.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500">コイン</p>
                  </div>
                </div>
              </button>
            ))}

            {users.length === 0 && (
              <p className="text-sm text-gray-500 py-4">
                該当するユーザーがいません。
              </p>
            )}
          </div>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="font-bold mb-3">2. コインを付与</h2>

          {!selectedUser ? (
            <p className="text-sm text-gray-500">
              先に検索結果からユーザーを選択してください。
            </p>
          ) : (
            <>
              <div className="rounded-xl bg-gray-50 p-4 mb-4">
                <p className="font-bold">
                  {selectedUser.displayName || "名前未設定"}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  {getUserTypeLabel(selectedUser.userType)}
                </p>
                <p className="text-sm mt-2">
                  現在の残高：
                  <strong>
                    {" "}
                    {selectedUser.coinBalance.toLocaleString()} コイン
                  </strong>
                </p>
              </div>

              <label className="block text-sm font-medium mb-2">
                付与コイン数
              </label>
              <input
                type="number"
                min="1"
                max="1000000"
                step="1"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="w-full border rounded-xl p-3 mb-4"
              />

              <label className="block text-sm font-medium mb-2">
                付与理由
              </label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={200}
                rows={3}
                placeholder="例：キャンペーン特典、問い合わせ対応"
                className="w-full border rounded-xl p-3 mb-2"
              />
              <p className="text-xs text-gray-500 mb-4 text-right">
                {description.length}/200文字
              </p>

              <button
                type="button"
                onClick={() => void grantCoins()}
                disabled={granting}
                className="w-full bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
              >
                {granting ? "付与処理中…" : "内容を確認してコインを付与"}
              </button>

              <p className="text-xs text-gray-500 mt-3">
                付与操作は履歴に記録されます。実行前の確認画面が表示されます。
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}