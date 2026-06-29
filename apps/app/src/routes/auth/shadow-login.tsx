import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck, LogOut } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton, SAGE } from "../../components/auth/auth-shell";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";

/** /auth/shadow-login — native credentials login. On a legacy account it soft-routes to activate. */
export function ShadowLoginPage() {
  const navigate = useNavigate();
  const { status, user, login, logout } = useSovereignAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(null); setLoading(true);
    try {
      const r = await login(email.trim(), password);
      if (r.requiresActivation) {
        navigate("/auth/shadow-activate", { state: { email: email.trim() } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  // Already authenticated (shadow session) — confirm + offer logout. No cutover/redirect yet.
  if (status === "authenticated" && user) {
    return (
      <AuthShell kicker="Sovereign session" title="Session active" subtitle="Your native Mondaily credentials are verified. (Shadow mode — the main app still runs on Clerk until cutover.)">
        <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3">
          <ShieldCheck size={16} style={{ color: SAGE }} />
          <span className="truncate text-[12.5px] text-zinc-200">{user.email}</span>
        </div>
        <button onClick={() => logout()} className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-800 px-4 py-2.5 text-[12px] text-zinc-400 transition-colors hover:text-zinc-200">
          <LogOut size={13} /> Sign out
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Sovereign auth" title="Sign in" subtitle="Native Mondaily credentials — no third parties."
      footer={<>Provisioning a new workspace? <span style={{ color: SAGE }}>Contact your admin</span>.</>}>
      <form onSubmit={onSubmit} className="space-y-3.5">
        <CapsuleInput label="Email" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
        <CapsuleInput label="Password" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} />
        {error && <p className="text-[11px] text-rose-400">{error}</p>}
        <GlowButton type="submit" disabled={!valid} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Verifying…</> : "Sign in"}
        </GlowButton>
      </form>
    </AuthShell>
  );
}
