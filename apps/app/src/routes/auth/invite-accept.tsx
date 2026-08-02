import { useCurrentUser } from "../../hooks/useCurrentUser";
import { CheckCircle, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

export function InviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useCurrentUser();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // Preserve the invite target so login/register/activation lands back here.
      navigate(`/auth/shadow-login?next=${encodeURIComponent(`/invite/${token}`)}`, { replace: true });
    }
  }, [isLoaded, isSignedIn, token, navigate]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("This invitation is invalid or expired.");
  const [mismatch, setMismatch] = useState(false);

  async function acceptInvite() {
    setStatus("loading"); setMismatch(false);
    try {
      const result = await apiClient.post<{ workspace_id: string }>("/invites/accept", { token });
      localStorage.setItem("mondaily_workspace_id", result.workspace_id);
      setStatus("success");
      window.setTimeout(() => navigate("/home"), 1200);
    } catch (e) {
      // Surface the real reason — especially "this invite was sent to X, you're signed in as Y".
      let msg = e instanceof Error ? e.message : "";
      let isMismatch = false;
      try { const p = JSON.parse(msg) as { error?: string; email_mismatch?: boolean }; msg = p.error ?? msg; isMismatch = !!p.email_mismatch; } catch { /* raw */ }
      setErrorMsg(msg || "This invitation is invalid or expired.");
      setMismatch(isMismatch);
      setStatus("error");
    }
  }

  function switchAccount() {
    // Sign out and return to login, preserving the invite target so they land back here as the
    // correct (invited) user.
    localStorage.removeItem("mondaily_workspace_id");
    navigate(`/auth/shadow-login?next=${encodeURIComponent(`/invite/${token}`)}`, { replace: true });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--surface-page)] px-6 text-center text-[var(--text-primary)]">
      <div className="w-full max-w-sm">
        {status === "success" ? <CheckCircle className="mx-auto mb-5 text-[#2f9e6b]" size={34} /> : <Users className="mx-auto mb-5 text-[#d1524a]" size={34} />}
        <h1 className="text-xl font-semibold">{status === "success" ? "Joined!" : "You've been invited"}</h1>
        <p className="mb-7 mt-2 text-sm text-[var(--text-muted)]">{status === "success" ? "Taking you to the workspace..." : "Accept to join the Mondaily workspace."}</p>
        {status !== "success" ? (
          <div className="flex justify-center gap-3">
            <button onClick={acceptInvite} disabled={status === "loading"} className="rounded-md bg-[#d1524a] px-5 py-2 text-sm font-medium disabled:opacity-50">{status === "loading" ? "Joining..." : "Accept invitation"}</button>
            <button onClick={() => navigate("/auth/shadow-login")} className="rounded-md border border-[var(--border-soft)] px-5 py-2 text-sm">Decline</button>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="mt-4">
            <p className="text-sm text-[#d1524a]">{errorMsg}</p>
            {mismatch && (
              <button onClick={switchAccount} className="mt-3 rounded-md bg-[#d1524a] px-5 py-2 text-sm font-medium">
                Sign in as the invited address
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
