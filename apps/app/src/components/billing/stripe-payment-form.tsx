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

export function StripePaymentModal({
  plan, planLabel, priceLabel, interval, onClose, onSuccess,
}: {
  plan: string; planLabel: string; priceLabel: string; interval: "month" | "year";
  onClose: () => void; onSuccess: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "submitting" | "error">("loading");
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
          appearance: {
            theme: "flat",
            variables: {
              colorPrimary: "#18181b",
              colorBackground: "transparent",
              colorText: "var(--text-primary)",
              fontFamily: "inherit",
              borderRadius: "6px",
            },
          },
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

      const sub = await apiClient.post<{ ok?: boolean; requires_action?: boolean; client_secret?: string; subscription_id?: string; error?: string }>(
        "/billing/subscribe",
        { plan, interval, payment_method_id: paymentMethodId },
      );
      if (sub.error) { setError(sub.error); setStatus("ready"); return; }

      if (sub.requires_action && sub.client_secret) {
        // A minority of cards require 3D Secure — Stripe.js shows that one extra verification step.
        const confirm = await stripe.confirmCardPayment(sub.client_secret);
        if (confirm.error) { setError(confirm.error.message ?? "Payment could not be verified."); setStatus("ready"); return; }
        await apiClient.post("/billing/confirm-subscription", { subscription_id: sub.subscription_id });
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
        className="w-full max-w-md rounded-sm border shadow-2xl"
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border-soft)" }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Upgrade to {planLabel}</div>
            <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{priceLabel}</div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-[var(--text-primary)]"><X size={16} /></button>
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

          {status !== "loading" && status !== "error" && (
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
