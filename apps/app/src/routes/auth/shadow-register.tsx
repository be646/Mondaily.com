import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ShieldCheck, ArrowRight } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton } from "../../components/auth/auth-shell";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";
import { usePowShield, PowShieldLine } from "../../lib/pow-client";

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
  const shield = usePowShield();
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
      await register(email.trim(), password, name.trim() || undefined, pow);
      navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell kicker="Sovereign auth" title="Create your account"
      subtitle="Native Mondaily credentials — your own independent workspace, no third parties."
      footer={<button onClick={() => navigate("/auth/shadow-login")} className="inline-flex items-center gap-1.5 transition-colors hover:text-zinc-300">Already have an account? Sign in <ArrowRight size={12} /></button>}>
      <form onSubmit={onSubmit} className="space-y-3.5">
        <CapsuleInput label="Name" autoComplete="name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} disabled={loading} />
        <CapsuleInput label="Email" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
        <CapsuleInput label="Password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} error={pwError ?? undefined} hint="8+ chars, with a letter and a number." />
        <CapsuleInput label="Confirm password" type="password" autoComplete="new-password" placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={loading} error={matchError ?? undefined} />
        <PowShieldLine status={shield.status} />
        {error && <p className="text-[11px] text-[#d1524a]">{error}</p>}
        <GlowButton type="submit" disabled={!valid} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : <><ShieldCheck size={14} /> Create account</>}
        </GlowButton>
      </form>
    </AuthShell>
  );
}
