"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type Band = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  role: "leader" | "member";
  joinedAt: string;
};

const inputClass =
  "w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 outline-none focus:border-black focus:bg-white";

export default function PerformerBandsPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bands, setBands] = useState<Band[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [idToken, setIdToken] = useState("");

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

  const loadBands = useCallback(async (token: string) => {
    const response = await fetch("/api/bands", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "バンド一覧の取得に失敗しました");
    }

    setBands(Array.isArray(data.bands) ? data.bands : []);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const token = await getToken();

        if (!token || cancelled) {
          return;
        }

        setIdToken(token);
        await loadBands(token);
      } catch (err) {
        console.error("バンド画面初期化エラー:", err);

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
  }, [getToken, loadBands]);

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim()) {
      setError("バンド名を入力してください");
      return;
    }

    try {
      setCreating(true);
      setError("");

      // 期限切れなどに備え、作成直前にもトークンを取得する
      const token = await getToken();

      if (!token) {
        return;
      }

      setIdToken(token);

      const response = await fetch("/api/bands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "バンドを作成できませんでした");
      }

      setName("");
      setDescription("");

      await loadBands(token);

      alert(`「${data.band.name}」を作成しました！`);
    } catch (err) {
      console.error("バンド作成エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "バンドの作成に失敗しました"
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-md px-4 py-6">
        <header className="mb-6">
          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            className="mb-5 text-sm font-bold text-gray-500"
          >
            ← 演奏者ホームへ戻る
          </button>

          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-black text-3xl text-white">
            🎸
          </div>

          <p className="mb-2 text-xs font-bold tracking-wider text-gray-400">
            BAND MANAGEMENT
          </p>

          <h1 className="text-2xl font-bold text-gray-900">
            バンドを管理する
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            仲間とバンドを作り、一緒に演奏案件へ応募できるようにします。
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <section className="mb-5 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-gray-900">
            ＋ 新しいバンドを作成
          </h2>

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label
                htmlFor="band-name"
                className="mb-2 block text-sm font-bold text-gray-800"
              >
                バンド名 <span className="text-red-500">*</span>
              </label>

              <input
                id="band-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
                placeholder="例：ハコトヒト・アンサンブル"
                className={inputClass}
              />

              <p className="mt-1 text-right text-xs text-gray-400">
                {name.length}/100文字
              </p>
            </div>

            <div>
              <label
                htmlFor="band-description"
                className="mb-2 block text-sm font-bold text-gray-800"
              >
                バンド紹介（任意）
              </label>

              <textarea
                id="band-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="演奏ジャンルや活動内容など"
                className={`${inputClass} resize-none`}
              />
            </div>

            <button
              type="submit"
              disabled={creating || loading || !idToken}
              className="w-full rounded-2xl bg-black py-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "作成中..." : "バンドを作成する"}
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">
              自分のバンド
            </h2>

            <button
              type="button"
              onClick={async () => {
                try {
                  setError("");
                  const token = await getToken();

                  if (token) {
                    setIdToken(token);
                    await loadBands(token);
                  }
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "バンド一覧の更新に失敗しました"
                  );
                }
              }}
              disabled={loading}
              className="text-sm font-bold text-gray-500 disabled:opacity-50"
            >
              ↻ 更新
            </button>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-gray-500">
              バンド情報を読み込み中...
            </p>
          ) : bands.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-3xl">🎼</p>
              <p className="mt-3 text-sm font-bold text-gray-700">
                バンドはまだありません
              </p>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                バンドを作成すると、ここに一覧が表示されます。
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {bands.map((band) => (
                <article
                  key={band.id}
                  className="rounded-2xl border border-gray-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold text-gray-900">
                      {band.name}
                    </h3>

                    <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                      {band.role === "leader" ? "リーダー" : "メンバー"}
                    </span>
                  </div>

                  {band.description && (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                      {band.description}
                    </p>
                  )}

                  <p className="mt-3 text-xs text-gray-400">
                    作成日：
                    {new Date(band.createdAt).toLocaleDateString("ja-JP")}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}