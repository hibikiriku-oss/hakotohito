import Link from "next/link";

export const metadata = {
  title: "特定商取引法に基づく表記 | Hakotohito",
  description: "Hakotohitoのコイン販売に関する特定商取引法に基づく表示です。",
};

const rows = [
  ["販売事業者", "中山 寛之（個人事業主）"],
  ["屋号", "Mmatch"],
  ["運営責任者", "中山 寛之"],
  ["所在地", "三重県桑名市小貝須1596-3"],
  ["電話番号", "059-423-1617"],
  ["メールアドレス", "nakayama408@ymail.ne.jp"],
  ["販売価格", "1コインあたりの価格および購入総額を、コイン購入画面に表示します。購入画面に表示される金額が支払総額です。購入総額は決済確定前に確認できます。"],
  ["商品代金以外の必要料金", "インターネット接続料金・通信料金等は利用者の負担となります。コインの配送はありません。"],
  ["支払方法", "Stripe Checkoutを通じ、購入画面に表示される決済方法をご利用いただけます。"],
  ["支払時期", "選択した決済方法に応じ、Stripe Checkoutで決済手続を完了した時点でお支払いが行われます。"],
  ["提供時期", "Stripeから決済成功の通知を受け、運営者のシステムで決済内容を確認した後、コイン残高へ反映します。システム状況により反映まで時間を要する場合があります。"],
  ["販売数量・購入上限", "購入数量は整数単位です。1回あたりの購入上限は315,000円です。購入画面に表示される条件が優先します。"],
  ["返品・キャンセル", "デジタルコインの性質上、購入手続完了後のお客様都合によるキャンセル・返品・返金は原則としてお受けしていません。ただし、法令上必要な場合、重複決済・誤請求その他当社の責めに帰すべき事由がある場合は、法令および本サービス所定の手続に従って対応します。"],
  ["動作環境", "LINEアプリおよび本サービスが対応するスマートフォン・ブラウザ環境が必要です。"],
];

export default function SpecifiedCommercialTransactionsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-8 text-gray-900">
      <header className="mb-8 border-b border-gray-200 pb-5">
        <p className="text-xs font-semibold tracking-widest text-gray-500">HAKOTOHITO</p>
        <h1 className="mt-2 text-2xl font-bold">特定商取引法に基づく表記</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">最終更新日：2026年11月23日</p>
      </header>
      <p className="mb-6 text-sm leading-7 text-gray-700">本ページは、Hakotohitoにおける有償コインの販売条件を表示するものです。</p>
      <dl className="divide-y divide-gray-200 border-y border-gray-200">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-1 gap-2 py-4 sm:grid-cols-[12rem_1fr] sm:gap-5">
            <dt className="text-sm font-bold text-gray-800">{label}</dt>
            <dd className="whitespace-pre-line text-sm leading-7 text-gray-700">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-8 rounded-xl bg-gray-50 p-4 text-sm leading-7 text-gray-700">
        <h2 className="font-bold text-gray-900">お問い合わせ</h2>
        <p className="mt-2">上記の電話番号またはメールアドレスまでご連絡ください。</p>
      </section>
      <div className="mt-8 flex flex-wrap gap-4 text-sm"><Link href="/terms" className="underline underline-offset-4">利用規約</Link><Link href="/" className="underline underline-offset-4">ホームへ戻る</Link></div>
    </main>
  );
}
