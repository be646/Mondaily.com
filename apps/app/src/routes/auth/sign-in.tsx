import { useSignIn } from "@clerk/react/legacy";
import { useAuth } from "@clerk/react";
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { Logo } from "../../components/logo";

// ── Live panel data ───────────────────────────────────────────────────────────

const LOG_LINES = [
  { tag: "SYNC",  col: "var(--accent)", msg: "workspace graph: 1,842 nodes ready" },
  { tag: "AI",    col: "var(--accent)", msg: "enrichment engine: online" },
  { tag: "GRAPH", col: "var(--accent)", msg: "opportunity flow: 24 active deals loaded" },
  { tag: "FIN",   col: "var(--accent)", msg: "finance: £214k in receivables synced" },
  { tag: "AUTO",  col: "var(--accent)", msg: "3 automation flows running" },
  { tag: "ALERT", col: "var(--accent)", msg: "2 deals require attention today" },
  { tag: "AI",    col: "var(--accent)", msg: "relationship scores recalculated" },
  { tag: "SYNC",  col: "var(--accent)", msg: "email graph: 12 new signals indexed" },
  { tag: "FIN",   col: "var(--accent)", msg: "invoice INV-0041 marked paid" },
  { tag: "GRAPH", col: "var(--accent)", msg: "Acme Corp: ARR enriched → £420k" },
];

const STATS = [
  { label: "Active deals",  value: "24",    sub: "+3 this week" },
  { label: "Records",       value: "1,842", sub: "enriched" },
  { label: "Automations",   value: "3",     sub: "running now" },
  { label: "Receivables",   value: "£214k", sub: "2 overdue" },
];

function nowStamp() {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function LivePanel() {
  const [lines, setLines] = useState<{ id: number; stamp: string; tag: string; msg: string }[]>([]);
  const idRef  = useRef(0);
  const poolRef = useRef(0);

  useEffect(() => {
    function addLine() {
      const item = LOG_LINES[poolRef.current % LOG_LINES.length]!;
      poolRef.current++;
      setLines(prev => [...prev.slice(-5), { id: idRef.current++, stamp: nowStamp(), tag: item.tag, msg: item.msg }]);
    }
    addLine();
    const iv = setInterval(addLine, 1600);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex h-full flex-col justify-between bg-stone-50 border-l border-black/[.06] px-10 py-12">

      {/* Header */}
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-stone-500">// live.workspace</p>
        <h2 className="font-sans text-xl font-semibold tracking-tight text-stone-900">Your workspace is ready.</h2>
        <p className="mt-1 font-mono text-[12px] text-stone-500">Everything synced. Waiting for you.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {STATS.map(s => (
          <div key={s.label} className="rounded-xl border border-black/[.07] bg-white p-4">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-stone-400">{s.label}</p>
            <p className="font-sans text-2xl font-semibold tracking-tight text-stone-900">{s.value}</p>
            <p className="mt-0.5 font-mono text-[10px] text-stone-500">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Log */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-stone-500 animate-pulse" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-stone-400">system log</span>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.id} className="flex items-start gap-2" style={{ opacity: 0.35 + (i / lines.length) * 0.65 }}>
              <span className="shrink-0 font-mono text-[10px] text-stone-400">{l.stamp}</span>
              <span className="shrink-0 w-10 font-mono text-[10px] font-semibold text-stone-500">{l.tag}</span>
              <span className="font-mono text-[11px] text-stone-500 leading-relaxed">{l.msg}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ── Sign-in form ──────────────────────────────────────────────────────────────

export function SignInPage() {
  // All hooks must be called unconditionally before any early returns
  const { isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();
  const navigate = useNavigate();
  const [stage, setStage]       = useState<"form" | "verify">("form");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode]         = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  useLayoutEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark");
    return () => {
      if (prev) document.documentElement.dataset.theme = prev;
    };
  }, []);

  if (isSignedIn) return <Navigate to="/home" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) { setError("Auth is loading, please wait a moment and try again."); return; }
    setLoading(true);
    setError("");
    try {
      const result = await signIn.create({ identifier: email, strategy: "password", password });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        window.location.replace("/home");
        return;
      } else if (result.status === "needs_client_trust") {
        // Clerk requires email verification on this new browser/device.
        // Must pass the emailAddressId from supportedFirstFactors.
        const emailFactor = result.supportedFirstFactors?.find(
          (f: { strategy: string }) => f.strategy === "email_code"
        ) as { strategy: "email_code"; emailAddressId: string } | undefined;
        if (!emailFactor?.emailAddressId) {
          setError("Email verification unavailable. Please use Google sign-in or contact support.");
        } else {
          await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: emailFactor.emailAddressId });
          setStage("verify");
        }
      } else if (result.status === "needs_second_factor") {
        setError("Two-factor authentication is required. Please use the Mondaily account portal to sign in.");
      } else if (result.status === "needs_new_password") {
        setError("Your password has expired. Please use the 'Forgot?' link to reset it.");
      } else {
        setError(`Sign in incomplete (status: ${result.status}). Please try again or contact support.`);
      }
    } catch (err: unknown) {
      const clerkErr = err as { errors?: { code?: string; message: string }[] };
      const first = clerkErr?.errors?.[0];
      if (first?.code === "session_exists" || first?.message?.toLowerCase().includes("session already exists")) {
        navigate("/home");
        return;
      }
      setError(first?.message ?? "Sign in failed. Please check your email and password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setLoading(true);
    setError("");
    try {
      const result = await signIn.attemptFirstFactor({ strategy: "email_code", code });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        window.location.replace("/home");
        return;
      } else {
        setError(`Verification incomplete (status: ${result.status}). Please try again.`);
      }
    } catch (err: unknown) {
      const first = (err as { errors?: { message: string }[] })?.errors?.[0];
      setError(first?.message ?? "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    if (!isLoaded || !signIn) { setError("Auth is loading, please try again."); return; }
    await signIn.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: "/sso-callback",
      redirectUrlComplete: "/home",
    });
  }

  const inputCls = "w-full rounded-xl border border-black/[.08] bg-white px-4 py-3 font-mono text-[13px] text-stone-900 placeholder-stone-400 outline-none focus:border-stone-500/40 transition-colors";

  return (
    <div className="grid min-h-screen" data-theme="light" style={{ gridTemplateColumns: "440px 1fr" }}>

      {/* Left — form */}
      <div className="flex flex-col justify-center bg-white px-10 py-12">
        <div className="w-full max-w-sm mx-auto">

          <div className="mb-10">
            <Logo size={40} />
          </div>

          {stage === "verify" ? (
            <>
              <h1 className="mb-1 font-sans text-2xl font-semibold tracking-tight text-stone-900">Check your email</h1>
              <p className="mb-2 font-mono text-[13px] text-stone-500">We sent a 6-digit code to</p>
              <p className="mb-8 font-mono text-[13px] font-medium text-stone-600">{email}</p>
              <form onSubmit={handleVerify} className="space-y-3">
                <div>
                  <p className="mb-1.5 font-mono text-[11px] text-stone-500">Verification code</p>
                  <input
                    type="text"
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    required
                    autoFocus
                    className={`${inputCls} text-center text-xl tracking-[0.5em]`}
                  />
                </div>
                {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 font-mono text-[12px] text-red-600">{error}</p>}
                <button type="submit" disabled={loading || code.length < 6} className="w-full rounded-xl bg-stone-600 py-3 font-mono text-[13px] font-medium text-[var(--text-primary)] hover:bg-stone-500 transition-all disabled:opacity-50">
                  {loading ? "Verifying…" : "Verify & sign in →"}
                </button>
              </form>
              <button onClick={() => { setStage("form"); setError(""); setCode(""); }} className="mt-4 w-full text-center font-mono text-[12px] text-stone-400 hover:text-stone-700 transition-colors">
                ← Back to sign in
              </button>
            </>
          ) : (
          <>
          <h1 className="mb-1 font-sans text-2xl font-semibold tracking-tight text-stone-900">Welcome back</h1>
          <p className="mb-8 font-mono text-[13px] text-stone-500">Sign in to your workspace</p>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="mb-4 flex w-full items-center justify-center gap-3 rounded-xl border border-black/[.08] bg-white py-3 font-mono text-[13px] text-stone-700 hover:bg-stone-50 transition-all disabled:opacity-50"
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
            <span className="font-mono text-[11px] text-stone-400">or</span>
            <div className="h-px flex-1 bg-black/[.06]" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <p className="mb-1.5 font-mono text-[11px] text-stone-500">Email</p>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required className={inputCls} />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="font-mono text-[11px] text-stone-500">Password</p>
                <a href="https://accounts.mondaily.com/sign-in/forgot-password" className="font-mono text-[11px] text-stone-600 hover:underline">Forgot?</a>
              </div>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required className={inputCls} />
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 font-mono text-[12px] text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-stone-600 py-3 font-mono text-[13px] font-medium text-[var(--text-primary)] hover:bg-stone-500 transition-all disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <p className="mt-6 text-center font-mono text-[12px] text-stone-400">
            No account?{" "}
            <Link to="/sign-up" className="text-stone-600 hover:underline">Start free</Link>
          </p>
          </>
          )}
        </div>
      </div>

      {/* Right — live panel */}
      <LivePanel />

    </div>
  );
}
