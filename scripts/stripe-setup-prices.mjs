#!/usr/bin/env node
/**
 * Create Stripe multi-currency Prices for the Operator and Command plans so Mondaily can CHARGE in
 * USD / EUR / GBP (not just display converted amounts). Each plan+interval becomes ONE recurring
 * Price whose USD amount is the base and whose EUR/GBP amounts come from currency_options — the SAME
 * numbers the app shows (packages/shared/src/pricing.ts → priceInCurrency), so displayed == charged.
 *
 * Sovereign note: Stripe is our sanctioned PAYMENTS processor. This script only talks to Stripe's own
 * API with your secret key — no third-party FX service; the amounts come from our own catalog.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-setup-prices.mjs
 * It prints the new price IDs — paste them into Vercel as:
 *   STRIPE_PRICE_OPERATOR_MONTH / _YEAR, STRIPE_PRICE_COMMAND_MONTH / _YEAR
 */

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error("Set STRIPE_SECRET_KEY first."); process.exit(1); }

// Mirror packages/shared/src/pricing.ts (kept in sync by hand — tiny + rarely changes).
const PRICING_FX = { USD: 1, EUR: 0.88, GBP: 0.75 };
const roundPrice = (usd, cur) => Math.round(usd * PRICING_FX[cur]);
const PLANS = {
  operator: { name: "Operator", month: 29, year: 23 },
  command:  { name: "Command",  month: 79, year: 63 },
};
const CURRENCIES = ["usd", "eur", "gbp"];

async function stripe(path, params) {
  const body = new URLSearchParams();
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      const key = prefix ? `${prefix}[${k}]` : k;
      if (typeof v === "object") walk(v, key); else body.append(key, String(v));
    }
  };
  walk(params, "");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error?.message ?? res.status}`);
  return json;
}

async function run() {
  // One reusable Product per plan.
  for (const [planId, plan] of Object.entries(PLANS)) {
    const product = await stripe("products", { name: `Mondaily ${plan.name}` });
    for (const interval of ["month", "year"]) {
      const usd = plan[interval];
      // currency_options carries the EUR/GBP amounts; the top-level unit_amount is USD.
      const currency_options = {};
      for (const cur of CURRENCIES) {
        if (cur === "usd") continue;
        currency_options[cur] = { unit_amount: roundPrice(usd, cur.toUpperCase()) * 100 };
      }
      const price = await stripe("prices", {
        product: product.id,
        currency: "usd",
        unit_amount: usd * 100,
        recurring: { interval },
        currency_options,
        nickname: `${plan.name} ${interval} (multi-currency)`,
      });
      const amounts = CURRENCIES.map(c => `${c.toUpperCase()} ${roundPrice(usd, c.toUpperCase())}`).join(" / ");
      console.log(`STRIPE_PRICE_${planId.toUpperCase()}_${interval.toUpperCase()}=${price.id}   (${amounts})`);
    }
  }
  console.log("\nDone. Paste the STRIPE_PRICE_* lines above into Vercel env, then redeploy.");
}

run().catch(e => { console.error(e.message); process.exit(1); });
