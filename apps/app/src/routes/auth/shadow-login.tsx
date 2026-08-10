import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton, SAGE } from "../../components/auth/auth-shell";
import { GoogleAuthButton, AuthDivider, ssoErrorMessage } from "../../components/auth/google-auth-button";
import { AuthTracePanel } from "../../components/auth/auth-trace-panel";
import { MfaCard } from "../../components/auth/mfa-card";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";
import { usePowShield, PowShieldLine } from "../../lib/pow-client";
import { useAuthTrace } from "../../lib/auth-trace";

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
  const [loading, setLoading] = useState(false);
  // A failed Google round trip comes back as ?sso=<reason>; show it as the form's own error rather
  // than letting the user return to an apparently blank page that silently did nothing.
  const [error, setError] = useState<string | null>(ssoErrorMessage(params.get("sso")));
  const [activationSent, setActivationSent] = useState(false);
  const trace = useAuthTrace();

  /**
   * Real proof-of-work events. The attempt count and digest are what the solve genuinely cost, so
   * they differ every time — which is precisely why they are worth showing.
   */
  const powTrace = useMemo(() => ({
    challenge: (c: string) => trace.emit("note", "challenge issued", `${c.slice(0, 16)}…`),
    solving: () => trace.emit("run", "solving proof-of-work", "sha256 · 4 leading zeros"),
    solved: (r: { attempts: number; ms: number; digest: string }) =>
      trace.settle("ok", `nonce found after ${r.attempts.toLocaleString()} hashes`, `${r.digest.slice(0, 8)}… · ${r.ms}ms`),
    unavailable: () => trace.emit("note", "proof-of-work not required by this deployment"),
  }), [trace]);

  const shield = usePowShield(powTrace);
  // Arm + solve the PoW HUD once on mount so the shield reads VALIDATED by the time the user submits.
  const armed = useRef(false);
  useEffect(() => {
    if (armed.current) return;
    armed.current = true;
    trace.emit("note", "arming anti-bot shield");
    shield.solve().catch(() => trace.emit("fail", "shield could not arm"));
    // `shield.solve` is stable and `trace` is only used to emit; re-running would re-solve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length > 0 && shield.status === "validated";

  // Already signed in → straight to the target (or dashboard).
  if (status === "authenticated") return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(null); setLoading(true);
    trace.emit("run", "signing in", "POST /auth/login");
    const t0 = performance.now();
    try {
      const r = await login(email.trim(), password);
      const ms = Math.round(performance.now() - t0);
      if (r.requiresActivation) {
        trace.settle("warn", "legacy account — password not set", `${ms}ms`);
        trace.emit("run", "sending activation link");
        await requestActivation(email.trim());
        trace.settle("ok", "activation link sent");
        setActivationSent(true);
      } else if (r.mfaToken) {
        // Deliberately vague about WHY a second factor is needed; the fact that one is required is
        // already visible on screen, and detail here would describe the account to a stranger.
        trace.settle("ok", "credentials verified — second factor required", `${ms}ms`);
        setMfaToken(r.mfaToken);
      } else {
        trace.settle("ok", "session established", `${ms}ms`);
        trace.emit("note", "httpOnly cookie set · no token in JS");
        navigate(next);
      }
    } catch (err) {
      // One generic failure line. A console that distinguished "no such user" from "wrong password"
      // would be a very elegant account-enumeration oracle.
      trace.settle("fail", "sign-in rejected", `${Math.round(performance.now() - t0)}ms`);
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  if (mfaToken) {
    return (
      <MfaCard
        onSubmit={async (code, trustDevice) => { await completeMfa(mfaToken, code, trustDevice); navigate(next); }}
        onBack={() => { setMfaToken(null); setError(null); }}
      />
    );
  }

  if (activationSent) {
    return (
      <AuthShell kicker="Sovereign account upgrade" title="Check your email"
        subtitle="Mondaily upgraded to our own secure sign-in. We've emailed an activation link to set your password — it expires in 30 minutes.">
        <div className="flex items-center gap-2.5 rounded-sm border border-[var(--border-soft)] bg-zinc-950 px-3.5 py-3">
          <MailCheck size={16} style={{ color: SAGE }} />
          <span className="truncate text-[12.5px] text-[var(--text-primary)]">{email}</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Sovereign auth" title="Sign in" subtitle="Native Mondaily credentials — no third parties."
      aside={<AuthTracePanel lines={trace.lines} />}
      footer={<>New here? <span style={{ color: SAGE, cursor: "pointer" }} onClick={() => navigate(`/auth/register?next=${encodeURIComponent(next)}`)}>Create an account</span>.</>}>
      <GoogleAuthButton next={next} mode="signin" onTrace={trace} />
      <AuthDivider />
      <form onSubmit={onSubmit} className="space-y-3.5">
        <CapsuleInput label="Email" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
        <CapsuleInput label="Password" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
        <PowShieldLine status={shield.status} />
        {error && <p className="text-[11px] text-[#d1524a]">{error}</p>}
        <GlowButton type="submit" variant="secondary" disabled={!valid} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Verifying…</> : "Sign in"}
        </GlowButton>
        <button type="button" onClick={() => navigate("/auth/forgot")} className="w-full text-center text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]">Forgot password?</button>
      </form>
    </AuthShell>
  );
}
