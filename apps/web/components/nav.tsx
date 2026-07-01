"use client";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "./logo";

const NAV_LINKS: [string, string][] = [
  ["Product", "#product"],
  ["Solutions", "#solutions"],
  ["Developer", "/docs"],
  ["Company", "#company"],
  ["Pricing", "#pricing"],
  ["News", "/changelog"],
];

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="relative mx-auto flex w-full max-w-7xl items-center gap-5 px-4 py-4 text-neutral-950 sm:px-8 lg:px-10 dark:text-neutral-50">
      <Link
        href="/"
        className="flex shrink-0 items-center text-neutral-950 transition-opacity hover:opacity-80 dark:text-neutral-50"
        aria-label="Mondaily home"
      >
        <Logo size={48} />
      </Link>

      <div className="hidden flex-1 items-center gap-7 text-[14px] font-normal text-neutral-500 md:flex dark:text-neutral-400">
        {NAV_LINKS.map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="transition-colors hover:text-neutral-950 dark:hover:text-neutral-50"
          >
            {label}
          </a>
        ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <a
          href="https://app.mondaily.com/sign-in"
          className="hidden whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-normal text-neutral-500 transition-colors hover:text-neutral-950 sm:inline-block dark:text-neutral-400 dark:hover:text-neutral-50"
        >
          Sign in
        </a>
        <a
          href="https://app.mondaily.com/sign-up"
          className="whitespace-nowrap rounded-full border border-neutral-950 bg-neutral-950 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950"
        >
          Start free
        </a>

        {/* Mobile menu toggle — the nav links were completely unreachable below md (no way to open
            Product/Solutions/Developer/Company/Pricing/News on a phone). */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-black/[.05] md:hidden dark:text-neutral-300 dark:hover:bg-white/[.08]"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            {open ? (
              <path d="M2 2L16 16M16 2L2 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            ) : (
              <path d="M2 4.5H16M2 9H16M2 13.5H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 border-b border-black/[.08] bg-white px-4 py-4 shadow-lg md:hidden dark:border-white/[.08] dark:bg-neutral-950">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map(([label, href]) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-[15px] font-normal text-neutral-600 transition-colors hover:bg-black/[.04] hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/[.06] dark:hover:text-neutral-50"
              >
                {label}
              </a>
            ))}
            <a
              href="https://app.mondaily.com/sign-in"
              className="mt-1 rounded-lg px-3 py-2.5 text-[15px] font-normal text-neutral-600 transition-colors hover:bg-black/[.04] hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/[.06] dark:hover:text-neutral-50"
            >
              Sign in
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
