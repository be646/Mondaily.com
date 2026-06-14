"use client";
import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <Link href="/" className="flex items-center gap-3">
        <Logo size={36} />
        <span style={{
          fontWeight: 200,
          letterSpacing: "0.22em",
          fontSize: "0.95rem",
          textTransform: "uppercase",
          color: "white",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}>MONDAILY</span>
      </Link>
      <div className="flex items-center gap-2 text-sm">
        <Link href="/pricing" className="px-3 py-2 text-slate-400 hover:text-white transition-colors">Pricing</Link>
        <Link href="/changelog" className="px-3 py-2 text-slate-400 hover:text-white transition-colors">Changelog</Link>
        <a
          href="https://app.mondaily.com/sign-in"
          className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
        >
          Sign in
        </a>
        <a
          href="https://app.mondaily.com/sign-up"
          className="rounded-lg border-x border-t border-orange-400/40 border-b-[3px] border-b-orange-700 bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-400 active:translate-y-[1px] transition-all"
        >
          Start free
        </a>
      </div>
    </nav>
  );
}
