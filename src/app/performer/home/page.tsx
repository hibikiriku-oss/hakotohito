"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type MenuKey = "home" | "offers" | "matches" | "lesson" | "bands" | "other";

type MenuItem = {
  icon: string;
  title: string;
  description: string;
  path: string;
};

const menuConfig: Record<
  Exclude<MenuKey, "home">,
  {
    icon: string;
    title: string;
    description: string;
    items: MenuItem[];
  }
> = {
  offers: {
    icon: "🔎",
    title: "オファー",
    description: "演奏案件を探し、施設からの招待を確認できます。",
    items: [
      {
        icon: "🎵",
        title: "案件を探す",
        description: "演奏・イベント参加・レンタルの募集",
        path: "/performer/requests",
      },
      {
        icon: "🗺️",
        title: "地図から探す",
        description: "演奏案件やレッスンを地図で探す",
        path: "/performer/map",
      },
      {
        icon: "✉️",
        title: "招待案件を確認する",
        description: "施設から届いた出演の招待",
        path: "/performer/invitations",
      },
    ],
  },
  matches: {
    icon: "🎉",
    title: "マッチング",
    description: "成立した出演の予定と進行状況を確認できます。",
    items: [
      {
        icon: "📅",
        title: "マッチングを確認する",
        description: "演奏予定・演奏完了・キャンセル済み",
        path: "/performer/matches",
      },
    ],
  },
  lesson: {
    icon: "🎹",
    title: "レッスン",
    description: "レッスンを受ける・教える相手を募集します。",
    items: [
      {
        icon: "🔍",
        title: "募集条件で探す",
        description: "レッスンの募集内容を確認する",
        path: "/performer/lesson",
      },
      {
        icon: "🗺️",
        title: "地図から探す",
        description: "地図から演奏案件やレッスンを探す",
        path: "/performer/map",
      },
      {
        icon: "👨‍🏫",
        title: "生徒を募集する",
        description: "レッスン条件を登録して生徒を募集する",
        path: "/performer/lesson/new",
      },
    ],
  },
  bands: {
    icon: "🎸",
    title: "バンド",
    description: "バンド・メンバー・チャット・コインを管理します。",
    items: [
      {
        icon: "👥",
        title: "自分のバンドを管理する",
        description: "バンド作成・メンバー招待・チャット・コイン送金",
        path: "/performer/bands",
      },
    ],
  },
  other: {
    icon: "⚙️",
    title: "その他の機能",
    description: "プロフィールやお気に入り、お問い合わせはこちら。",
    items: [
      {
        icon: "⭐",
        title: "お気に入り",
        description: "気になる施設を見る",
        path: "/performer/favorites",
      },
      {
        icon: "👤",
        title: "演奏者情報を編集",
        description: "プロフィールを編集する",
        path: "/performer/profile/edit",
      },
      {
        icon: "💬",
        title: "お問い合わせ",
        description: "質問・不具合を報告する",
        path: "/inquiry",
      },
    ],
  },
};

const mainMenus: Array<{
  key: Exclude<MenuKey, "home" | "other">;
  icon: string;
  title: string;
  description: string;
  style: string;
}> = [
  {
    key: "offers",
    icon: "🔎",
    title: "オファー",
    description: "案件を探す・招待を確認する",
    style: "border-blue-200 bg-blue-50 active:bg-blue-100",
  },
  {
    key: "matches",
    icon: "🎉",
    title: "マッチング",
    description: "演奏予定・進行状況を確認する",
    style: "border-emerald-200 bg-emerald-50 active:bg-emerald-100",
  },
  {
    key: "lesson",
    icon: "🎹",
    title: "レッスン",
    description: "レッスンを探す・生徒を募集する",
    style: "border-purple-200 bg-purple-50 active:bg-purple-100",
  },
  {
    key: "bands",
    icon: "🎸",
    title: "バンド",
    description: "バンド・メンバー・コインを管理する",
    style: "border-amber-200 bg-amber-50 active:bg-amber-100",
  },
];

export default function PerformerHomePage() {
  const router = useRouter();

  const [menu, setMenu] = useState<MenuKey>("home");
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [coinLoading, setCoinLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadCoinBalance() {
      try {
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

        const profile = await liff.getProfile();

        const response = await fetch("/api/coins/balance", {
          headers: {
            "x-line-user-id": profile.userId,
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
          setCoinBalance(data.coinBalance ?? 0);
        }
      } catch (error) {
        console.error("コイン残高取得エラー:", error);
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
  }, []);

  const openMenu = (
    selected: Exclude<MenuKey, "home">
  ) => {
    setMenu(selected);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto min-h-screen max-w-md px-4 py-6">
        <header className="pt-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {menu !== "home" && (
                <button
                  type="button"
                  onClick={() => setMenu("home")}
                  className="mb-4 text-sm font-bold text-gray-500"
                >
                  ← ホームへ戻る
                </button>
              )}

              <p className="text-sm font-medium text-gray-500">
                演奏マッチング
              </p>

              <h1 className="mt-1 text-2xl font-bold text-gray-900">
                {menu === "home"
                  ? "🎸 演奏者ホーム"
                  : `${menuConfig[menu].icon} ${menuConfig[menu].title}`}
              </h1>
            </div>

            <button
              type="button"
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
            {menu === "home"
              ? "利用したい機能を選んでください。"
              : menuConfig[menu].description}
          </p>
        </header>

        {menu === "home" ? (
          <>
            <section className="mt-7 space-y-3">
              {mainMenus.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => openMenu(item.key)}
                  className={`w-full rounded-2xl border px-5 py-5 text-left shadow-sm transition active:scale-[0.99] ${item.style}`}
                >
                  <div className="flex items-center gap-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl">
                      {item.icon}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-bold text-gray-900">
                        {item.title}
                      </p>

                      <p className="mt-1 text-sm leading-5 text-gray-600">
                        {item.description}
                      </p>
                    </div>

                    <span
                      className="text-xl text-gray-400"
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </div>
                </button>
              ))}
            </section>

            <button
              type="button"
              onClick={() => openMenu("other")}
              className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-gray-500 active:bg-gray-100"
            >
              ⚙️ その他の機能（お気に入り・プロフィール・お問い合わせ） →
            </button>
          </>
        ) : (
          <section className="mt-7 space-y-3">
            {menuConfig[menu].items.map((item) => (
              <button
                key={`${item.title}-${item.path}`}
                type="button"
                onClick={() => router.push(item.path)}
                className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-5 text-left shadow-sm transition active:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-xl">
                    {item.icon}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-900">
                      {item.title}
                    </p>

                    <p className="mt-1 text-sm leading-5 text-gray-500">
                      {item.description}
                    </p>
                  </div>

                  <span
                    className="text-xl text-gray-400"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </div>
              </button>
            ))}

            <button
              type="button"
              onClick={() => setMenu("home")}
              className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm font-bold text-gray-600 active:bg-gray-50"
            >
              ← 4つのメニューに戻る
            </button>
          </section>
        )}

        <p className="mt-10 pb-4 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>
      </div>
    </main>
  );
}