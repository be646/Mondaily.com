import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { apiClient } from "../../lib/api-client";

/**
 * Embedded Stripe payment — the card field lives on OUR OWN page (never a redirect to
 * checkout.stripe.com), styled to match Mondaily. Stripe's Payment Element itself renders the
 * "Powered by Stripe" mark by default, which we keep visible (required by Stripe's terms and
 * exactly what was asked for: "says by Stripe"). Raw card numbers go straight from the user's
 * browser to Stripe — they never touch our servers, which is what makes this PCI-compliant.
 */

// Minimal shape of the global window.Stripe() object we actually use — avoids pulling in the
// full @stripe/stripe-js type package as a dependency for a few method calls.
interface StripeElements { create: (type: string, opts?: Record<string, unknown>) => { mount: (sel: string) => void; destroy: () => void };
  submit?: () => Promise<{ error?: { message?: string } }> }
interface StripeJs {
  elements: (opts: Record<string, unknown>) => StripeElements;
  confirmSetup: (opts: Record<string, unknown>) => Promise<{ error?: { message?: string }; setupIntent?: { payment_method?: string; status?: string } }>;
  confirmCardPayment: (clientSecret: string) => Promise<{ error?: { message?: string }; paymentIntent?: { status?: string } }>;
}
declare global {
  interface Window { Stripe?: (pk: string) => StripeJs }
}

let stripeJsPromise: Promise<void> | null = null;
function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  if (!stripeJsPromise) {
    stripeJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Stripe.js"));
      document.head.appendChild(script);
    });
  }
  return stripeJsPromise;
}

/**
 * Stripe's appearance API needs REAL color values — it does not resolve CSS custom properties like
 * `var(--text-primary)`. So we resolve each theme token to its computed rgb() via a throwaway probe
 * element, then hand Stripe concrete colors. This makes the embedded card field match whichever theme
 * (dark or light) the user is on, instead of falling back to Stripe's white default.
 */
function resolveVar(host: HTMLElement, name: string, prop: "color" | "backgroundColor" = "color", fallback = ""): string {
  try {
    // Probe INSIDE the themed subtree (host) — the theme is a class on a wrapper, so a probe on
    // document.body would read the light DEFAULT values and mis-theme the card field.
    const el = document.createElement("div");
    el.style.position = "absolute"; el.style.opacity = "0"; el.style.pointerEvents = "none";
    if (prop === "color") el.style.color = `var(${name})`; else el.style.backgroundColor = `var(${name})`;
    host.appendChild(el);
    const v = getComputedStyle(el)[prop] as string;
    el.remove();
    return v && v !== "rgba(0, 0, 0, 0)" ? v : fallback;
  } catch { return fallback; }
}

function buildStripeAppearance(host: HTMLElement) {
  // Judge dark vs light from a SOLID surface (--surface-card is the modal's real bg). Using a
  // translucent token like --surface-hover mis-read as near-white, which left Stripe on its light
  // default. With the right base theme ("night"/"stripe") the fields match without hand-picking.
  const surface = resolveVar(host, "--surface-card", "backgroundColor", "#111114");
  const rgb = (surface.match(/\d+(\.\d+)?/g) ?? ["17", "17", "20"]).map(Number);
  const lum = (0.299 * (rgb[0] ?? 17) + 0.587 * (rgb[1] ?? 17) + 0.114 * (rgb[2] ?? 20)) / 255;
  const dark = lum < 0.5;
  const accent = resolveVar(host, "--section-accent", "color", dark ? "#7d9b83" : "#2f6f4f");
  const font = getComputedStyle(host).fontFamily || "system-ui, -apple-system, sans-serif";
  return {
    theme: (dark ? "night" : "stripe") as "night" | "stripe",
    variables: {
      colorPrimary: accent,
      fontFamily: font,
      borderRadius: "8px",
      spacingUnit: "4px",
      fontSizeBase: "14px",
      ...(dark ? { colorBackground: surface } : {}),
    },
    rules: {
      ".Input:focus": { border: `1px solid ${accent}`, boxShadow: `0 0 0 1px ${accent}` },
      ".Tab--selected": { borderColor: accent },
      ".Tab--selected:focus": { boxShadow: `0 0 0 1px ${accent}` },
    },
  };
}

export function StripePaymentModal({
  plan, planLabel, priceLabel, interval, currency = "USD", onClose, onSuccess,
}: {
  plan: string; planLabel: string; priceLabel: string; interval: "month" | "year"; currency?: string;
  onClose: () => void; onSuccess: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "submitting" | "error">("loading");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeJs | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [_, setup] = await Promise.all([
          loadStripeJs(),
          apiClient.post<{ client_secret?: string; publishable_key?: string | null; error?: string; configured?: boolean }>("/billing/setup-intent", {}),
        ]);
        if (cancelled) return;
        if (setup.error || !setup.client_secret) { setError(setup.error ?? "Billing isn't connected yet."); setStatus("error"); return; }
        if (!setup.publishable_key) { setError("Stripe publishable key isn't configured on the server."); setStatus("error"); return; }
        const stripe = window.Stripe!(setup.publishable_key);
        stripeRef.current = stripe;
        const elements = stripe.elements({
          clientSecret: setup.client_secret,
          appearance: buildStripeAppearance(containerRef.current ?? document.body),
        });
        elementsRef.current = elements;
        const paymentElement = elements.create("payment");
        if (containerRef.current) paymentElement.mount(`#stripe-payment-element`);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : "Could not load the payment form."); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    const stripe = stripeRef.current, elements = elementsRef.current;
    if (!stripe || !elements) return;
    setStatus("submitting"); setError(null);
    try {
      // Confirm the SetupIntent — this is where the actual card details leave the browser and go
      // straight to Stripe (redirect:"if_required" keeps the user on our page for cards that don't
      // need a bank redirect, which is the overwhelming majority).
      const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
      if (result.error) { setError(result.error.message ?? "Card was declined."); setStatus("ready"); return; }
      const paymentMethodId = result.setupIntent?.payment_method;
      if (!paymentMethodId) { setError("Could not save the card — please try again."); setStatus("ready"); return; }

      const sub = await apiClient.post<{ ok?: boolean; requires_action?: boolean; pending?: boolean; message?: string; client_secret?: string; subscription_id?: string; error?: string }>(
        "/billing/subscribe",
        { plan, interval, currency, payment_method_id: paymentMethodId },
      );
      if (sub.error) { setError(sub.error); setStatus("ready"); return; }

      if (sub.requires_action && sub.client_secret) {
        // A minority of cards require 3D Secure — Stripe.js shows that one extra verification step.
        const confirm = await stripe.confirmCardPayment(sub.client_secret);
        if (confirm.error) { setError(confirm.error.message ?? "Payment could not be verified."); setStatus("ready"); return; }
        await apiClient.post("/billing/confirm-subscription", { subscription_id: sub.subscription_id });
      } else if (sub.pending) {
        // Async settlement (bank debit) — the plan is NOT active yet; it activates via webhook once
        // the payment clears. Show that honestly rather than a false "you're upgraded".
        setPending(sub.message ?? "Payment is processing — your plan activates automatically once it clears.");
        setStatus("ready");
        return;
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong completing your subscription.");
      setStatus("ready");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-sm border"
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border-soft)" }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Upgrade to {planLabel}</div>
            <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{priceLabel}</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
        </div>

        <div className="space-y-4 p-5">
          {status === "loading" && (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px]" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={16} className="animate-spin" /> Loading secure payment form…
            </div>
          )}
          {/* Stripe mounts its embedded card field into this div — our page, our styling, Stripe's
              secure iframe underneath. The element itself renders Stripe's own attribution mark.
              Kept in the DOM (not display:none) even while loading, so mount() can lay it out
              immediately once Stripe.js resolves. */}
          <div id="stripe-payment-element" ref={containerRef} />

          {error && <p className="text-[12.5px]" style={{ color: "#be123c" }}>{error}</p>}

          {pending && (
            <div className="rounded-sm border p-3 text-[12.5px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
              <div className="mb-1 font-semibold" style={{ color: "var(--text-primary)" }}>Payment processing</div>
              {pending}
              <button onClick={onClose} className="mt-3 w-full rounded-sm px-4 py-2 text-[12.5px] font-semibold text-black" style={{ background: "var(--accent)" }}>Done</button>
            </div>
          )}

          {!pending && status !== "loading" && status !== "error" && (
            <button
              onClick={handleSubmit}
              disabled={status === "submitting"}
              className="flex w-full items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-[13px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "var(--accent)" }}
            >
              {status === "submitting" ? <Loader2 size={14} className="animate-spin" /> : <Lock size={13} />}
              {status === "submitting" ? "Confirming…" : `Subscribe — ${priceLabel}`}
            </button>
          )}

          <p className="flex items-center justify-center gap-1.5 text-[10.5px]" style={{ color: "var(--text-faint)" }}>
            <Lock size={10} /> Payments secured and processed by Stripe. Mondaily never sees your card number.
          </p>
        </div>
      </div>
    </div>
  );
}
