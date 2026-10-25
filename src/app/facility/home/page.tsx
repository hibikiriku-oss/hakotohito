"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";
import AnnouncementTicker from "@/components/AnnouncementTicker";

export default function FacilityHomePage() {
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
        <AnnouncementTicker />

        {/* ヘッダー */}
        <header className="pt-2 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-500">
                演奏マッチング
              </p>

              <h1 className="text-2xl font-bold text-gray-900 mt-1">
                🏢 施設ホーム
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

          <p className="text-sm text-gray-600 mt-3 leading-relaxed">
            演奏者を探したり、オファーやマッチングを管理できます。
          </p>
        </header>

        {/* メインアクション */}
        <section>
          <p className="text-sm font-bold text-gray-700 mb-3">
            メインメニュー
          </p>

          <div className="space-y-3">

            <button
              onClick={() =>
                router.push("/facility/performers")
              }
              className="w-full bg-black text-white rounded-2xl p-5 text-left shadow-sm active:scale-[0.99] transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold">
                    🎹 演奏者を探す
                  </div>

                  <p className="text-sm text-gray-300 mt-1">
                    条件に合う演奏者を探して依頼できます
                  </p>
                </div>

                <span className="text-xl ml-3">
                  →
                </span>
              </div>
            </button>

            <button
              onClick={() =>
                router.push("/facility/request")
              }
              className="w-full bg-white border border-gray-200 rounded-2xl p-5 text-left shadow-sm active:scale-[0.99] transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-gray-900">
                    🎵 オファーを登録する
                  </div>

                  <p className="text-sm text-gray-500 mt-1">
                    演奏してほしい内容を登録します
                  </p>
                </div>

                <span className="text-xl text-gray-400 ml-3">
                  →
                </span>
              </div>
            </button>

          </div>
        </section>

        {/* 管理メニュー */}
        <section className="mt-8">
          <p className="text-sm font-bold text-gray-700 mb-3">
            管理メニュー
          </p>

          <div className="grid grid-cols-2 gap-3">

            <button
              onClick={() =>
                router.push("/facility/requests")
              }
              className="bg-white border border-gray-200 rounded-2xl p-4 text-left shadow-sm active:scale-[0.99] transition"
            >
              <div className="text-2xl">
                📋
              </div>

              <div className="font-bold text-gray-900 mt-3">
                自分の依頼
              </div>

              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                作成した依頼を確認
              </p>
            </button>

            <button
              onClick={() =>
                router.push("/facility/matches")
              }
              className="bg-white border border-gray-200 rounded-2xl p-4 text-left shadow-sm active:scale-[0.99] transition"
            >
              <div className="text-2xl">
                🎉
              </div>

              <div className="font-bold text-gray-900 mt-3">
                マッチング
              </div>

              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                成立した演奏を確認
              </p>
            </button>

            <button
              onClick={() =>
                router.push("/facility/favorites")
              }
              className="bg-white border border-gray-200 rounded-2xl p-4 text-left shadow-sm active:scale-[0.99] transition"
            >
              <div className="text-2xl">
                ⭐
              </div>

              <div className="font-bold text-gray-900 mt-3">
                お気に入り
              </div>

              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                気になる演奏者を確認
              </p>
            </button>
            
            {/* お問い合わせ */}
            <button
              onClick={() => router.push("/inquiry")}
              className="bg-white border border-gray-200 rounded-2xl p-4 text-left shadow-sm active:scale-[0.99] transition"
            >
              <div className="text-2xl">💬</div>

              <div className="font-bold text-gray-900 mt-3">
                お問い合わせ
              </div>

              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                ご質問・不具合の報告
              </p>
            </button>
          </div>
        </section>

        {/* フッター */}
        <footer className="text-center pt-10 pb-4">
          <p className="text-xs text-gray-400">
            演奏者と施設をつなぐ、演奏マッチング
          </p>
        </footer>

      </div>
    </main>
  );
}