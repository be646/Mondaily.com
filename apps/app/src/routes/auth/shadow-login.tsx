import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton, SAGE } from "../../components/auth/auth-shell";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";

/** /auth/shadow-login — native credentials login. A legacy account triggers an emailed
 *  activation link (email-ownership verified) rather than letting anyone set a password. */
export function ShadowLoginPage() {
  const navigate = useNavigate();
  const { status, login, requestActivation } = useSovereignAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activationSent, setActivationSent] = useState(false);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length > 0;

  // Already signed in → straight to the dashboard.
  if (status === "authenticated") return <Navigate to="/home" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(null); setLoading(true);
    try {
      const r = await login(email.trim(), password);
      if (r.requiresActivation) {
        await requestActivation(email.trim());
        setActivationSent(true);
      } else {
        navigate("/home");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  if (activationSent) {
    return (
      <AuthShell kicker="Sovereign account upgrade" title="Check your email"
        subtitle="Mondaily upgraded to our own secure sign-in. We've emailed an activation link to set your password — it expires in 30 minutes.">
        <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3">
          <MailCheck size={16} style={{ color: SAGE }} />
          <span className="truncate text-[12.5px] text-zinc-200">{email}</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Sovereign auth" title="Sign in" subtitle="Native Mondaily credentials — no third parties."
      footer={<>New here? <span style={{ color: SAGE, cursor: "pointer" }} onClick={() => navigate("/auth/register")}>Create an account</span>.</>}>
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
