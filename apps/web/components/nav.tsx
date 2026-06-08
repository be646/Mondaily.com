import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <Link href="/" className="flex items-center gap-2.5">
        <Logo size={32} />
        <span className="font-semibold text-white">Mondaily</span>
      </Link>
      <div className="flex items-center gap-5 text-sm text-slate-300">
        <Link href="/pricing">Pricing</Link>
        <Link href="/changelog">Changelog</Link>
        <a className="rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-400 transition-colors" href="https://app.mondaily.com">Start free</a>
      </div>
    </nav>
  );
}
