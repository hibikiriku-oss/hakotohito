"use client";

import Link from "next/link";
export default function PaymentCompletePage() {
  return <main className="mx-auto max-w-xl p-5"><section className="rounded-2xl border bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold">お支払い手続き</h1><p className="mt-4 text-sm leading-6 text-gray-600">決済結果を受け付けました。StripeからのWebhookで支払いを確認した後、サービス側の履行・送金処理に反映されます。</p><Link href="/" className="mt-6 inline-block rounded-xl bg-black px-5 py-3 font-bold text-white">トップへ戻る</Link></section></main>;
}
