
"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import liff from "@line/liff";

export default function PerformerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [coinLoading, setCoinLoading] = useState(true);

  // ホームには既存の残高表示があるため、共通表示は重複させない
  const isHome = pathname === "/performer/home";

  useEffect(() => {
    let cancelled = false;

    async function loadCoinBalance() {
      if (isHome) {
        setCoinLoading(false);
        return;
      }

      setCoinLoading(true);

      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("LINEログインの設定がありません");
        }

        try {
          await liff.init({
            liffId,
            withLoginOnExternalBrowser: true,
          });
        } catch (initError) {
          // 個別画面ですでにLIFFを初期化している場合は、
          // 初期化済みかを確認してから処理を続行する
          try {
            liff.isLoggedIn();
          } catch {
            throw initError;
          }
        }

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();

        const response = await fetch("/api/coins/balance", {
          headers: {
            Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
},
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "コイン残高の取得に失敗しました"
          );
        }

        if (!cancelled) {
          setCoinBalance(Number(data.coinBalance ?? 0));
        }
      } catch (error) {
        console.error("共通コイン残高取得エラー:", error);

        if (!cancelled) {
          setCoinBalance(null);
        }
      } finally {
        if (!cancelled) {
          setCoinLoading(false);
        }
      }
    }

    loadCoinBalance();

    return () => {
      cancelled = true;
    };
  }, [isHome, pathname]);

  return (
    <>
      {!isHome && (
        <div className="bg-gray-50">
          <div className="mx-auto flex max-w-md justify-end px-4 pt-3">
            <button
              type="button"
              onClick={() => router.push("/coins/history")}
              className="rounded-full border border-amber-200 bg-white px-3 py-2 text-sm font-bold text-amber-600 shadow-sm active:bg-amber-50"
              aria-label="コイン履歴を開く"
            >
              🪙{" "}
              {coinLoading
                ? "..."
                : coinBalance === null
                  ? "--"
                  : coinBalance.toLocaleString()}
              コイン
            </button>
          </div>
        </div>
      )}

      {children}
    </>
  );
}
