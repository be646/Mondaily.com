"use client";
import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto flex w-full max-w-7xl items-center gap-5 px-4 py-4 text-neutral-950 sm:px-8 lg:px-10 dark:text-neutral-50">
      <Link
        href="/"
        className="flex shrink-0 items-center text-neutral-950 transition-opacity hover:opacity-80 dark:text-neutral-50"
        aria-label="Mondaily home"
      >
        <Logo size={48} />
      </Link>

      <div className="hidden flex-1 items-center gap-7 text-[14px] font-normal text-neutral-500 md:flex dark:text-neutral-400">
        {[
          ["Product", "#product"],
          ["Solutions", "#solutions"],
          ["Developer", "/docs"],
          ["Company", "#company"],
          ["Pricing", "#pricing"],
          ["News", "/changelog"],
        ].map(([label, href]) => (
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
          className="whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-normal text-neutral-500 transition-colors hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-neutral-50"
        >
          Sign in
        </a>
        <a
          href="https://app.mondaily.com/sign-up"
          className="whitespace-nowrap rounded-full border border-neutral-950 bg-neutral-950 px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950"
        >
          Start free
        </a>
      </div>
    </nav>
  );
}
