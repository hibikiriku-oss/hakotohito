"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type Match = {
  id: string;
  status: string;
  performance_status: "scheduled" | "completed" | "cancelled";
  completion_disputed_at: string | null;
  completion_disputed_by: string | null;
  completion_dispute_reason: string | null;
};

export default function PerformerMatchDisputePage() {
  const router = useRouter();
  const params = useParams();
  const matchId = params.id as string;

  const [match, setMatch] = useState<Match | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadMatch() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("LINE MINI Appの設定がありません");
        }

        await liff.init({ liffId });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const idToken = liff.getIDToken();

        if (!idToken) {
          throw new Error(
            "LINEの本人確認情報を取得できませんでした。再ログインしてください。"
          );
        }

        const response = await fetch(
          `/api/performer/matches/${matchId}`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "マッチング情報の取得に失敗しました"
          );
        }

        setMatch(data.match);
      } catch (err) {
        console.error("マッチング情報取得エラー:", err);
        setError(
          err instanceof Error
            ? err.message
            : "マッチング情報を取得できませんでした"
        );
      } finally {
        setLoading(false);
      }
    }

    loadMatch();
  }, [matchId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting || !match) return;

    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      setError("申し立て理由を入力してください");
      return;
    }

    if (trimmedReason.length > 1000) {
      setError("申し立て理由は1000文字以内で入力してください");
      return;
    }

    if (
      match.status !== "active" ||
      match.performance_status === "completed" ||
      match.performance_status === "cancelled" ||
      match.completion_disputed_at
    ) {
      setError("現在の演奏状況では異議申し立てできません");
      return;
    }

    if (
      !window.confirm(
        "この理由で異議申し立てを送信しますか？\n\n申し立て後は、演奏完了の確定が停止されます。"
      )
    ) {
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

      if (!liffId) {
        throw new Error("LINE MINI Appの設定がありません");
      }

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      const profile = await liff.getProfile();

      const response = await fetch(
        `/api/performer/matches/${matchId}/dispute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
          },
          body: JSON.stringify({ reason: trimmedReason }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "異議申し立ての送信に失敗しました"
        );
      }

      window.alert("異議申し立てを登録しました。");
      router.replace(`/performer/matches/${matchId}`);
    } catch (err) {
      console.error("異議申し立て送信エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "異議申し立ての送信に失敗しました"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-gray-600">読み込み中...</p>
        </div>
      </main>
    );
  }

  if (!match) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-bold">エラー</h1>
          <p className="mt-4 text-red-600">
            {error || "マッチング情報が見つかりません"}
          </p>
          <button
            onClick={() => router.push("/performer/matches")}
            className="mt-6 w-full bg-black text-white rounded-xl p-4"
          >
            マッチング一覧に戻る
          </button>
        </div>
      </main>
    );
  }

  const unavailable =
    match.status !== "active" ||
    match.performance_status === "completed" ||
    match.performance_status === "cancelled" ||
    Boolean(match.completion_disputed_at);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">
        <button
          onClick={() => router.push(`/performer/matches/${matchId}`)}
          className="text-gray-600 mb-4"
        >
          ← マッチング詳細に戻る
        </button>

        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <div className="text-3xl text-center">⚠️</div>

          <h1 className="text-2xl font-bold mt-2 text-center">
            演奏完了への異議申し立て
          </h1>

          <p className="mt-4 text-sm text-gray-600">
            演奏が実施されていない場合や、演奏完了の報告内容に相違がある場合に、理由を記入して申し立ててください。
          </p>

          <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="font-bold text-amber-800">
              送信前にご確認ください
            </p>
            <p className="mt-2 text-sm text-gray-700">
              申し立てが登録されると、演奏完了の確定が停止されます。施設側と内容を確認し、話し合って解決してください。
            </p>
          </div>

          {match.completion_disputed_at ? (
            <div className="mt-5 bg-gray-50 border rounded-xl p-4">
              <p className="font-bold text-amber-800">
                すでに異議申し立てが登録されています
              </p>
              <p className="mt-3 text-sm text-gray-600">
                申し立て理由
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {match.completion_dispute_reason ||
                  "理由の記録はありません"}
              </p>
              <button
                onClick={() =>
                  router.replace(`/performer/matches/${matchId}`)
                }
                className="w-full mt-5 bg-black text-white rounded-xl p-4 font-bold"
              >
                マッチング詳細に戻る
              </button>
            </div>
          ) : unavailable ? (
            <div className="mt-5 bg-gray-50 border rounded-xl p-4">
              <p className="font-bold text-gray-700">
                現在の演奏状況では申し立てできません。
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6">
              <label
                htmlFor="reason"
                className="block font-bold text-gray-800"
              >
                申し立て理由
              </label>

              <textarea
                id="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                rows={7}
                required
                placeholder="例：当日の演奏が実施されていないため、完了報告に異議があります。"
                className="w-full mt-3 border rounded-xl p-4 resize-y focus:outline-none focus:ring-2 focus:ring-amber-400"
              />

              <p className="mt-1 text-xs text-gray-500 text-right">
                {reason.length}/1000文字
              </p>

              {error && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !reason.trim()}
                className="w-full mt-5 bg-amber-600 text-white rounded-xl p-4 font-bold disabled:opacity-50"
              >
                {submitting
                  ? "送信中..."
                  : "異議申し立てを送信"}
              </button>
            </form>
          )}

          <button
            onClick={() =>
              router.push(`/performer/matches/${matchId}`)
            }
            className="w-full mt-4 bg-white border rounded-xl p-4 font-medium"
          >
            キャンセルして戻る
          </button>
        </div>
      </div>
    </main>
  );
}