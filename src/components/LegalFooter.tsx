import Link from "next/link";

export default function LegalFooter() {
  return (
    <footer className="mt-10 border-t border-gray-200 pt-5 pb-6 text-center">
      <nav aria-label="法的情報" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-xs text-gray-500">
        <Link href="/terms" className="underline underline-offset-4 hover:text-gray-900">
          利用規約
        </Link>
        <Link href="/specified-commercial-transactions" className="underline underline-offset-4 hover:text-gray-900">
          特定商取引法に基づく表記
        </Link>
      </nav>
      <p className="mt-4 text-[11px] text-gray-400">© Hakotohito</p>
    </footer>
  );
}
