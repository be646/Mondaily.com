"use client";
import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-10 sm:py-5">
      <Link href="/" className="flex shrink-0 items-center text-zinc-900">
        <Logo size={40}/>
      </Link>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <a
          href="https://app.mondaily.com/sign-in"
          className="whitespace-nowrap px-2.5 py-2 text-[11px] text-zinc-500 hover:text-zinc-900 transition-colors font-mono sm:px-4"
        >
          Sign in
        </a>
        <a
          href="https://app.mondaily.com/sign-up"
          className="whitespace-nowrap rounded-lg border border-indigo-500/25 bg-indigo-600/12 px-3 py-2 text-[11px] text-indigo-600 hover:bg-indigo-600/20 hover:text-indigo-700 transition-all font-mono sm:px-4"
        >
          Start free →
        </a>
      </div>
    </nav>
  );
}
