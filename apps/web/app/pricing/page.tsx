import type { Metadata } from "next";
import { PricingTable } from "../../components/pricing-table";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple, flat pricing for Mondaily. Start free on Scout, or scale to Operator, Command, and Sovereign. Operators + AI credits, no per-seat surprises.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing · Mondaily",
    description: "Start free, then scale — Scout, Operator, Command, Sovereign. Operators + AI credits, flat pricing.",
    url: "https://mondaily.com/pricing",
  },
};

export default function PricingPage() {
  return <PricingTable />;
}

