"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type PerformerCandidate = {
  id: string;
  name: string;
  instruments?: string[];
  genres?: string[];
  area?: string | null;
  areas?: string[];
};

const inputClass =
  "w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 outline-none focus:border-black focus:bg-white";

export default function PerformerBandsPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bands, setBands] = useState<Band[]>([]);
  const [performers, setPerformers] = useState<PerformerCandidate[]>([]);
  const [performerId, setPerformerId] = useState("");
  const [selectedBandId, setSelectedBandId] = useState("");
  const [selectedPerformerId, setSelectedPerformerId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sendingInvitation, setSendingInvitation] = useState(false);
  const [idToken, setIdToken] = useState("");
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

  const loadBands = useCallback(async (token: string) => {
    const response = await fetch("/api/bands", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "バンド一覧の取得に失敗しました");
    }

    const items: Band[] = Array.isArray(data.bands) ? data.bands : [];

    setBands(items);
    setSelectedBandId((previous) =>
      items.some((band) => band.id === previous)
        ? previous
        : items[0]?.id || ""
    );

    return items;
  }, []);

  const loadPerformers = useCallback(async (token: string) => {
    const meResponse = await fetch("/api/bands/invitations", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    const meData = await meResponse.json();

    if (!meResponse.ok) {
      throw new Error(
        meData.error || "自分の演奏者情報を取得できませんでした"
      );
    }

    setPerformerId(meData.performerId);

    const response = await fetch("/api/performers", {
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "演奏者一覧の取得に失敗しました");
    }

    setPerformers(
      Array.isArray(data.performers) ? data.performers : []
    );
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

        await Promise.all([
          loadBands(token),
          loadPerformers(token),
        ]);
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
  }, [getToken, loadBands, loadPerformers]);

  const filteredPerformers = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return performers
      .filter((performer) => performer.id !== performerId)
      .filter((performer) => {
        if (!query) {
          return true;
        }

        const areas =
          performer.areas?.length
            ? performer.areas
            : performer.area
              ? [performer.area]
              : [];

        const searchable = [
          performer.name,
          ...(performer.instruments || []),
          ...(performer.genres || []),
          ...areas,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchable.includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [performers, performerId, searchText]);

  const handleCreate = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (!name.trim()) {
      setError("バンド名を入力してください");
      return;
    }

    try {
      setCreating(true);
      setError("");
      setNotice("");

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

      if (data.band?.id) {
        setSelectedBandId(data.band.id);
      }

      await loadBands(token);
      setNotice(`「${data.band.name}」を作成しました！`);
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

  const handleInvite = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (!selectedBandId || !selectedPerformerId) {
      setError("バンドと招待する演奏者を選択してください");
      return;
    }

    if (inviteMessage.trim().length > 500) {
      setError("招待メッセージは500文字以内で入力してください");
      return;
    }

    try {
      setSendingInvitation(true);
      setError("");
      setNotice("");

      const token = await getToken();

      if (!token) {
        return;
      }

      setIdToken(token);

      const response = await fetch("/api/bands/invitations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bandId: selectedBandId,
          inviteePerformerId: selectedPerformerId,
          message: inviteMessage.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "招待を送信できませんでした");
      }

      const invitee = performers.find(
        (performer) => performer.id === selectedPerformerId
      );
      const band = bands.find((item) => item.id === selectedBandId);

      setSelectedPerformerId("");
      setInviteMessage("");
      setNotice(
        `「${band?.name || data.band.name}」への招待を${
          invitee?.name || "選択した演奏者"
        }さんに送信しました。`
      );
    } catch (err) {
      console.error("バンド招待エラー:", err);
      setError(
        err instanceof Error
          ? err.message
          : "招待を送信できませんでした"
      );
    } finally {
      setSendingInvitation(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setError("");
      setNotice("");

      const token = await getToken();

      if (!token) {
        return;
      }

      setIdToken(token);
      await Promise.all([loadBands(token), loadPerformers(token)]);
      setNotice("情報を更新しました");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "情報の更新に失敗しました"
      );
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
            バンドを作り、仲間を招待して一緒に活動しましょう。
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

        {notice && (
          <div
            role="status"
            className="mb-5 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800"
          >
            {notice}
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
                rows={3}
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

        <section className="mb-5 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">
            👥 メンバーを招待
          </h2>

          <p className="mb-4 mt-2 text-sm leading-6 text-gray-500">
            招待するバンドと演奏者を選んでください。招待が承認されるまでは、相手はメンバーになりません。
          </p>

          {bands.length === 0 && !loading ? (
            <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">
              招待を送るには、先にバンドを作成してください。
            </p>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label
                  htmlFor="invite-band"
                  className="mb-2 block text-sm font-bold text-gray-800"
                >
                  招待するバンド
                </label>

                <select
                  id="invite-band"
                  value={selectedBandId}
                  onChange={(event) => setSelectedBandId(event.target.value)}
                  required
                  className={inputClass}
                >
                  <option value="">バンドを選択してください</option>
                  {bands.map((band) => (
                    <option key={band.id} value={band.id}>
                      {band.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="performer-search"
                  className="mb-2 block text-sm font-bold text-gray-800"
                >
                  演奏者を検索
                </label>

                <input
                  id="performer-search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="名前・楽器・ジャンル・エリア"
                  className={inputClass}
                />
              </div>

              <div>
                <label
                  htmlFor="invite-performer"
                  className="mb-2 block text-sm font-bold text-gray-800"
                >
                  招待する演奏者
                </label>

                <select
                  id="invite-performer"
                  value={selectedPerformerId}
                  onChange={(event) =>
                    setSelectedPerformerId(event.target.value)
                  }
                  required
                  className={inputClass}
                >
                  <option value="">演奏者を選択してください</option>

                  {filteredPerformers.map((performer) => {
                    const areas =
                      performer.areas?.length
                        ? performer.areas
                        : performer.area
                          ? [performer.area]
                          : [];

                    return (
                      <option key={performer.id} value={performer.id}>
                        {performer.name}
                        {performer.instruments?.length
                          ? ` / ${performer.instruments.join("・")}`
                          : ""}
                        {areas.length ? ` / ${areas.join("・")}` : ""}
                      </option>
                    );
                  })}
                </select>

                {filteredPerformers.length === 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    該当する演奏者がいません。検索条件を変えてください。
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="invite-message"
                  className="mb-2 block text-sm font-bold text-gray-800"
                >
                  招待メッセージ（任意）
                </label>

                <textarea
                  id="invite-message"
                  value={inviteMessage}
                  onChange={(event) => setInviteMessage(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="一緒に演奏しませんか？"
                  className={`${inputClass} resize-none`}
                />

                <p className="mt-1 text-right text-xs text-gray-400">
                  {inviteMessage.length}/500文字
                </p>
              </div>

              <button
                type="submit"
                disabled={
                  loading ||
                  sendingInvitation ||
                  !idToken ||
                  bands.length === 0 ||
                  filteredPerformers.length === 0
                }
                className="w-full rounded-2xl bg-amber-500 py-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendingInvitation ? "招待を送信中..." : "招待を送信する"}
              </button>
            </form>
          )}
        </section>

        <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">
              自分のバンド
            </h2>

            <button
              type="button"
              onClick={handleRefresh}
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
                    <h3 className="font-bold text-gray-900">{band.name}</h3>

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