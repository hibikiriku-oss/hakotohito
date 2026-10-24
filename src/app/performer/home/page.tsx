"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type MenuTone =
  | "dark"
  | "blue"
  | "green"
  | "purple"
  | "amber"
  | "neutral";

type MenuButtonProps = {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
  tone?: MenuTone;
};

const toneClasses: Record<MenuTone, string> = {
  dark: "border-gray-900 bg-black active:bg-gray-800",
  blue: "border-blue-100 bg-blue-50 active:bg-blue-100",
  green: "border-emerald-100 bg-emerald-50 active:bg-emerald-100",
  purple: "border-purple-100 bg-purple-50 active:bg-purple-100",
  amber: "border-amber-100 bg-amber-50 active:bg-amber-100",
  neutral: "border-gray-200 bg-white active:bg-gray-50",
};

function MenuButton({
  icon,
  title,
  description,
  onClick,
  tone = "neutral",
}: MenuButtonProps) {
  const dark = tone === "dark";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border px-4 py-4 text-left shadow-sm transition active:scale-[0.99] ${toneClasses[tone]}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 text-xl">
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={`font-bold ${
              dark ? "text-white" : "text-gray-900"
            }`}
          >
            {title}
          </p>

          <p
            className={`mt-1 text-xs leading-5 ${
              dark ? "text-gray-300" : "text-gray-500"
            }`}
          >
            {description}
          </p>
        </div>

        <span
          className={`shrink-0 text-xl ${
            dark ? "text-gray-300" : "text-gray-400"
          }`}
          aria-hidden="true"
        >
          →
        </span>
      </div>
    </button>
  );
}

type MenuSectionProps = {
  icon: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

function MenuSection({
  icon,
  title,
  description,
  children,
}: MenuSectionProps) {
  return (
    <section className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-3 px-1">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-2xl">
          {icon}
        </div>

        <div>
          <h2 className="text-lg font-bold text-gray-900">
            {title}
          </h2>

          <p className="mt-1 text-xs leading-5 text-gray-500">
            {description}
          </p>
        </div>
      </div>

      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default function PerformerHomePage() {
  const router = useRouter();

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

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto min-h-screen max-w-md px-4 py-6">
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
            演奏案件・レッスン・バンド活動を、ここから管理できます。
          </p>
        </header>

        {/* オファー */}
        <div className="mt-7 space-y-4">
          <MenuSection
            icon="🔎"
            title="オファー"
            description="演奏できる案件を探す・施設からの招待を確認する"
          >
            <MenuButton
              icon="🎵"
              title="案件を探す"
              description="演奏・イベント参加・レンタルの募集"
              tone="dark"
              onClick={() => router.push("/performer/requests")}
            />

            <MenuButton
              icon="🗺️"
              title="地図から探す"
              description="演奏案件やレッスンを地図で探す"
              tone="green"
              onClick={() => router.push("/performer/map")}
            />

            <MenuButton
              icon="✉️"
              title="招待案件を確認する"
              description="施設から届いた出演の招待"
              tone="blue"
              onClick={() => router.push("/performer/invitations")}
            />
          </MenuSection>

          {/* マッチング */}
          <MenuSection
            icon="📅"
            title="マッチング"
            description="成立した出演の予定と進行状況を確認する"
          >
            <MenuButton
              icon="🎉"
              title="マッチングを確認する"
              description="演奏予定・演奏完了・キャンセル済み"
              tone="neutral"
              onClick={() => router.push("/performer/matches")}
            />
          </MenuSection>

          {/* レッスン */}
          <MenuSection
            icon="🎹"
            title="レッスン"
            description="レッスンを受ける・教える相手を募集する"
          >
            <MenuButton
              icon="🔍"
              title="募集条件で探す"
              description="受けたいレッスンや条件を確認する"
              tone="purple"
              onClick={() => router.push("/performer/lesson")}
            />

            <MenuButton
              icon="🗺️"
              title="地図から探す"
              description="近くの演奏案件やレッスンを探す"
              tone="green"
              onClick={() => router.push("/performer/map")}
            />

            <MenuButton
              icon="👨‍🏫"
              title="生徒を募集する"
              description="レッスンの条件を登録して生徒を募集する"
              tone="purple"
              onClick={() => router.push("/performer/lesson/new")}
            />
          </MenuSection>

          {/* バンド */}
          <MenuSection
            icon="🎸"
            title="バンド"
            description="自分のバンド・メンバー・コインを管理する"
          >
            <MenuButton
              icon="👥"
              title="自分のバンドを管理する"
              description="バンド作成・詳細・チャット・メンバー招待・コイン送金"
              tone="amber"
              onClick={() => router.push("/performer/bands")}
            />
          </MenuSection>
        </div>

        {/* その他 */}
        <section className="mt-8">
          <h2 className="mb-3 px-1 text-sm font-bold text-gray-500">
            その他
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => router.push("/performer/favorites")}
              className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50"
            >
              <span className="text-2xl">⭐</span>

              <p className="mt-3 font-bold text-gray-900">
                お気に入り
              </p>

              <p className="mt-1 text-xs leading-5 text-gray-500">
                気になる施設を見る
              </p>
            </button>

            <button
              type="button"
              onClick={() => router.push("/performer/profile/edit")}
              className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50"
            >
              <span className="text-2xl">👤</span>

              <p className="mt-3 font-bold text-gray-900">
                演奏者情報を編集
              </p>

              <p className="mt-1 text-xs leading-5 text-gray-500">
                プロフィールを編集
              </p>
            </button>

            <button
              type="button"
              onClick={() => router.push("/inquiry")}
              className="col-span-2 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:bg-gray-50"
            >
              <span className="text-2xl">💬</span>

              <span className="flex-1">
                <span className="block font-bold text-gray-900">
                  お問い合わせ
                </span>

                <span className="mt-1 block text-xs leading-5 text-gray-500">
                  ご質問・不具合の報告
                </span>
              </span>

              <span className="text-xl text-gray-400" aria-hidden="true">
                →
              </span>
            </button>
          </div>
        </section>

        <p className="mt-10 pb-4 text-center text-xs text-gray-400">
          あなたの演奏を、必要としている場所へ。
        </p>
      </div>
    </main>
  );
}