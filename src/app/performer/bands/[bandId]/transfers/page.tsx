import Link from "next/link";

export default function BandTransfersPage() {
  return (
    <main className="mx-auto max-w-xl p-5">
      <section className="rounded-2xl border bg-white p-6">
        <h1 className="text-xl font-bold">バンド内コイン送金</h1>
        <p className="mt-4 text-sm leading-7 text-gray-600">
          バンドメンバー間のコイン送金機能は、現在停止しています。
          コインはHakotohito内の対象サービス利用料にご利用ください。
        </p>
        <Link href="/performer/bands" className="mt-6 inline-flex rounded-xl bg-black px-4 py-3 font-bold text-white">
          バンド一覧に戻る
        </Link>
      </section>
    </main>
  );
}
