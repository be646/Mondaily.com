import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ShieldCheck, ArrowLeft, AlertTriangle } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton } from "../../components/auth/auth-shell";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";

function pwIssues(pw: string): string | null {
  if (pw.length < 8) return "At least 8 characters.";
  if (!/[a-zA-Z]/.test(pw)) return "Add at least one letter.";
  if (!/[0-9]/.test(pw)) return "Add at least one number.";
  return null;
}

/** /auth/reset?token=… — set a new password from the emailed reset link. */
export function ShadowResetPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { resetPassword } = useSovereignAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwError = password ? pwIssues(password) : null;
  const matchError = confirm && confirm !== password ? "Passwords don't match." : null;
  const valid = !pwIssues(password) && confirm === password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    setError(null); setLoading(true);
    try {
      await resetPassword(token, password);
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell kicker="Sovereign auth" title="Link required"
        subtitle="Open the reset link we emailed you, or request a new one from the sign-in page."
        footer={<button onClick={() => navigate("/auth/forgot")} className="inline-flex items-center gap-1.5 transition-colors hover:text-zinc-300"><ArrowLeft size={12} /> Request a reset link</button>}>
        <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3 text-[12.5px] text-zinc-400">
          <AlertTriangle size={16} className="text-amber-400" /> Missing reset token.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Sovereign auth" title="Choose a new password" subtitle="Set a new password to regain access to your account."
      footer={<button onClick={() => navigate("/auth/shadow-login")} className="inline-flex items-center gap-1.5 transition-colors hover:text-zinc-300"><ArrowLeft size={12} /> Back to sign in</button>}>
      <form onSubmit={onSubmit} className="space-y-3.5">
        <CapsuleInput label="New password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} disabled={loading} error={pwError ?? undefined} hint="8+ chars, with a letter and a number." />
        <CapsuleInput label="Confirm password" type="password" autoComplete="new-password" placeholder="••••••••" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={loading} error={matchError ?? undefined} />
        {error && <p className="text-[11px] text-rose-400">{error}</p>}
        <GlowButton type="submit" disabled={!valid} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Updating…</> : <><ShieldCheck size={14} /> Set new password</>}
        </GlowButton>
      </form>
    </AuthShell>
  );
}
