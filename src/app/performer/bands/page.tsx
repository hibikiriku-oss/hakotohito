"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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

type Invitation = {
  id: string;
  bandId: string;
  bandName: string;
  bandStatus: string;
  inviterPerformerId: string;
  inviterName: string;
  message: string | null;
  status: string;
  createdAt: string;
};

type SentInvitation = {
  id: string;
  bandId: string;
  bandName: string;
  bandStatus: string;
  inviteePerformerId: string;
  inviteeName: string;
  message: string | null;
  status: string;
  createdAt: string;
  respondedAt: string | null;
};

type InvitationDecision = "accepted" | "rejected";

const inputClass =
  "w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 outline-none focus:border-black focus:bg-white";

function getInvitationStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "回答待ち";
    case "accepted":
      return "承認済み";
    case "rejected":
      return "拒否済み";
    case "cancelled":
      return "キャンセル済み";
    default:
      return status;
  }
}

function getInvitationStatusClass(status: string) {
  switch (status) {
    case "accepted":
      return "bg-green-100 text-green-800";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "pending":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ja-JP");
}

export default function PerformerBandsPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bands, setBands] = useState<Band[]>([]);
  const [performers, setPerformers] = useState<PerformerCandidate[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [sentInvitations, setSentInvitations] = useState<SentInvitation[]>([]);
  const [performerId, setPerformerId] = useState("");
  const [selectedBandId, setSelectedBandId] = useState("");
  const [selectedPerformerId, setSelectedPerformerId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [sendingInvitation, setSendingInvitation] = useState(false);
  const [respondingInvitationId, setRespondingInvitationId] =
    useState("");
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
      throw new Error(
        data.error || "バンド一覧の取得に失敗しました"
      );
    }

    const items: Band[] = Array.isArray(data.bands)
      ? data.bands
      : [];

    setBands(items);

    setSelectedBandId((previous) =>
      items.some((band) => band.id === previous)
        ? previous
        : items[0]?.id || ""
    );

    return items;
  }, []);

  const loadPerformers = useCallback(async (token: string) => {
    // 本人宛ての招待と、自分が送信した招待の履歴を取得
    const invitationResponse = await fetch(
      "/api/bands/invitations",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    const invitationData = await invitationResponse.json();

    if (!invitationResponse.ok) {
      throw new Error(
        invitationData.error ||
          "招待情報の取得に失敗しました"
      );
    }

    setPerformerId(invitationData.performerId);

    setInvitations(
      Array.isArray(invitationData.invitations)
        ? invitationData.invitations
        : []
    );

    setSentInvitations(
      Array.isArray(invitationData.sentInvitations)
        ? invitationData.sentInvitations
        : []
    );

    // 招待候補となる演奏者一覧を取得
    const performerResponse = await fetch("/api/performers", {
      cache: "no-store",
    });

    const performerData = await performerResponse.json();

    if (!performerResponse.ok) {
      throw new Error(
        performerData.error ||
          "演奏者一覧の取得に失敗しました"
      );
    }

    setPerformers(
      Array.isArray(performerData.performers)
        ? performerData.performers
        : []
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
        throw new Error(
          data.error || "バンドを作成できませんでした"
        );
      }

      setName("");
      setDescription("");

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
        throw new Error(
          data.error || "招待を送信できませんでした"
        );
      }

      const invitee = performers.find(
        (performer) => performer.id === selectedPerformerId
      );

      const band = bands.find(
        (item) => item.id === selectedBandId
      );

      setSelectedPerformerId("");
      setInviteMessage("");

      const successMessage =
        `「${band?.name || data.band.name}」への招待を` +
        `${invitee?.name || "選択した演奏者"}さんに送信しました。`;

      // 送信した招待の履歴をすぐに更新する
      try {
        await loadPerformers(token);
        setNotice(successMessage);
      } catch (refreshError) {
        console.error(
          "送信後の招待履歴更新エラー:",
          refreshError
        );

        setNotice(
          `${successMessage} 履歴の表示が更新されない場合は「更新」を押してください。`
        );
      }
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

  const handleInvitationResponse = async (
    invitation: Invitation,
    decision: InvitationDecision
  ) => {
    const actionLabel =
      decision === "accepted" ? "承認" : "拒否";

    const confirmed = window.confirm(
      `「${invitation.bandName}」からの招待を${actionLabel}しますか？`
    );

    if (!confirmed) {
      return;
    }

    try {
      setRespondingInvitationId(invitation.id);
      setError("");
      setNotice("");

      const token = await getToken();

      if (!token) {
        return;
      }

      setIdToken(token);

      const response = await fetch("/api/bands/invitations", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invitationId: invitation.id,
          decision,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "招待への回答を保存できませんでした"
        );
      }

      await Promise.all([
        loadBands(token),
        loadPerformers(token),
      ]);

      setNotice(
        decision === "accepted"
          ? `「${invitation.bandName}」への参加を承認しました。自分のバンドに追加されています。`
          : `「${invitation.bandName}」からの招待を拒否しました。`
      );
    } catch (err) {
      console.error("招待回答エラー:", err);

      setError(
        err instanceof Error
          ? err.message
          : "招待への回答に失敗しました"
      );
    } finally {
      setRespondingInvitationId("");
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

      await Promise.all([
        loadBands(token),
        loadPerformers(token),
      ]);

      setNotice("情報を更新しました");
    } catch (err) {
      console.error("バンド情報更新エラー:", err);

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

        {/* バンド作成 */}
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

        {/* メンバー招待 */}
        <section className="mb-5 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-gray-900">
            👥 メンバーを招待
          </h2>

          <p className="mb-4 mt-2 text-sm leading-6 text-gray-500">
            招待したいバンドと演奏者を選んでください。相手が承認するとメンバーになります。
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
                  onChange={(event) =>
                    setSelectedBandId(event.target.value)
                  }
                  required
                  className={inputClass}
                >
                  <option value="">
                    バンドを選択してください
                  </option>

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
                  onChange={(event) =>
                    setSearchText(event.target.value)
                  }
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
                  <option value="">
                    演奏者を選択してください
                  </option>

                  {filteredPerformers.map((performer) => {
                    const areas =
                      performer.areas?.length
                        ? performer.areas
                        : performer.area
                          ? [performer.area]
                          : [];

                    return (
                      <option
                        key={performer.id}
                        value={performer.id}
                      >
                        {performer.name}
                        {performer.instruments?.length
                          ? ` / ${performer.instruments.join("・")}`
                          : ""}
                        {areas.length
                          ? ` / ${areas.join("・")}`
                          : ""}
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
                  onChange={(event) =>
                    setInviteMessage(event.target.value)
                  }
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
                {sendingInvitation
                  ? "招待を送信中..."
                  : "招待を送信する"}
              </button>
            </form>
          )}
        </section>

        {/* 送信した招待の履歴 */}
        <section className="mb-5 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">
              📤 送信した招待
            </h2>

            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
              {sentInvitations.length}件
            </span>
          </div>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            招待した相手の回答状況を確認できます。
          </p>

          {loading ? (
            <p className="py-6 text-center text-sm text-gray-500">
              送信履歴を読み込み中...
            </p>
          ) : sentInvitations.length === 0 ? (
            <div className="py-7 text-center">
              <p className="text-3xl">📨</p>
              <p className="mt-3 text-sm font-bold text-gray-700">
                送信した招待はありません
              </p>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                招待を送ると、ここに回答状況が表示されます。
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {sentInvitations.map((invitation) => (
                <article
                  key={invitation.id}
                  className="rounded-2xl border border-gray-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-bold text-gray-900">
                        {invitation.inviteeName}
                      </h3>

                      <p className="mt-1 text-sm text-gray-600">
                        バンド：{invitation.bandName}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${getInvitationStatusClass(
                        invitation.status
                      )}`}
                    >
                      {getInvitationStatusLabel(invitation.status)}
                    </span>
                  </div>

                  {invitation.message && (
                    <p className="mt-3 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-600">
                      {invitation.message}
                    </p>
                  )}

                  <div className="mt-3 space-y-1 text-xs text-gray-400">
                    <p>
                      送信日：{formatDate(invitation.createdAt)}
                    </p>

                    {invitation.respondedAt && (
                      <p>
                        回答日：{formatDate(invitation.respondedAt)}
                      </p>
                    )}
                  </div>

                  {invitation.status === "pending" && (
                    <p className="mt-3 text-xs leading-5 text-amber-700">
                      相手の回答を待っています。
                    </p>
                  )}

                  {invitation.status === "accepted" && (
                    <p className="mt-3 text-xs leading-5 text-green-700">
                      相手が参加を承認しました。
                    </p>
                  )}

                  {invitation.status === "rejected" && (
                    <p className="mt-3 text-xs leading-5 text-red-700">
                      相手が招待を拒否しました。
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {/* 受信した招待 */}
        <section className="mb-5 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-gray-900">
              📩 受信した招待
            </h2>

            {invitations.length > 0 && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                {invitations.length}件
              </span>
            )}
          </div>

          {loading ? (
            <p className="py-6 text-center text-sm text-gray-500">
              招待を読み込み中...
            </p>
          ) : invitations.length === 0 ? (
            <div className="py-7 text-center">
              <p className="text-3xl">✉️</p>
              <p className="mt-3 text-sm font-bold text-gray-700">
                新しい招待はありません
              </p>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                ほかの演奏者から招待されると、ここに表示されます。
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {invitations.map((invitation) => {
                const responding =
                  respondingInvitationId === invitation.id;

                return (
                  <article
                    key={invitation.id}
                    className="rounded-2xl border border-gray-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-bold text-gray-900">
                          {invitation.bandName}
                        </h3>

                        <p className="mt-1 text-sm text-gray-600">
                          招待者：{invitation.inviterName}
                        </p>
                      </div>

                      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                        未回答
                      </span>
                    </div>

                    {invitation.message && (
                      <div className="mt-3 rounded-xl bg-gray-50 p-3">
                        <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
                          {invitation.message}
                        </p>
                      </div>
                    )}

                    <p className="mt-3 text-xs text-gray-400">
                      受信日：{formatDate(invitation.createdAt)}
                    </p>

                    {invitation.bandStatus !== "active" && (
                      <p className="mt-3 text-xs leading-5 text-red-600">
                        このバンドは現在活動していないため、参加を承認できません。
                      </p>
                    )}

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={
                          responding ||
                          Boolean(respondingInvitationId) ||
                          !idToken ||
                          invitation.bandStatus !== "active"
                        }
                        onClick={() =>
                          handleInvitationResponse(
                            invitation,
                            "accepted"
                          )
                        }
                        className="rounded-xl bg-black px-3 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {responding ? "処理中..." : "承認する"}
                      </button>

                      <button
                        type="button"
                        disabled={
                          responding ||
                          Boolean(respondingInvitationId) ||
                          !idToken
                        }
                        onClick={() =>
                          handleInvitationResponse(
                            invitation,
                            "rejected"
                          )
                        }
                        className="rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm font-bold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        拒否する
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* 自分のバンド */}
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
                バンドを作成するか、招待を承認すると、ここに一覧が表示されます。
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
                      {band.role === "leader"
                        ? "リーダー"
                        : "メンバー"}
                    </span>
                  </div>

                  {band.description && (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                      {band.description}
                    </p>
                  )}

                  <p className="mt-3 text-xs text-gray-400">
                    作成日：{formatDate(band.createdAt)}
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/performer/bands/${band.id}/chat`)
                    }
                    className="mt-4 w-full rounded-2xl bg-black py-3 font-bold text-white active:opacity-80"
                  >
                    💬 バンドチャットを開く
                  </button>

                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}