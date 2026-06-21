import { PricingSection } from "./landing-page";

// Was a standalone stub with its own plan names/prices ($7.99/$12.99) that
// contradicted the real pricing shown on the landing page. Now renders the
// exact same plans/component so there's only one source of truth.
export function PricingTable() {
  return <PricingSection/>;
}

