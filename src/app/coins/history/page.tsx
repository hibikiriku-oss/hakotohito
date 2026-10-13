"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type Transaction = {
  id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  balance_after: number | null;
  created_at: string;
};

const transactionLabels: Record<string, string> = {
  application_fee: "応募手数料",
  direct_invite_fee: "直接依頼手数料",
  match_fee: "マッチング手数料",
  review_reward: "レビュー報酬",
  admin_adjustment: "調整・返金",
  video_reward: "動画報酬",
  purchase_credit: "コイン購入",
  donation_credit: "コイン付与",
};

export default function CoinHistoryPage() {
  const router = useRouter();

  const [transactions, setTransactions] =
    useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadHistory() {
      try {
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();

        const response = await fetch("/api/coins/history", {
          headers: {
            "x-line-user-id": profile.userId,
          },
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "コイン履歴の取得に失敗しました"
          );
        }

        setTransactions(data.transactions ?? []);
      } catch (error) {
        console.error("コイン履歴取得エラー:", error);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "コイン履歴の取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    loadHistory();
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto min-h-screen max-w-md px-4 py-6">
        <button
          onClick={() => router.back()}
          className="mb-5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700"
        >
          ← 戻る
        </button>

        <header>
          <p className="text-sm font-medium text-gray-500">
            演奏マッチング
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            🪙 コイン履歴
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            コインの獲得・消費・返金の履歴を確認できます。
          </p>
        </header>

        <section className="mt-6">
          {loading ? (
            <p className="rounded-2xl bg-white p-5 text-sm text-gray-500">
              履歴を読み込み中...
            </p>
          ) : errorMessage ? (
            <div className="rounded-2xl border border-red-200 bg-white p-5">
              <p className="text-sm text-red-600">
                {errorMessage}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-3 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
              >
                再読み込み
              </button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
              <p className="text-3xl">🪙</p>
              <p className="mt-3 font-semibold text-gray-800">
                まだ取引履歴がありません
              </p>
              <p className="mt-2 text-sm text-gray-500">
                コインの増減があると、ここに表示されます。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((transaction) => {
                const positive = transaction.amount > 0;

                return (
                  <article
                    key={transaction.id}
                    className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900">
                          {transaction.description ||
                            transactionLabels[
                              transaction.transaction_type
                            ] ||
                            transaction.transaction_type}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {new Date(
                            transaction.created_at
                          ).toLocaleString("ja-JP")}
                        </p>
                        <p className="mt-2 text-xs text-gray-500">
                          {transactionLabels[
                            transaction.transaction_type
                          ] || transaction.transaction_type}
                        </p>
                      </div>

                      <p
                        className={`shrink-0 text-lg font-bold ${
                          positive
                            ? "text-green-600"
                            : transaction.amount < 0
                              ? "text-red-600"
                              : "text-gray-700"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {transaction.amount.toLocaleString()}
                        <span className="ml-1 text-xs font-medium">
                          コイン
                        </span>
                      </p>
                    </div>

                    {transaction.balance_after !== null && (
                      <p className="mt-3 border-t border-gray-100 pt-3 text-right text-xs text-gray-500">
                        取引後残高：
                        {transaction.balance_after.toLocaleString()}
                        コイン
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}