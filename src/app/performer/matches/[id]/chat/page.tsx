"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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
            "x-line-user-id":
              profile.userId,
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
            "x-line-user-id":
              lineUserId,
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
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-gray-600">
            チャットを読み込み中...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen flex flex-col">

        {/* ヘッダー */}
        <header className="bg-white border-b p-4 sticky top-0 z-10">
          <button
            onClick={() =>
              router.push(
                `/performer/matches/${matchId}`
              )
            }
            className="text-gray-600"
          >
            ← マッチング詳細に戻る
          </button>

          <h1 className="text-xl font-bold mt-3">
            💬 施設との連絡
          </h1>

          <p className="text-sm text-gray-500 mt-1">
            演奏時間や当日の流れなどを確認できます。
          </p>
        </header>

        {/* エラー */}
        {error && (
          <div className="mx-4 mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm text-red-600">
              {error}
            </p>
          </div>
        )}

        {/* メッセージ */}
        <div className="flex-1 p-4 space-y-3 overflow-y-auto">

          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl">
                💬
              </div>

              <p className="mt-3 text-gray-600">
                まだメッセージはありません。
              </p>

              <p className="mt-1 text-sm text-gray-400">
                施設に確認したいことを送ってみましょう。
              </p>
            </div>
          ) : (
            messages.map((item) => {
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
                    className={`max-w-[80%] ${
                      isMine
                        ? "items-end"
                        : "items-start"
                    } flex flex-col`}
                  >
                    {!isMine && (
                      <p className="text-xs text-gray-500 mb-1 px-1">
                        {user?.display_name ||
                          "施設"}
                      </p>
                    )}

                    <div
                      className={`rounded-2xl px-4 py-3 ${
                        isMine
                          ? "bg-black text-white rounded-br-md"
                          : "bg-white border text-gray-800 rounded-bl-md"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {item.message}
                      </p>
                    </div>

                    <p className="text-xs text-gray-400 mt-1 px-1">
                      {formatTime(
                        item.created_at
                      )}
                    </p>
                  </div>
                </div>
              );
            })
          )}

          <div ref={messagesEndRef} />

        </div>

        {/* 入力欄 */}
        <form
          onSubmit={handleSubmit}
          className="bg-white border-t p-3 sticky bottom-0"
        >
          <div className="flex items-end gap-2">

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
              className="flex-1 resize-none border rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-black disabled:bg-gray-100"
            />

            <button
              type="submit"
              disabled={
                sending ||
                !messageText.trim()
              }
              className="bg-black text-white rounded-2xl px-5 py-3 font-bold disabled:bg-gray-300"
            >
              {sending
                ? "送信中..."
                : "送信"}
            </button>

          </div>

          <p className="text-right text-xs text-gray-400 mt-1">
            {messageText.length}/1000
          </p>
        </form>

      </div>
    </main>
  );
}