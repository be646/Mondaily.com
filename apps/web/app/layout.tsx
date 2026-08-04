import { Orbitron, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";

import { SITE_URL as SITE } from "@/lib/site-url";

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-orbitron",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const TITLE = "Mondaily — One workspace. Every signal. Always thinking.";
const DESCRIPTION = "The autonomous AI workspace for operators + agents. Graph, discovery, automations, finance & billing — all connected, always running. Start free.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: "%s · Mondaily" },
  description: DESCRIPTION,
  applicationName: "Mondaily",
  keywords: ["autonomous AI workspace", "AI agents", "operations", "relationship graph", "lead discovery", "workflow automation", "finance and billing", "Mondaily"],
  authors: [{ name: "Mondaily Networks" }],
  creator: "Mondaily",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Mondaily",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

// Structured data for rich results — Organization + the product as a SoftwareApplication.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: "Mondaily", url: SITE, description: DESCRIPTION },
    {
      "@type": "SoftwareApplication",
      name: "Mondaily",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE,
      description: DESCRIPTION,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free Scout plan" },
    },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${jetbrainsMono.variable}`}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        {children}
      </body>
    </html>
  );
}
