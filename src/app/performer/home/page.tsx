"use client";

import { useRouter } from "next/navigation";

export default function PerformerHomePage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <h1 className="text-2xl font-bold">
          🎸 演奏者ホーム
        </h1>

        <p className="mt-4 text-gray-600">
          演奏案件を探して、施設からの依頼を受けましょう。
        </p>

        <div className="mt-8 space-y-3">

          <button
            onClick={() =>
              router.push(
                "/performer/requests"
              )
            }
            className="w-full bg-black text-white rounded-xl p-4"
          >
            🔍 演奏案件を探す
          </button>

          <button
            onClick={() =>
              router.push(
                "/performer/matches"
              )
            }
            className="w-full bg-white border rounded-xl p-4"
          >
            🎉 マッチングを見る
          </button>

          <button
            className="w-full bg-white border rounded-xl p-4"
          >
            👤 プロフィールを見る
          </button>

        </div>
      </div>
    </main>
  );
}