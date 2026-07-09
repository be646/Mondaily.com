import { CheckCircle, MailX, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

// Public page hit from the verification email link (/auth/verify-email?token=...). Confirms the
// token server-side, then bounces to the dashboard. No session required.
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      if (!token) { setStatus("error"); return; }
      try {
        await apiClient.post("/auth/verify-email", { token });
        setStatus("success");
        window.setTimeout(() => navigate("/home"), 1400);
      } catch {
        setStatus("error");
      }
    })();
  }, [token, navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--surface-page)] px-6 text-center text-[var(--text-primary)]">
      <div className="w-full max-w-sm">
        {status === "loading" && <Loader2 className="mx-auto mb-5 animate-spin text-stone-500" size={32} />}
        {status === "success" && <CheckCircle className="mx-auto mb-5" size={34} style={{ color: "var(--section-accent)" }} />}
        {status === "error" && <MailX className="mx-auto mb-5 text-[#9c6b72]" size={34} />}
        <h1 className="text-xl font-semibold">
          {status === "loading" ? "Verifying your email…" : status === "success" ? "Email verified" : "Link invalid or expired"}
        </h1>
        <p className="mb-7 mt-2 text-sm text-stone-500">
          {status === "loading" ? "One moment." : status === "success" ? "Taking you to your workspace…" : "Request a fresh verification email from Settings, or just keep using Mondaily."}
        </p>
        {status === "error" && (
          <button onClick={() => navigate("/home")} className="rounded-sm border px-5 py-2 text-sm" style={{ borderColor: "var(--border-soft)" }}>
            Go to workspace
          </button>
        )}
      </div>
    </div>
  );
}
