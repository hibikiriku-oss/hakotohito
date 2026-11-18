import Link from "next/link";
export default function PaymentCancelledPage() {
  return <main className="mx-auto max-w-xl p-5"><section className="rounded-2xl border bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold">決済はキャンセルされました</h1><p className="mt-4 text-sm leading-6 text-gray-600">お支払いは完了していません。必要な場合は、サービス画面からもう一度お手続きください。</p><Link href="/" className="mt-6 inline-block rounded-xl bg-black px-5 py-3 font-bold text-white">トップへ戻る</Link></section></main>;
}
