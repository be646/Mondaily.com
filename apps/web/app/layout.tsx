import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Mondaily — Your entire business, run by AI",
  description: "A fully AI business operating system for sales, real estate, HR, finance, investments, and operations."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

