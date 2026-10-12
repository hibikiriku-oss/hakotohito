"use client";

import { useRouter } from "next/navigation";

export default function FacilityHomePage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 py-6">

        {/* ヘッダー */}
        <header className="pt-2 pb-6">
          <p className="text-sm font-medium text-gray-500">
            演奏マッチング
          </p>

          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            🏢 施設ホーム
          </h1>

          <p className="text-sm text-gray-600 mt-3 leading-relaxed">
            演奏者を探したり、演奏依頼やマッチングを管理できます。
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
                    🎵 演奏依頼を作成する
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