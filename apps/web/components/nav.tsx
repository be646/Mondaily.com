"use client";
import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
      <Link href="/" className="flex items-center">
        <Logo size={40} />
      </Link>
      <div className="flex items-center gap-2">
        <a
          href="https://app.mondaily.com/sign-in"
          className="px-4 py-2 text-[12px] text-zinc-500 hover:text-white transition-colors"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Sign in
        </a>
        <a
          href="https://app.mondaily.com/sign-up"
          className="rounded-lg border border-violet-500/30 bg-violet-600/15 px-4 py-2 text-[12px] font-medium text-violet-300 hover:bg-violet-600/25 hover:text-white transition-all"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Start free →
        </a>
      </div>
    </nav>
  );
}
