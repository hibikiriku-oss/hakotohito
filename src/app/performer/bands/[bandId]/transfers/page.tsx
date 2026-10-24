
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import liff from "@line/liff";

type BandMember = {
  performerId: string;
  name: string;
  role: string;
};

type TransferRequestRecord = {
  key: string;
  recipientPerformerId: string;
  amount: number;
  description: string;
};

const inputClass =
  "w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 outline-none focus:border-black focus:bg-white";

export default function BandTransfersPage() {
  const router = useRouter();
  const params = useParams();
  const bandId = params.bandId as string;

  const [bandName, setBandName] = useState("");
  const [members, setMembers] = useState<BandMember[]>([]);
  const [coinBalance, setCoinBalance] = useState(0);

  const [recipientPerformerId, setRecipientPerformerId] =
    useState("");
  const [amountInput, setAmountInput] = useState("");
  const [description, setDescription] = useState("");

  const [requestRecord, setRequestRecord] =
    useState<TransferRequestRecord | null>(null);

  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const getToken = useCallback(async (): Promise<string | null> => {
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

  const loadTransferInfo = useCallback(
    async (token: string) => {
      const response = await fetch(
        `/api/bands/${bandId}/transfers`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "送金画面の情報を取得できませんでした"
        );
      }

      setBandName(data.band?.name || "バンド");
      setMembers(Array.isArray(data.members) ? data.members : []);
      setCoinBalance(Number(data.coinBalance ?? 0));
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

        await loadTransferInfo(token);
      } catch (err) {
        console.error("バンド送金画面の初期化エラー:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "送金画面の情報を取得できませんでした"
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
  }, [getToken, loadTransferInfo]);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (transferring) {
      return;
    }

    const amount = Number(amountInput);
    const memo = description.trim();

    if (!recipientPerformerId) {
      setError("送金先のメンバーを選択してください");
      return;
    }

    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > 2147483647
    ) {
      setError("送金額は1以上の整数で入力してください");
      return;
    }

    if (memo.length > 100) {
      setError("送金メモは100文字以内で入力してください");
      return;
    }

    const recipient = members.find(
      (member) => member.performerId === recipientPerformerId
    );

    if (!recipient) {
      setError("送金先のメンバーを選び直してください");
      return;
    }

    const confirmed = window.confirm(
      `次の内容で送金しますか？\n\n` +
        `バンド：${bandName}\n` +
        `送金先：${recipient.name}\n` +
        `送金額：${amount}コイン\n` +
        `メモ：${memo || "なし"}\n\n` +
        `送金後は取り消せません。`
    );

    if (!confirmed) {
      return;
    }

    try {
      setTransferring(true);
      setError("");
      setNotice("");

      const token = await getToken();

      if (!token) {
        return;
      }

      // 同じ内容での再試行には同じキーを使用する
      const sameRequest =
        requestRecord !== null &&
        requestRecord.recipientPerformerId === recipientPerformerId &&
        requestRecord.amount === amount &&
        requestRecord.description === memo;

      const record: TransferRequestRecord = sameRequest
        ? requestRecord
        : {
            key: crypto.randomUUID(),
            recipientPerformerId,
            amount,
            description: memo,
          };

      setRequestRecord(record);

      const response = await fetch(
        `/api/bands/${bandId}/transfers`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            recipientPerformerId,
            amount,
            description: memo,
            idempotencyKey: record.key,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "送金に失敗しました");
      }

      setCoinBalance(Number(data.senderBalance ?? coinBalance - amount));
      setNotice(
        data.message || `${amount}コインを送金しました`
      );

      setRecipientPerformerId("");
      setAmountInput("");
      setDescription("");
      setRequestRecord(null);
    } catch (err) {
      console.error("バンド内コイン送金エラー:", err);

      setError(
        err instanceof Error
          ? err.message
          : "送金に失敗しました。内容を確認して再度お試しください"
      );
    } finally {
      setTransferring(false);
    }
  }

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

        <header className="mb-6">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-3xl">
            🪙
          </div>

          <p className="text-xs font-bold tracking-wider text-gray-400">
            BAND COIN TRANSFER
          </p>

          <h1 className="mt-2 text-2xl font-bold text-gray-900">
            コインを送金
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            {bandName || "バンド"}の活動中メンバーにコインを送ります。
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="mb-5 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm leading-6 text-green-800"
          >
            {notice}
          </div>
        )}

        <section className="mb-5 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-500">
            あなたのコイン残高
          </p>

          <p className="mt-2 text-3xl font-bold text-gray-900">
            🪙 {coinBalance.toLocaleString()}
            <span className="ml-2 text-sm font-medium text-gray-500">
              コイン
            </span>
          </p>

          <p className="mt-2 text-xs leading-5 text-gray-500">
            レッスン募集などで予約中のコインは送金に使えません。
          </p>
        </section>

        {loading ? (
          <section className="rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-gray-500">
              バンドメンバーを読み込んでいます...
            </p>
          </section>
        ) : members.length === 0 ? (
          <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="font-bold text-gray-800">
              送金できるメンバーがいません
            </p>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              自分以外の活動中メンバーが参加すると、ここから送金できます。
            </p>
          </section>
        ) : (
          <section className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-gray-900">
              送金内容
            </h2>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="transfer-recipient"
                  className="mb-2 block text-sm font-bold text-gray-800"
                >
                  送金先
                </label>

                <select
                  id="transfer-recipient"
                  value={recipientPerformerId}
                  onChange={(event) => {
                    setRecipientPerformerId(event.target.value);
                    setError("");
                  }}
                  required
                  className={inputClass}
                >
                  <option value="">
                    メンバーを選択してください
                  </option>

                  {members.map((member) => (
                    <option
                      key={member.performerId}
                      value={member.performerId}
                    >
                      {member.name}
                      {member.role === "leader" ? "（リーダー）" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="transfer-amount"
                  className="mb-2 block text-sm font-bold text-gray-800"
                >
                  送金額
                </label>

                <div className="relative">
                  <input
                    id="transfer-amount"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="2147483647"
                    step="1"
                    required
                    value={amountInput}
                    onChange={(event) => {
                      setAmountInput(event.target.value);
                      setError("");
                    }}
                    placeholder="例：10"
                    className={`${inputClass} pr-20`}
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                    コイン
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="transfer-description"
                  className="mb-2 block text-sm font-bold text-gray-800"
                >
                  送金メモ（任意）
                </label>

                <textarea
                  id="transfer-description"
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setError("");
                  }}
                  maxLength={100}
                  rows={3}
                  placeholder="例：次回ライブの準備費用"
                  className={`${inputClass} resize-none`}
                />

                <p className="mt-1 text-right text-xs text-gray-400">
                  {description.length}/100文字
                </p>
              </div>

              <button
                type="submit"
                disabled={transferring || !recipientPerformerId}
                className="w-full rounded-2xl bg-amber-500 py-4 font-bold text-white active:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {transferring
                  ? "送金処理中..."
                  : "内容を確認して送金"}
              </button>
            </form>
          </section>
        )}

        <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">
            ⚠️ 送金前にご確認ください
          </p>
          <p className="mt-2 text-sm leading-6 text-amber-800">
            送金は即時に反映され、現時点では取り消せません。送金先と金額を必ず確認してください。
          </p>
        </div>

        <button
          type="button"
          onClick={() => router.push("/performer/bands")}
          className="mt-6 w-full rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm font-bold text-gray-700"
        >
          ← バンド一覧へ戻る
        </button>
      </div>
    </main>
  );
}
