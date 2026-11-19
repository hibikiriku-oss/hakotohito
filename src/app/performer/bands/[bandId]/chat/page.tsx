"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type ChatMessage = {
  id: string;
  bandId: string;
  senderPerformerId: string;
  senderName: string;
  message: string;
  createdAt: string;
  isMine: boolean;
};

const inputClass =
  "w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 outline-none focus:border-black focus:bg-white";

function formatMessageDate(value: string) {
  return new Date(value).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BandChatPage() {
  const router = useRouter();
  const params = useParams<{ bandId: string }>();
  const bandId = params.bandId;

  const [bandName, setBandName] = useState("バンドチャット");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [idToken, setIdToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const getToken = useCallback(async () => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

    if (!liffId) {
      throw new Error("LINEログインの設定がありません");
    }

    await liff.init({
      liffId,
      withLoginOnExternalBrowser: true,
    });

    if (!liff.isLoggedIn()) {
      liff.login();
      return null;
    }

    const token = liff.getIDToken();

    if (!token) {
      throw new Error(
        "LINEの認証情報を取得できませんでした。LINEアプリから開き直してください"
      );
    }

    return token;
  }, []);

  const loadMessages = useCallback(
    async (token: string) => {
      const response = await fetch(
        `/api/bands/${encodeURIComponent(bandId)}/messages`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "チャット履歴を取得できませんでした"
        );
      }

      setBandName(data.band?.name || "バンドチャット");
      setMessages(
        Array.isArray(data.messages) ? data.messages : []
      );
    },
    [bandId]
  );

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const token = await getToken();

        if (!token || cancelled) {
          return;
        }

        setIdToken(token);
        await loadMessages(token);
      } catch (err) {
        console.error("バンドチャット初期化エラー:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "チャットを開けませんでした"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [getToken, loadMessages]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError("");
      setNotice("");

      const token = await getToken();

      if (!token) {
        return;
      }

      setIdToken(token);
      await loadMessages(token);
      setNotice("チャットを更新しました");
    } catch (err) {
      console.error("チャット更新エラー:", err);

      setError(
        err instanceof Error
          ? err.message
          : "チャットを更新できませんでした"
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleSend = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const trimmedMessage = messageText.trim();

    if (!trimmedMessage) {
      return;
    }

    if (trimmedMessage.length > 2000) {
      setError("メッセージは2000文字以内で入力してください");
      return;
    }

    try {
      setSending(true);
      setError("");
      setNotice("");

      const token = await getToken();

      if (!token) {
        return;
      }

      setIdToken(token);

      const response = await fetch(
        `/api/bands/${encodeURIComponent(bandId)}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: trimmedMessage,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "メッセージを送信できませんでした"
        );
      }

      if (data.message) {
        setMessages((previous) => [
          ...previous,
          data.message as ChatMessage,
        ]);
      }

      setMessageText("");
    } catch (err) {
      console.error("チャット送信エラー:", err);

      setError(
        err instanceof Error
          ? err.message
          : "メッセージを送信できませんでした"
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-5">
        <header className="mb-5">
          <button
            type="button"
            onClick={() => router.push("/performer/bands")}
            className="mb-4 text-sm font-bold text-gray-500"
          >
            ← バンド管理へ戻る
          </button>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-bold tracking-wider text-gray-400">
                BAND CHAT
              </p>

              <h1 className="break-words text-2xl font-bold text-gray-900">
                {bandName}
              </h1>

              <p className="mt-2 text-sm text-gray-500">
                バンドメンバーとのチャット
              </p>
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-50"
            >
              {refreshing ? "更新中..." : "↻ 更新"}
            </button>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {notice && (
          <p
            role="status"
            className="mb-3 text-xs text-gray-500"
          >
            {notice}
          </p>
        )}

        <section className="mb-4 flex-1 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">
              チャットを読み込み中...
            </div>
          ) : messages.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-4xl">💬</p>
              <p className="mt-3 text-sm font-bold text-gray-700">
                まだメッセージはありません
              </p>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                最初のメッセージを送って、会話を始めましょう。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.isMine
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      message.isMine
                        ? "bg-amber-100 text-gray-900"
                        : "border border-gray-200 bg-white text-gray-900"
                    }`}
                  >
                    <p className="mb-1 text-xs font-bold text-gray-600">
                      {message.isMine ? "あなた" : message.senderName}
                    </p>

                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {message.message}
                    </p>

                    <p className="mt-2 text-right text-[10px] text-gray-500">
                      {formatMessageDate(message.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
          <form onSubmit={handleSend} className="space-y-3">
            <label
              htmlFor="chat-message"
              className="block text-sm font-bold text-gray-800"
            >
              メッセージ
            </label>

            <textarea
              id="chat-message"
              value={messageText}
              onChange={(event) =>
                setMessageText(event.target.value)
              }
              rows={3}
              maxLength={2000}
              placeholder="メッセージを入力してください"
              className={`${inputClass} resize-none`}
              disabled={sending || loading || !idToken}
            />

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-400">
                {messageText.length}/2000文字
              </p>

              <button
                type="submit"
                disabled={
                  sending ||
                  loading ||
                  !idToken ||
                  !messageText.trim()
                }
                className="rounded-2xl bg-black px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? "送信中..." : "送信する"}
              </button>
            </div>
          </form>
        </section>

        <p className="mt-3 text-center text-xs leading-5 text-gray-400">
          ほかのメンバーの新しいメッセージは「更新」を押して確認してください。
        </p>
      </div>
    </main>
  );
}