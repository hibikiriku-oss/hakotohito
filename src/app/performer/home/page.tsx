"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

export default function PerformerHomePage() {
  const router = useRouter();

  const [coinBalance, setCoinBalance] =
    useState<number | null>(null);

  const [coinLoading, setCoinLoading] =
    useState(true);

  useEffect(() => {
    async function loadCoinBalance() {
      try {
        await liff.init({
          liffId:
            process.env.NEXT_PUBLIC_LIFF_ID!,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile =
          await liff.getProfile();

        const response = await fetch(
          "/api/coins/balance",
          {
            headers: {
              "x-line-user-id":
                profile.userId,
            },
            cache: "no-store",
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "コイン残高の取得に失敗しました"
          );
        }

        setCoinBalance(
          data.coinBalance ?? 0
        );
      } catch (error) {
        console.error(
          "コイン残高取得エラー:",
          error
        );
      } finally {
        setCoinLoading(false);
      }
    }

    loadCoinBalance();
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 py-6">

        {/* ヘッダー */}
        <header className="pt-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-500">
                演奏マッチング
              </p>

              <h1 className="mt-1 text-2xl font-bold text-gray-900">
                🎸 演奏者ホーム
              </h1>
            </div>

            <button
              onClick={() => router.push("/coins/history")}
              className="shrink-0 rounded-full border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-600 shadow-sm active:bg-amber-50"
              aria-label="コイン履歴を開く"
            >
              🪙{" "}
              {coinLoading
                ? "..."
                : (coinBalance ?? 0).toLocaleString()}
              コイン
            </button>
          </div>

          <p className="mt-3 text-sm leading-6 text-gray-600">
            演奏案件を探したり、施設からの依頼を確認できます。
          </p>
        </header>

        {/* メインメニュー */}
        <section className="mt-7 space-y-3">

          {/* 演奏案件を探す */}
          <button
            onClick={() =>
              router.push("/performer/requests")
            }
            className="w-full rounded-2xl bg-black px-5 py-5 text-left text-white shadow-sm active:scale-[0.99]"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">
                  🔍 演奏案件を探す
                </p>

                <p className="mt-1 text-sm text-gray-300">
                  自分に合った演奏依頼を探す
                </p>
              </div>

              <span className="text-2xl">
                →
              </span>
            </div>
          </button>

          {/* マッチング */}
          <button
            onClick={() =>
              router.push("/performer/matches")
            }
            className="w-full rounded-2xl bg-white border border-gray-200 px-5 py-5 text-left shadow-sm active:bg-gray-50"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-gray-900">
                  🎉 マッチング
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  マッチングした施設との予定を確認
                </p>
              </div>

              <span className="text-xl text-gray-400">
                →
              </span>
            </div>
          </button>

        </section>

        {/* その他のメニュー */}
        <section className="mt-8">

          <p className="mb-3 px-1 text-sm font-semibold text-gray-500">
            その他
          </p>

          <div className="grid grid-cols-2 gap-3">

            {/* お気に入り */}
            <button
              onClick={() =>
                router.push("/performer/favorites")
              }
              className="rounded-2xl bg-white border border-gray-200 p-5 text-left shadow-sm active:bg-gray-50"
            >
              <div className="text-2xl">
                ⭐
              </div>

              <p className="mt-3 font-bold text-gray-900">
                お気に入り
              </p>

              <p className="mt-1 text-xs leading-5 text-gray-500">
                気になる施設を見る
              </p>
            </button>

            {/* プロフィール */}
            <button
              onClick={() =>
                router.push(
                  "/performer/profile/edit"
                )
              }
              className="rounded-2xl bg-white border border-gray-200 p-5 text-left shadow-sm active:bg-gray-50"
            >
              <div className="text-2xl">
                👤
              </div>

              <p className="mt-3 font-bold text-gray-900">
                演奏者情報を編集
              </p>

              <p className="mt-1 text-xs leading-5 text-gray-500">
                プロフィールを編集
              </p>
            </button>

          </div>
        </section>

        {/* フッター */}
        <p className="mt-10 pb-4 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>

      </div>
    </main>
  );
}