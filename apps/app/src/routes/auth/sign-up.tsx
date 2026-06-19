import { useSignUp } from "@clerk/react/legacy";
import { useAuth } from "@clerk/react";
import { useState, useLayoutEffect } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { Logo } from "../../components/logo";
import { SignUpPanel } from "../onboarding/onboarding-panels";

export function SignUpPage() {
  // All hooks must be called unconditionally before any early returns
  const { isSignedIn } = useAuth();
  const { isLoaded, signUp, setActive } = useSignUp();
  const navigate = useNavigate();
  const [stage,    setStage]    = useState<"form" | "verify" | "done">("form");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [code,     setCode]     = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  useLayoutEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark");
    return () => {
      if (prev) document.documentElement.dataset.theme = prev;
    };
  }, []);

  if (isSignedIn) return <Navigate to="/home" replace />;

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signUp) { setError("Auth is loading, please try again."); return; }
    setLoading(true);
    setError("");
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStage("verify");
    } catch (err: unknown) {
      const msg = (err as { errors?: { message: string }[] })?.errors?.[0]?.message;
      setError(msg ?? "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signUp) { setError("Auth is loading, please try again."); return; }
    setLoading(true);
    setError("");
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete") {
        setStage("done");
        await setActive({ session: result.createdSessionId });
        // Hard redirect so Clerk re-initialises from cookies before any route guard runs
        window.location.replace("/onboarding/profile");
        return;
      } else {
        setError(`Verification incomplete (status: ${result.status}). Please try again.`);
      }
    } catch (err: unknown) {
      const clerkErr = err as { errors?: { code?: string; message: string }[] };
      const first = clerkErr?.errors?.[0];
      if (first?.code === "session_exists" || first?.message?.toLowerCase().includes("session already exists")) {
        navigate("/home");
        return;
      }
      setError(first?.message ?? "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    if (!isLoaded || !signUp) { return; }
    await signUp.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: "/sso-callback",
      redirectUrlComplete: "/onboarding/profile",
    });
  }

  const inputCls = "w-full rounded-xl border border-black/[.08] bg-white px-4 py-3 font-mono text-[13px] text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500/40 transition-colors";

  return (
    <div className="grid min-h-screen" data-theme="light" style={{ gridTemplateColumns: "440px 1fr" }}>

      {/* Left — form */}
      <div className="flex flex-col justify-center bg-white px-10 py-12">
        <div className="mx-auto w-full max-w-sm">

          <div className="mb-10">
            <Logo size={40} />
          </div>

          {stage === "form" && (
            <>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-black/[.06] bg-zinc-50 px-3 py-1 font-mono text-xs text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Free to start · no credit card
              </div>
              <h1 className="mb-1 mt-3 font-sans text-2xl font-semibold tracking-tight text-zinc-900">Create your account</h1>
              <p className="mb-8 font-mono text-[13px] text-zinc-500">Your fully AI business OS</p>

              <button
                onClick={handleGoogle}
                disabled={loading}
                className="mb-4 flex w-full items-center justify-center gap-3 rounded-xl border border-black/[.08] bg-white py-3 font-mono text-[13px] text-zinc-700 hover:bg-zinc-50 active:translate-y-[1px] transition-all disabled:opacity-50"
              >
                <svg width="15" height="15" viewBox="0 0 48 48" fill="none">
                  <path d="M47.532 24.552c0-1.636-.132-3.2-.38-4.704H24.48v8.897h12.987c-.56 3.018-2.254 5.573-4.8 7.29v6.057h7.773c4.547-4.19 7.092-10.36 7.092-17.54z" fill="#4285F4"/>
                  <path d="M24.48 48c6.48 0 11.916-2.147 15.888-5.815l-7.773-6.057c-2.147 1.44-4.893 2.285-8.115 2.285-6.24 0-11.52-4.214-13.41-9.882H2.936v6.253C6.892 42.867 15.12 48 24.48 48z" fill="#34A853"/>
                  <path d="M11.07 28.53A14.576 14.576 0 0 1 10.3 24c0-1.576.272-3.107.77-4.53v-6.253H2.936A23.94 23.94 0 0 0 .48 24c0 3.867.927 7.52 2.456 10.783l8.134-6.253z" fill="#FBBC05"/>
                  <path d="M24.48 9.587c3.52 0 6.68 1.213 9.16 3.587l6.867-6.867C36.396 2.427 30.96 0 24.48 0 15.12 0 6.892 5.133 2.936 13.217l8.134 6.253C12.96 13.8 18.24 9.587 24.48 9.587z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="relative mb-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-black/[.06]" />
                <span className="font-mono text-[11px] text-zinc-400">or</span>
                <div className="h-px flex-1 bg-black/[.06]" />
              </div>

              <form onSubmit={handleSignUp} className="space-y-3">
                <div>
                  <p className="mb-1.5 font-mono text-[11px] text-zinc-500">Email</p>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required className={inputCls} />
                </div>
                <div>
                  <p className="mb-1.5 font-mono text-[11px] text-zinc-500">Password</p>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={8} className={inputCls} />
                  <p className="mt-1.5 font-mono text-[10px] text-zinc-400">Minimum 8 characters</p>
                </div>

                {error && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 font-mono text-[12px] text-red-600">{error}</p>
                )}

                <button type="submit" disabled={loading} className="w-full rounded-xl bg-indigo-600 py-3 font-mono text-[13px] font-medium text-white hover:bg-indigo-500 active:translate-y-[1px] transition-all disabled:opacity-50">
                  {loading ? "Creating account…" : "Create account →"}
                </button>
              </form>

              <p className="mt-4 text-center font-mono text-[11px] text-zinc-400">
                By signing up you agree to our{" "}
                <a href="https://mondaily.com/legal/terms" className="text-indigo-600 hover:underline">Terms</a>{" "}
                and{" "}
                <a href="https://mondaily.com/legal/privacy" className="text-indigo-600 hover:underline">Privacy Policy</a>.
              </p>

              <p className="mt-4 text-center font-mono text-[12px] text-zinc-400">
                Already have an account?{" "}
                <Link to="/sign-in" className="text-indigo-600 hover:underline">Sign in</Link>
              </p>
            </>
          )}

          {stage === "verify" && (
            <>
              <h1 className="mb-1 font-sans text-2xl font-semibold tracking-tight text-zinc-900">Check your email</h1>
              <p className="mb-2 font-mono text-[13px] text-zinc-500">We sent a 6-digit code to</p>
              <p className="mb-8 font-mono text-[13px] font-medium text-indigo-600">{email}</p>

              <form onSubmit={handleVerify} className="space-y-3">
                <div>
                  <p className="mb-1.5 font-mono text-[11px] text-zinc-500">Verification code</p>
                  <input
                    type="text"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    required
                    className={`${inputCls} text-center text-xl tracking-[0.5em]`}
                    autoFocus
                  />
                </div>

                {error && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 font-mono text-[12px] text-red-600">{error}</p>
                )}

                <button type="submit" disabled={loading || code.length < 6} className="w-full rounded-xl bg-indigo-600 py-3 font-mono text-[13px] font-medium text-white hover:bg-indigo-500 active:translate-y-[1px] transition-all disabled:opacity-50">
                  {loading ? "Verifying…" : "Verify & continue →"}
                </button>
              </form>

              <button onClick={() => { setStage("form"); setError(""); }} className="mt-4 w-full text-center font-mono text-[12px] text-zinc-400 hover:text-zinc-700 transition-colors">
                ← Use a different email
              </button>
            </>
          )}
        </div>
      </div>

      {/* Right — reactive panel */}
      <SignUpPanel email={email} stage={stage} />
    </div>
  );
}
