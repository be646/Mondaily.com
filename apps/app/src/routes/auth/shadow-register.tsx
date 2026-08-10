import { useState, useMemo } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ShieldCheck, ArrowRight } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton } from "../../components/auth/auth-shell";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";
import { usePowShield, PowShieldLine } from "../../lib/pow-client";
import { useAuthTrace } from "../../lib/auth-trace";
import { AuthTracePanel } from "../../components/auth/auth-trace-panel";
import { GoogleAuthButton, AuthDivider } from "../../components/auth/google-auth-button";

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
}

function pwIssues(pw: string): string | null {
  if (pw.length < 8) return "At least 8 characters.";
  if (!/[a-zA-Z]/.test(pw)) return "Add at least one letter.";
  if (!/[0-9]/.test(pw)) return "Add at least one number.";
  return null;
}

/** /auth/register — native sign-up. Creates the account + a fresh workspace (owner). */
export function ShadowRegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  // Carry a plan chosen on the marketing pricing page (/sign-up?plan=operator) through to
  // onboarding — the /onboarding redirect drops query strings, so stash it now.
  const planParam = params.get("plan");
  if (planParam && ["scout", "operator", "command", "sovereign"].includes(planParam)) {
    localStorage.setItem("mondaily_preselect_plan", planParam);
  }
  const { register } = useSovereignAuth();
  const trace = useAuthTrace();
  // Real proof-of-work events — the attempt count and digest are what the solve actually cost.
  const powTrace = useMemo(() => ({
    challenge: (ch: string) => trace.emit("note", "challenge issued", `${ch.slice(0, 16)}…`),
    solving: () => trace.emit("run", "solving proof-of-work", "sha256 · 4 leading zeros"),
    solved: (r: { attempts: number; ms: number; digest: string }) =>
      trace.settle("ok", `nonce found after ${r.attempts.toLocaleString()} hashes`, `${r.digest.slice(0, 8)}… · ${r.ms}ms`),
    unavailable: () => trace.emit("note", "proof-of-work not required by this deployment"),
  }), [trace]);
  const shield = usePowShield(powTrace);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwError = password ? pwIssues(password) : null;
  const matchError = confirm && confirm !== password ? "Passwords don't match." : null;
  const valid = /\S+@\S+\.\S+/.test(email) && !pwIssues(password) && confirm === password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(null); setLoading(true);
    try {
      const pow = await shield.solve();
      trace.emit("run", "creating account", "POST /auth/register");
      const t0 = performance.now();
      await register(email.trim(), password, name.trim() || undefined, pow);
      const ms = Math.round(performance.now() - t0);
      trace.settle("ok", "account created", `${ms}ms`);
      // Each line is a real consequence of that one call: the server hashes with scrypt, bootstraps
      // a workspace, grants the free-tier allowance and mails a verification link. Named because
      // they happened, not to fill space.
      trace.emit("note", "password hashed · scrypt");
      trace.emit("note", "workspace bootstrapped · owner membership");
      trace.emit("note", "verification email queued");
      navigate(next);
    } catch (err) {
      trace.settle("fail", "registration rejected");
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell kicker="Sovereign auth" title="Create your account"
      subtitle="Native Mondaily credentials — your own independent workspace, no third parties."
      aside={<AuthTracePanel lines={trace.lines} />}
      footer={<button onClick={() => navigate("/auth/shadow-login")} className="inline-flex items-center gap-1.5 transition-colors hover:text-[var(--text-secondary)]">Already have an account? Sign in <ArrowRight size={12} /></button>}>
      <GoogleAuthButton next={next} mode="signup" onTrace={trace} />
      <AuthDivider />
      <form onSubmit={onSubmit} className="space-y-3.5">
        <CapsuleInput label="Name" autoComplete="name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} disabled={loading} />
        <CapsuleInput label="Email" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
        <CapsuleInput label="Password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} error={pwError ?? undefined} hint="8+ chars, with a letter and a number." />
        <CapsuleInput label="Confirm password" type="password" autoComplete="new-password" placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={loading} error={matchError ?? undefined} />
        <PowShieldLine status={shield.status} />
        {error && <p className="text-[11px] text-[#d1524a]">{error}</p>}
        <GlowButton type="submit" variant="secondary" disabled={!valid} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : <><ShieldCheck size={14} /> Create account</>}
        </GlowButton>
      </form>
    </AuthShell>
  );
}
