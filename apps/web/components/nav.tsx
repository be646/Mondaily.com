"use client";
import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
      <Link href="/" className="flex items-center">
        <Logo size={38} />
      </Link>
      <div className="flex items-center gap-2">
        <a
          href="https://app.mondaily.com/sign-in"
          className="px-4 py-2 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors font-mono"
        >
          Sign in
        </a>
        <a
          href="https://app.mondaily.com/sign-up"
          className="rounded-lg border border-violet-500/25 bg-violet-600/12 px-4 py-2 text-[11px] text-violet-400 hover:bg-violet-600/20 hover:text-violet-200 transition-all font-mono"
        >
          Start free →
        </a>
      </div>
    </nav>
  );
}
