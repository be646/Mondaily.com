import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton, SAGE } from "../../components/auth/auth-shell";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";
import { usePowShield, PowShieldLine } from "../../lib/pow-client";

// Where to land after auth — preserves an invite/deep-link target (?next=), defaults to /home.
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
}

/** /auth/shadow-login — native credentials login. A legacy account triggers an emailed
 *  activation link (email-ownership verified) rather than letting anyone set a password. */
export function ShadowLoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const { status, login, completeMfa, requestActivation } = useSovereignAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activationSent, setActivationSent] = useState(false);
  const shield = usePowShield();
  // Arm + solve the PoW HUD once on mount so the shield reads VALIDATED by the time the user submits.
  const armed = useRef(false);
  useEffect(() => {
    if (armed.current) return;
    armed.current = true;
    shield.solve().catch(() => {});
  }, [shield]);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length > 0 && shield.status === "validated";

  // Already signed in → straight to the target (or dashboard).
  if (status === "authenticated") return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(null); setLoading(true);
    try {
      const r = await login(email.trim(), password);
      if (r.requiresActivation) {
        await requestActivation(email.trim());
        setActivationSent(true);
      } else if (r.mfaToken) {
        setMfaToken(r.mfaToken);   // second step: authenticator code
      } else {
        navigate(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function onMfaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken || mfaCode.trim().length < 6 || loading) return;
    setError(null); setLoading(true);
    try { await completeMfa(mfaToken, mfaCode.trim()); navigate(next); }
    catch (err) { setError(err instanceof Error ? err.message : "That code didn't match."); }
    finally { setLoading(false); }
  }

  if (mfaToken) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6" style={{ background: "var(--surface-page)" }}>
        <form onSubmit={onMfaSubmit} className="w-full max-w-sm rounded-md border p-6" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
          <h1 className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>Two-factor code</h1>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>Enter the 6-digit code from your authenticator app — or one of your recovery codes.</p>
          <input value={mfaCode} onChange={e => setMfaCode(e.target.value)} autoFocus inputMode="numeric" placeholder="123 456"
            className="key-input mt-4 h-11 w-full px-3 text-center font-mono text-[18px] tracking-[0.3em]" />
          {error && <p className="mt-2 text-[12px]" style={{ color: "var(--status-error)" }}>{error}</p>}
          <button type="submit" disabled={mfaCode.trim().length < 6 || loading}
            className="btn-primary mt-4 h-10 w-full text-[13px] font-semibold">{loading ? "Checking…" : "Sign in"}</button>
          <button type="button" onClick={() => { setMfaToken(null); setMfaCode(""); setError(null); }}
            className="mt-3 w-full text-[12px]" style={{ color: "var(--text-muted)" }}>Back to password</button>
        </form>
      </div>
    );
  }

  if (activationSent) {
    return (
      <AuthShell kicker="Sovereign account upgrade" title="Check your email"
        subtitle="Mondaily upgraded to our own secure sign-in. We've emailed an activation link to set your password — it expires in 30 minutes.">
        <div className="flex items-center gap-2.5 rounded-sm border border-zinc-800 bg-zinc-950 px-3.5 py-3">
          <MailCheck size={16} style={{ color: SAGE }} />
          <span className="truncate text-[12.5px] text-zinc-200">{email}</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Sovereign auth" title="Sign in" subtitle="Native Mondaily credentials — no third parties."
      footer={<>New here? <span style={{ color: SAGE, cursor: "pointer" }} onClick={() => navigate(`/auth/register?next=${encodeURIComponent(next)}`)}>Create an account</span>.</>}>
      <form onSubmit={onSubmit} className="space-y-3.5">
        <CapsuleInput label="Email" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
        <CapsuleInput label="Password" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
        <PowShieldLine status={shield.status} />
        {error && <p className="text-[11px] text-[#d1524a]">{error}</p>}
        <GlowButton type="submit" disabled={!valid} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Verifying…</> : "Sign in"}
        </GlowButton>
        <button type="button" onClick={() => navigate("/auth/forgot")} className="w-full text-center text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">Forgot password?</button>
      </form>
    </AuthShell>
  );
}
