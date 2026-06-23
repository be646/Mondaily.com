"use client";
import Link from "next/link";
import { Logo } from "./logo";

export function Nav() {
  return (
    <nav className="mx-auto grid w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3 text-neutral-950 sm:px-8 lg:px-10 dark:text-neutral-50">
      <Link
        href="/"
        className="flex shrink-0 items-center justify-self-start text-neutral-950 transition-opacity hover:opacity-80 dark:text-neutral-50"
        aria-label="Mondaily home"
      >
        <Logo size={40} />
      </Link>

      <div className="hidden items-center justify-center gap-1 rounded-full border border-neutral-200 bg-white px-1.5 py-1 text-sm shadow-sm shadow-neutral-950/[.03] md:flex dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/20">
        {[
          ["Agents", "#agents"],
          ["Workflow", "#workflow"],
          ["Pricing", "#pricing"],
          ["FAQ", "#faq"],
        ].map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="rounded-full px-4 py-2 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
          >
            {label}
          </a>
        ))}
      </div>

      <div className="flex shrink-0 items-center justify-self-end gap-2 sm:gap-3">
        <a
          href="https://app.mondaily.com/sign-in"
          className="whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 sm:px-4 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-50"
        >
          Sign in
        </a>
        <a
          href="https://app.mondaily.com/sign-up"
          className="whitespace-nowrap rounded-full border border-neutral-950 bg-neutral-950 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 sm:px-5 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white"
        >
          Start free
        </a>
      </div>
    </nav>
  );
}
