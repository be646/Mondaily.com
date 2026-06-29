import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck, ArrowLeft, Check } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton, SAGE } from "../../components/auth/auth-shell";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";

// Minimum security: ≥8 chars, at least one letter and one number.
function pwIssues(pw: string): string | null {
  if (pw.length < 8) return "At least 8 characters.";
  if (!/[a-zA-Z]/.test(pw)) return "Add at least one letter.";
  if (!/[0-9]/.test(pw)) return "Add at least one number.";
  return null;
}

/** /auth/shadow-activate — the "Sovereign Account Upgrade" for legacy Clerk users. */
export function ShadowActivatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activate } = useSovereignAuth();
  const prefill = (location.state as { email?: string } | null)?.email ?? "";

  const [email, setEmail] = useState(prefill);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pwError = password ? pwIssues(password) : null;
  const matchError = confirm && confirm !== password ? "Passwords don't match." : null;
  const valid = /\S+@\S+\.\S+/.test(email) && !pwIssues(password) && confirm === password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(null); setLoading(true);
    try {
      await activate(email.trim(), password);
      setDone(true);
      setTimeout(() => navigate("/home"), 900); // brief confirmation, then into the dashboard
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthShell kicker="Sovereign account" title="Account activated" subtitle="Your sovereign key is set — your history and permissions are fully intact.">
        <div className="flex items-center gap-2.5 rounded-xl border px-3.5 py-3" style={{ borderColor: `${SAGE}44`, background: `${SAGE}10` }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: `${SAGE}22` }}><Check size={15} style={{ color: SAGE }} /></span>
          <span className="truncate text-[12.5px] text-zinc-200">{email}</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Sovereign account upgrade" title="Set your password"
      subtitle="Mondaily has upgraded to our independent security network. Set a password to activate your sovereign key — your existing account, history, and access carry over unchanged."
      footer={<button onClick={() => navigate("/auth/shadow-login")} className="inline-flex items-center gap-1.5 transition-colors hover:text-zinc-300"><ArrowLeft size={12} /> Back to sign in</button>}>
      <form onSubmit={onSubmit} className="space-y-3.5">
        <CapsuleInput label="Email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} disabled={loading || !!prefill} hint={prefill ? "Recognized from your existing workspace." : undefined} />
        <CapsuleInput label="New password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} error={pwError ?? undefined} hint="8+ chars, with a letter and a number." />
        <CapsuleInput label="Confirm password" type="password" autoComplete="new-password" placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={loading} error={matchError ?? undefined} />
        {error && <p className="text-[11px] text-rose-400">{error}</p>}
        <GlowButton type="submit" disabled={!valid} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Activating…</> : <><ShieldCheck size={14} /> Activate sovereign key</>}
        </GlowButton>
      </form>
    </AuthShell>
  );
}
