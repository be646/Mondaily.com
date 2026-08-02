import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { AuthShell, GlowButton, SAGE } from "./auth-shell";

/**
 * The second-factor step, styled as the same dark "sign-in ticket" (AuthShell) as the rest of
 * sovereign auth. Used by shadow-login AND shadow-reset (a password reset with 2FA enrolled
 * still requires the second factor — an email link only proves email possession).
 *
 * "Trust this device" is REAL: it sends trust_device to /2fa/login, which sets a signed 30-day
 * HttpOnly cookie bound to this user + their current enrollment. Re-enrolling 2FA revokes every
 * trusted device at once.
 */
export function MfaCard({ onSubmit, onBack, backLabel, trustOffered = true }: {
  onSubmit: (code: string, trustDevice: boolean) => Promise<void>;
  onBack?: () => void;
  backLabel?: string;
  trustOffered?: boolean;
}) {
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleaned = code.trim();
  const valid = cleaned.length >= 6;   // 6-digit TOTP or a word recovery code

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(null); setLoading(true);
    try { await onSubmit(cleaned, trust); }
    catch (err) { setError(err instanceof Error ? err.message : "That code didn't match."); }
    finally { setLoading(false); }
  }

  return (
    <AuthShell kicker="Second factor" title="Two-factor code"
      subtitle="Enter the 6-digit code from your authenticator app — or one of your recovery codes if you've lost it."
      footer={onBack ? <button onClick={onBack} className="transition-colors hover:text-zinc-300">{backLabel ?? "Back to password"}</button> : undefined}>
      <form onSubmit={submit} className="space-y-4">
        <input value={code} onChange={e => setCode(e.target.value)} autoFocus inputMode="text" autoComplete="one-time-code"
          placeholder="123 456" aria-label="Two-factor code"
          className="w-full rounded-sm border border-[var(--border-soft)] bg-zinc-950 px-3.5 py-3 text-center font-mono text-[17px] tracking-[0.25em] text-zinc-100 outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[#8fcf7f]" />
        {trustOffered && (
          <label className="flex cursor-pointer items-center gap-2.5 text-[11.5px] text-zinc-400">
            <button type="button" role="checkbox" aria-checked={trust} onClick={() => setTrust(t => !t)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors"
              style={{ borderColor: trust ? SAGE : "#3f3f46", background: trust ? `${SAGE}22` : "transparent" }}>
              {trust && <ShieldCheck size={11} style={{ color: SAGE }} />}
            </button>
            Trust this device for 30 days
          </label>
        )}
        {error && <p className="text-[11px] text-[#d1524a]">{error}</p>}
        <GlowButton type="submit" disabled={!valid} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Checking…</> : "Sign in"}
        </GlowButton>
      </form>
    </AuthShell>
  );
}
