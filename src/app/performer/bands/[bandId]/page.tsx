
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type BandMember = {
  performerId: string;
  name: string;
  role: string;
  joinedAt: string;
  isMe: boolean;
};

type BandDetail = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  role: string;
  joinedAt: string;
};

export default function BandDetailPage() {
  const router = useRouter();
  const params = useParams();
  const bandId = params.bandId as string;

  const [band, setBand] = useState<BandDetail | null>(null);
  const [members, setMembers] = useState<BandMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [disbanding, setDisbanding] = useState(false);
  const [actionError, setActionError] = useState("");
  const loadBand = useCallback(async () => {
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
      return;
    }

    const token = liff.getIDToken();

    if (!token) {
      throw new Error(
        "LINEの認証情報を取得できませんでした。LINEアプリから開き直してください"
      );
    }

    const response = await fetch(`/api/bands/${bandId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "バンド情報の取得に失敗しました"
      );
    }

    setBand(data.band);
    setMembers(Array.isArray(data.members) ? data.members : []);
  }, [bandId]);

  async function handleDisband() {
    if (!band || disbanding) return;

    const confirmed = window.confirm(
      `本当に「${band.name}」を解散しますか？\n\n` +
        "・すべてのメンバーが所属解除されます\n" +
        "・未回答の招待はキャンセルされます\n" +
        "・過去の応募、マッチング、コイン履歴は保持されます\n\n" +
        "解散後、このバンドを元に戻すことはできません。"
    );

    if (!confirmed) return;

    try {
      setDisbanding(true);
      setActionError("");

      const token = liff.getIDToken();

      if (!token) {
        throw new Error(
          "LINEの認証情報を取得できません。LINEアプリから開き直してください"
        );
      }

      const response = await fetch(`/api/bands/${bandId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "バンドの解散に失敗しました"
        );
      }

      window.alert(
        data.message || "バンドを解散しました。"
      );

      router.replace("/performer/bands");
    } catch (err) {
      console.error("バンド解散エラー:", err);

      setActionError(
        err instanceof Error
          ? err.message
          : "バンドの解散に失敗しました"
      );
    } finally {
      setDisbanding(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        await loadBand();
      } catch (err) {
        console.error("バンド詳細取得エラー:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "バンド情報の取得に失敗しました"
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
  }, [loadBand]);

  function formatDate(value: string) {
    if (!value) return "未設定";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("ja-JP");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-6">
          <p className="text-sm font-semibold text-gray-500">
            バンド管理
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            🎸 バンド詳細
          </h1>
          <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              バンド情報を読み込んでいます...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !band) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-6">
          <button
            type="button"
            onClick={() => router.push("/performer/bands")}
            className="text-sm font-bold text-gray-500"
          >
            ← バンド一覧へ戻る
          </button>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm leading-6 text-red-700">
              {error || "バンド情報が見つかりません。"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/performer/bands")}
            className="mt-5 w-full rounded-2xl border border-gray-200 bg-white py-4 font-bold text-gray-700"
          >
            バンド一覧へ戻る
          </button>
        </div>
      </main>
    );
  }

  const isLeader = band.role === "leader";

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-6">
        <button
          type="button"
          onClick={() => router.push("/performer/bands")}
          className="mb-5 text-sm font-bold text-gray-500"
        >
          ← バンド一覧へ戻る
        </button>

        {/* バンドの基本情報 */}
        <header className="rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm">
            🎸
          </div>

          <div className="mt-4 flex items-start justify-between gap-3">
            <h1 className="min-w-0 break-words text-2xl font-bold text-gray-900">
              {band.name}
            </h1>

            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                isLeader
                  ? "bg-amber-100 text-amber-800"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {isLeader ? "リーダー" : "メンバー"}
            </span>
          </div>

          {band.description ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">
              {band.description}
            </p>
          ) : (
            <p className="mt-3 text-sm text-gray-400">
              バンド紹介はまだ登録されていません。
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-600">
              👥 {members.length}人
            </span>

            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-600">
              📅 作成日：{formatDate(band.createdAt)}
            </span>
          </div>
        </header>

        {/* バンドで利用する機能 */}
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-bold text-gray-900">
            バンドの機能
          </h2>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() =>
                router.push(`/performer/bands/${band.id}/chat`)
              }
              className="w-full rounded-2xl bg-black p-4 text-left text-white shadow-sm active:bg-gray-800"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-2xl">
                  💬
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-bold">
                    バンドチャット
                  </span>
                  <span className="mt-1 block text-sm text-gray-300">
                    メンバーと連絡する
                  </span>
                </span>

                <span className="text-xl">→</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                router.push(`/performer/bands/${band.id}/transfers`)
              }
              className="w-full rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left shadow-sm active:bg-amber-100"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-2xl">
                  🪙
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-gray-900">
                    コインを送金
                  </span>
                  <span className="mt-1 block text-sm text-gray-600">
                    同じバンドのメンバーへ送金する
                  </span>
                </span>

                <span className="text-xl text-gray-400">→</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => router.push("/performer/bands")}
              className="w-full rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left shadow-sm active:bg-blue-100"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-2xl">
                  ✉️
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-gray-900">
                    メンバー招待・招待管理
                  </span>
                  <span className="mt-1 block text-sm text-gray-600">
                    既存の招待機能を開く
                  </span>
                </span>

                <span className="text-xl text-gray-400">→</span>
              </div>
            </button>
          </div>
        </section>

        {/* メンバー一覧 */}
        <section className="mt-6 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">
              👥 メンバー一覧
            </h2>

            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
              {members.length}人
            </span>
          </div>

          {members.length === 0 ? (
            <p className="mt-4 text-sm leading-6 text-gray-500">
              現在、表示できるアクティブメンバーはいません。
            </p>
          ) : (
            <div className="mt-4 divide-y divide-gray-100">
              {members.map((member) => (
                <div
                  key={member.performerId}
                  className="flex items-center gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xl">
                    {member.role === "leader" ? "👑" : "🎵"}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="break-words font-bold text-gray-900">
                      {member.name}
                      {member.isMe && (
                        <span className="ml-2 text-xs font-medium text-gray-500">
                          あなた
                        </span>
                      )}
                    </p>

                    <p className="mt-1 text-xs text-gray-500">
                      {member.role === "leader" ? "リーダー" : "メンバー"}
                    </p>
                  </div>

                  <span className="shrink-0 text-xs text-gray-400">
                    {formatDate(member.joinedAt)}参加
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {isLeader && (
          <section className="mt-6 rounded-3xl border border-red-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-red-700">
              ⚠️ バンドの解散
            </h2>

            <p className="mt-2 text-sm leading-6 text-gray-600">
              バンドの活動を終了します。メンバー全員が所属解除され、未回答の招待はキャンセルされます。過去の応募・マッチング・コイン履歴は残ります。
            </p>

            {actionError && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700"
              >
                {actionError}
              </div>
            )}

            <button
              type="button"
              onClick={handleDisband}
              disabled={disbanding}
              className="mt-4 w-full rounded-2xl bg-red-600 py-4 font-bold text-white active:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disbanding
                ? "解散処理中..."
                : "⚠️ このバンドを解散する"}
            </button>
          </section>
        )}

        <button
          type="button"
          onClick={() => router.push("/performer/bands")}
          className="mt-6 w-full rounded-2xl border border-gray-200 bg-white py-4 font-bold text-gray-700"
        >
          ← バンド一覧へ戻る
        </button>
      </div>
    </main>
  );
}
