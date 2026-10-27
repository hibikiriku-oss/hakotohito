"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type MessageUser = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
  users: MessageUser | MessageUser[] | null;
};

type ChatResponse = {
  currentUserId: string;
  messages: Message[];
};

function getUser(
  users: Message["users"]
): MessageUser | null {
  if (!users) {
    return null;
  }

  if (Array.isArray(users)) {
    return users[0] ?? null;
  }

  return users;
}

function formatTime(date: string) {
  const value = new Date(date);

  return (
    String(value.getHours()).padStart(2, "0") +
    ":" +
    String(value.getMinutes()).padStart(2, "0")
  );
}

export default function PerformerMatchChatPage() {
  const router = useRouter();
  const params = useParams();

  const matchId = params.id as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUserId, setCurrentUserId] =
    useState("");

  const [messageText, setMessageText] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [sending, setSending] =
    useState(false);

  const [error, setError] =
    useState("");

  const messagesEndRef =
    useRef<HTMLDivElement | null>(null);

  const lineUserIdRef =
    useRef("");

  async function loadMessages(
    showLoading = false
  ) {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const profile =
        await liff.getProfile();

      lineUserIdRef.current =
        profile.userId;

      const response = await fetch(
        `/api/matches/${matchId}/chat`,
        {
          headers: {
            Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
          },
          cache: "no-store",
        }
      );

      const data =
        (await response.json()) as
          | ChatResponse
          | { error: string };

      if (!response.ok) {
        throw new Error(
          "error" in data
            ? data.error
            : "チャット情報の取得に失敗しました"
        );
      }

      const chatData =
        data as ChatResponse;

      setCurrentUserId(
        chatData.currentUserId
      );

      setMessages(
        chatData.messages ?? []
      );
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "チャット情報の取得に失敗しました"
      );
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let intervalId:
      | ReturnType<typeof setInterval>
      | undefined;

    async function initialize() {
      try {
        await liff.init({
          liffId:
            process.env
              .NEXT_PUBLIC_LIFF_ID!,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        await loadMessages(true);

        intervalId = setInterval(() => {
          loadMessages(false);
        }, 3000);
      } catch (err) {
        console.error(err);

        setError(
          err instanceof Error
            ? err.message
            : "チャットの初期化に失敗しました"
        );

        setLoading(false);
      }
    }

    initialize();

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [matchId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const message =
      messageText.trim();

    if (!message) {
      return;
    }

    if (sending) {
      return;
    }

    try {
      setSending(true);
      setError("");

      let lineUserId =
        lineUserIdRef.current;

      if (!lineUserId) {
        const profile =
          await liff.getProfile();

        lineUserId =
          profile.userId;

        lineUserIdRef.current =
          profile.userId;
      }

      const response = await fetch(
        `/api/matches/${matchId}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
          },
          body: JSON.stringify({
            message,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "メッセージの送信に失敗しました"
        );
      }

      setMessageText("");

      await loadMessages(false);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "メッセージの送信に失敗しました"
      );
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen">
          <div className="bg-black px-5 py-5">
            <div className="h-4 w-32 bg-white/20 rounded animate-pulse" />
            <div className="h-6 w-48 bg-white/20 rounded mt-4 animate-pulse" />
          </div>

          <div className="p-4 space-y-4">
            <div className="flex justify-start">
              <div className="w-48 h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />
            </div>

            <div className="flex justify-end">
              <div className="w-56 h-16 bg-gray-200 rounded-2xl animate-pulse" />
            </div>

            <div className="flex justify-start">
              <div className="w-40 h-12 bg-white rounded-2xl border border-gray-100 animate-pulse" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen flex flex-col">
        {/* ヘッダー */}
        <header className="bg-black text-white px-4 pt-4 pb-5 sticky top-0 z-10 shadow-sm">
          <button
            type="button"
            onClick={() =>
              router.push(
                `/performer/matches/${matchId}`
              )
            }
            className="inline-flex items-center text-sm text-gray-300 py-2"
          >
            ← マッチング詳細に戻る
          </button>

          <div className="flex items-center gap-3 mt-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-xl">
              💬
            </div>

            <div>
              <p className="text-xs text-gray-400 font-medium">
                マッチング成立後の連絡
              </p>

              <h1 className="text-xl font-bold mt-0.5">
                施設との連絡
              </h1>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-3 leading-5">
            演奏時間や当日の流れなどを確認できます。
          </p>
        </header>

        {/* エラー */}
        {error && (
          <div className="mx-4 mt-4 bg-red-50 border border-red-100 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <span className="text-lg">
                ⚠️
              </span>

              <p className="text-sm text-red-700 leading-6">
                {error}
              </p>
            </div>
          </div>
        )}

        {/* メッセージ */}
        <div className="flex-1 p-4 pb-28 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="min-h-[55vh] flex items-center justify-center">
              <div className="text-center px-6">
                <div className="w-16 h-16 rounded-3xl bg-white border border-gray-100 shadow-sm flex items-center justify-center text-3xl mx-auto">
                  💬
                </div>

                <h2 className="font-bold text-gray-800 mt-4">
                  まだメッセージはありません
                </h2>

                <p className="text-sm text-gray-500 mt-2 leading-6">
                  施設に確認したいことや、
                  当日の演奏についての相談を送ってみましょう。
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center mb-5">
                <span className="inline-flex items-center bg-white border border-gray-100 rounded-full px-3 py-1 text-xs text-gray-400">
                  💬 メッセージ
                </span>
              </div>

              <div className="space-y-4">
                {messages.map((item) => {
                  const isMine =
                    item.sender_id ===
                    currentUserId;

                  const user =
                    getUser(item.users);

                  return (
                    <div
                      key={item.id}
                      className={`flex ${
                        isMine
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[82%] ${
                          isMine
                            ? "items-end"
                            : "items-start"
                        } flex flex-col`}
                      >
                        {!isMine && (
                          <div className="flex items-center gap-2 mb-1 px-1">
                            <div className="w-7 h-7 rounded-full bg-white border border-gray-100 flex items-center justify-center text-xs">
                              🏢
                            </div>

                            <p className="text-xs font-medium text-gray-500">
                              {user?.display_name ||
                                "施設"}
                            </p>
                          </div>
                        )}

                        <div
                          className={`px-4 py-3 rounded-2xl shadow-sm ${
                            isMine
                              ? "bg-black text-white rounded-br-md"
                              : "bg-white border border-gray-100 text-gray-800 rounded-bl-md"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words text-sm leading-6">
                            {item.message}
                          </p>
                        </div>

                        <p className="text-[11px] text-gray-400 mt-1 px-1">
                          {formatTime(
                            item.created_at
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 入力欄 */}
        <form
          onSubmit={handleSubmit}
          className="fixed bottom-0 left-0 right-0 z-20 bg-white/95 backdrop-blur border-t border-gray-100"
        >
          <div className="max-w-md mx-auto px-3 pt-3 pb-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2 focus-within:bg-white focus-within:border-black focus-within:ring-2 focus-within:ring-gray-100 transition">
                <textarea
                  value={messageText}
                  onChange={(event) =>
                    setMessageText(
                      event.target.value
                    )
                  }
                  placeholder="メッセージを入力..."
                  rows={1}
                  maxLength={1000}
                  disabled={sending}
                  className="w-full bg-transparent resize-none outline-none text-sm text-gray-900 placeholder:text-gray-400 leading-6 disabled:opacity-50"
                />

                <p className="text-right text-[10px] text-gray-400 mt-1">
                  {messageText.length}/1000
                </p>
              </div>

              <button
                type="submit"
                disabled={
                  sending ||
                  !messageText.trim()
                }
                className="shrink-0 w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center font-bold shadow-sm transition active:scale-95 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                aria-label="メッセージを送信"
              >
                {sending ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span className="text-lg">
                    ↑
                  </span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}