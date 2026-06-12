"use client";
import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <Link href="/" className="flex items-center gap-3">
        <Logo size={44} />
        <span style={{
          fontWeight: 100,
          letterSpacing: "0.25em",
          fontSize: "1.05rem",
          textTransform: "uppercase",
          color: "white",
          fontFamily: "system-ui, -apple-system, sans-serif"
        }}>mondaily</span>
      </Link>
      <div className="flex items-center gap-6 text-sm text-slate-400">
        <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
        <Link href="/changelog" className="hover:text-white transition-colors">Changelog</Link>
        <a className="rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-400 transition-colors text-sm" href="https://app.mondaily.com">Start free</a>
      </div>
    </nav>
  );
}
