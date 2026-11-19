"use client";

import Link from "next/link";

export default function LessonFeatureNotice() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <section className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <p className="text-3xl" aria-hidden="true">🎹</p>
        <h1 className="mt-3 text-xl font-bold text-gray-900">
          レッスン機能は現在停止しています
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          公開準備のため、レッスンの募集・編集・応募を一時停止しています。再開までお待ちください。
        </p>
        <Link
          href="/performer/home"
          className="mt-6 inline-flex rounded-xl bg-black px-5 py-3 text-sm font-bold text-white"
        >
          ホームへ戻る
        </Link>
      </section>
    </main>
  );
}
