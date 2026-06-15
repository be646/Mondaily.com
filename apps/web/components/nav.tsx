"use client";
import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <Link href="/" className="flex items-center gap-3.5">
        <Logo size={38} />
        <span style={{
          fontFamily: "'Montserrat', system-ui, sans-serif",
          fontWeight: 200,
          letterSpacing: "0.24em",
          fontSize: "1rem",
          textTransform: "uppercase",
          color: "white",
        }}>MONDAILY</span>
      </Link>
      <div className="flex items-center gap-1 text-sm">
        <Link href="/pricing" className="px-3 py-2 text-[13px] text-zinc-500 hover:text-white transition-colors font-mono">Pricing</Link>
        <Link href="/changelog" className="px-3 py-2 text-[13px] text-zinc-500 hover:text-white transition-colors font-mono">Changelog</Link>
        <a
          href="https://app.mondaily.com/sign-in"
          className="ml-2 px-4 py-2 text-[13px] text-zinc-400 hover:text-white transition-colors font-mono"
        >
          Sign in
        </a>
        <a
          href="https://app.mondaily.com/sign-up"
          className="rounded-lg border border-violet-500/40 bg-violet-600/20 px-4 py-2 text-[13px] font-medium text-violet-300 hover:bg-violet-600/30 hover:text-white transition-all font-mono"
        >
          Start free →
        </a>
      </div>
    </nav>
  );
}
