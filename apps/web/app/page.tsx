import { Hero } from "../components/hero";
import { FeatureSection } from "../components/feature-section";
import { PricingTable } from "../components/pricing-table";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <FeatureSection />
      <PricingTable />
    </main>
  );
}

