import { useAuth } from "@clerk/react";
import { CheckCircle, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

export function InviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      navigate(`/sign-in?redirect_url=/invite/${token}`, { replace: true });
    }
  }, [isLoaded, isSignedIn, token, navigate]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function acceptInvite() {
    setStatus("loading");
    try {
      const result = await apiClient.post<{ workspace_id: string }>("/invites/accept", { token });
      localStorage.setItem("mondaily_workspace_id", result.workspace_id);
      setStatus("success");
      window.setTimeout(() => navigate("/home"), 1200);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b0d10] px-6 text-center text-white">
      <div className="w-full max-w-sm">
        {status === "success" ? <CheckCircle className="mx-auto mb-5 text-emerald-500" size={34} /> : <Users className="mx-auto mb-5 text-red-500" size={34} />}
        <h1 className="text-xl font-semibold">{status === "success" ? "Joined!" : "You've been invited"}</h1>
        <p className="mb-7 mt-2 text-sm text-slate-500">{status === "success" ? "Taking you to the workspace..." : "Accept to join the Mondaily workspace."}</p>
        {status !== "success" ? (
          <div className="flex justify-center gap-3">
            <button onClick={acceptInvite} disabled={status === "loading"} className="rounded-md bg-red-600 px-5 py-2 text-sm font-medium disabled:opacity-50">{status === "loading" ? "Joining..." : "Accept invitation"}</button>
            <button onClick={() => navigate("/sign-in")} className="rounded-md border border-white/10 px-5 py-2 text-sm">Decline</button>
          </div>
        ) : null}
        {status === "error" ? <p className="mt-4 text-sm text-red-400">This invitation is invalid or expired.</p> : null}
      </div>
    </div>
  );
}
