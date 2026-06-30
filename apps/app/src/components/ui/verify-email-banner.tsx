import { MailWarning, X } from "lucide-react";
import { useState } from "react";
import { useSovereignAuthOptional } from "../auth/sovereign-auth-context";
import { apiClient } from "../../lib/api-client";

// Soft, dismissible nudge — shown only when the session reports email_verified === false.
// Never blocks the app (the user can keep working); they just can't ignore it forever.
export function VerifyEmailBanner() {
  const sov = useSovereignAuthOptional();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("verify_banner_dismissed") === "1");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const user = sov?.user;
  if (!user || user.emailVerified || dismissed) return null;

  async function resend() {
    setSending(true);
    try { await apiClient.post("/auth/resend-verification", {}); setSent(true); }
    catch { setSent(true); /* generic — don't leak state */ }
    finally { setSending(false); }
  }

  return (
    <div className="flex items-center gap-3 border-b px-4 py-2 text-[12.5px]"
      style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
      <MailWarning size={14} style={{ color: "var(--section-accent)" }} />
      <span className="min-w-0 flex-1 truncate">
        {sent ? "Verification email sent — check your inbox." : <>Verify your email (<span className="font-mono">{user.email}</span>) to secure your account.</>}
      </span>
      {!sent && (
        <button onClick={resend} disabled={sending}
          className="shrink-0 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[var(--section-accent)] disabled:opacity-60"
          style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }}>
          {sending ? "Sending…" : "Resend"}
        </button>
      )}
      <button onClick={() => { sessionStorage.setItem("verify_banner_dismissed", "1"); setDismissed(true); }}
        className="shrink-0 text-stone-500 hover:text-[var(--text-primary)]" title="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}
