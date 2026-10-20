"use client";

import { FormEvent, useEffect, useState } from "react";
import liff from "@line/liff";

const CATEGORIES = [
  { value: "bug", label: "不具合・エラー" },
  { value: "account", label: "アカウントについて" },
  { value: "coins", label: "コインについて" },
  { value: "suggestion", label: "改善要望・ご意見" },
  { value: "other", label: "その他" },
];

export default function InquiryPage() {
  const [ready, setReady] = useState(false);
  const [category, setCategory] = useState("other");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

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

        setReady(true);
      } catch (err) {
        console.error("問い合わせ画面の初期化エラー:", err);
        setError("LINEの初期化に失敗しました。画面を開き直してください。");
      }
    }

    initialize();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();

    if (!trimmedSubject || !trimmedMessage) {
      setError("件名と問い合わせ内容を入力してください。");
      return;
    }

    if (trimmedSubject.length > 100) {
      setError("件名は100文字以内で入力してください。");
      return;
    }

    if (trimmedMessage.length > 5000) {
      setError("問い合わせ内容は5000文字以内で入力してください。");
      return;
    }

    const idToken = liff.getIDToken();

    if (!idToken) {
      setError("LINEの本人確認情報を取得できません。再ログインしてください。");
      return;
    }

    setSending(true);

    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idToken,
          category,
          subject: trimmedSubject,
          message: trimmedMessage,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "問い合わせを送信できませんでした。");
        return;
      }

      setSuccess(true);
      setSubject("");
      setMessage("");
    } catch (err) {
      console.error("問い合わせ送信エラー:", err);
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setSending(false);
    }
  }

  if (!ready && !error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-gray-600">LINEとの接続を確認しています…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-5">
      <div className="max-w-lg mx-auto">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mb-5 text-sm text-gray-600"
        >
          ← 戻る
        </button>

        <h1 className="text-2xl font-bold mb-2">お問い合わせ</h1>
        <p className="text-sm text-gray-600 mb-6">
          不具合やご要望など、お気軽にお送りください。
        </p>

        {success && (
          <div
            role="status"
            className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-green-800"
          >
            お問い合わせを送信しました。ご連絡ありがとうございます。
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl bg-white p-5 shadow-sm"
        >
          <div>
            <label
              htmlFor="category"
              className="mb-2 block text-sm font-bold"
            >
              問い合わせカテゴリ
            </label>
            <select
              id="category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-xl border p-3"
              disabled={sending}
            >
              {CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="subject"
              className="mb-2 block text-sm font-bold"
            >
              件名
            </label>
            <input
              id="subject"
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={100}
              required
              placeholder="例：コイン残高について"
              className="w-full rounded-xl border p-3"
              disabled={sending}
            />
            <p className="mt-1 text-right text-xs text-gray-500">
              {subject.length}/100文字
            </p>
          </div>

          <div>
            <label
              htmlFor="message"
              className="mb-2 block text-sm font-bold"
            >
              お問い合わせ内容
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={5000}
              required
              rows={7}
              placeholder="お問い合わせの内容を入力してください"
              className="w-full resize-y rounded-xl border p-3"
              disabled={sending}
            />
            <p className="mt-1 text-right text-xs text-gray-500">
              {message.length}/5000文字
            </p>
          </div>

          <button
            type="submit"
            disabled={!ready || sending}
            className="w-full rounded-xl bg-black p-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "送信中…" : "お問い合わせを送信"}
          </button>
        </form>

        <p className="mt-4 text-xs leading-5 text-gray-500">
          送信された内容は、問い合わせへの対応のために利用します。
          パスワードなどの重要な情報は入力しないでください。
        </p>
      </div>
    </main>
  );
}