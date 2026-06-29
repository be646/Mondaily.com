import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MailCheck, ArrowLeft } from "lucide-react";
import { AuthShell, CapsuleInput, GlowButton, SAGE } from "../../components/auth/auth-shell";
import { useSovereignAuth } from "../../components/auth/sovereign-auth-context";

/** /auth/forgot — request a password-reset link. */
export function ShadowForgotPage() {
  const navigate = useNavigate();
  const { requestPasswordReset } = useSovereignAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/\S+@\S+\.\S+/.test(email) || loading) return;
    setLoading(true);
    try { await requestPasswordReset(email.trim()); } finally { setLoading(false); setSent(true); }
  }

  if (sent) {
    return (
      <AuthShell kicker="Sovereign auth" title="Check your email"
        subtitle="If an account exists for that address, we've sent a password-reset link. It expires in 30 minutes.">
        <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3">
          <MailCheck size={16} style={{ color: SAGE }} />
          <span className="truncate text-[12.5px] text-zinc-200">{email}</span>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Sovereign auth" title="Reset your password" subtitle="Enter your email and we'll send a secure reset link."
      footer={<button onClick={() => navigate("/auth/shadow-login")} className="inline-flex items-center gap-1.5 transition-colors hover:text-zinc-300"><ArrowLeft size={12} /> Back to sign in</button>}>
      <form onSubmit={onSubmit} className="space-y-3.5">
        <CapsuleInput label="Email" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
        <GlowButton type="submit" disabled={!/\S+@\S+\.\S+/.test(email)} loading={loading}>
          {loading ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : "Send reset link"}
        </GlowButton>
      </form>
    </AuthShell>
  );
}
