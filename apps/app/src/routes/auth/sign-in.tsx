import { useSignIn } from "@clerk/react";
import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Logo } from "../../components/logo";

// ── Animated right panel ──────────────────────────────────────────────────────

const LOG_LINES = [
  { tag: "SYS",   col: "#6366f1", msg: "mondaily runtime v2.4.1 initialised" },
  { tag: "AUTH",  col: "#818cf8", msg: "loading identity providers..." },
  { tag: "SYNC",  col: "#34d399", msg: "workspace graph: 1,842 nodes ready" },
  { tag: "AI",    col: "#f59e0b", msg: "enrichment engine: online" },
  { tag: "CRM",   col: "#6366f1", msg: "pipeline: 24 active deals loaded" },
  { tag: "FIN",   col: "#34d399", msg: "finance: £214k in receivables synced" },
  { tag: "AUTO",  col: "#818cf8", msg: "3 automation flows running" },
  { tag: "ALERT", col: "#f59e0b", msg: "2 deals require attention today" },
  { tag: "AI",    col: "#6366f1", msg: "relationship scores recalculated" },
  { tag: "SYNC",  col: "#34d399", msg: "email graph: 12 new signals indexed" },
];

const STATS = [
  { label: "Active deals",   value: "24",     trend: "+3 this week" },
  { label: "Records",        value: "1,842",  trend: "enriched" },
  { label: "Automations",    value: "3",      trend: "running" },
  { label: "Receivables",    value: "£214k",  trend: "2 overdue" },
];

function nowStamp() {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function AnimatedPanel() {
  const [lines, setLines] = useState<{ id: number; stamp: string; tag: string; msg: string; col: string }[]>([]);
  const idRef = useRef(0);
  const poolRef = useRef(0);

  useEffect(() => {
    function addLine() {
      const item = LOG_LINES[poolRef.current % LOG_LINES.length]!;
      poolRef.current++;
      setLines(prev => [...prev.slice(-6), { id: idRef.current++, stamp: nowStamp(), ...item }]);
    }
    addLine();
    const iv = setInterval(addLine, 1400);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden bg-zinc-950 p-10 select-none">
      {/* Subtle grid */}
      <div className="pointer-events-none absolute inset-0" style={{
        backgroundImage: "linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      {/* Top glow */}
      <div className="pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl" />

      {/* Header */}
      <div className="relative">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-indigo-400">// live.workspace</div>
        <h2 className="font-sans text-xl font-semibold tracking-tight text-white">Your workspace is ready.</h2>
        <p className="mt-1 font-mono text-[12px] text-zinc-500">Everything synced. Waiting for you.</p>
      </div>

      {/* Stats grid */}
      <div className="relative grid grid-cols-2 gap-3">
        {STATS.map(s => (
          <div key={s.label} className="rounded-xl border border-white/[.06] bg-white/[.03] p-4">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">{s.label}</p>
            <p className="font-sans text-2xl font-semibold text-white">{s.value}</p>
            <p className="mt-0.5 font-mono text-[10px] text-indigo-400">{s.trend}</p>
          </div>
        ))}
      </div>

      {/* Terminal log */}
      <div className="relative">
        <div className="mb-2 flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" style={{ animation: "pulse 2s infinite" }} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">system log</span>
        </div>
        <div className="space-y-1.5">
          {lines.map((l, i) => (
            <div
              key={l.id}
              className="flex items-start gap-2 transition-opacity duration-500"
              style={{ opacity: 0.4 + (i / lines.length) * 0.6 }}
            >
              <span className="shrink-0 font-mono text-[10px] text-zinc-600">{l.stamp}</span>
              <span className="shrink-0 w-10 font-mono text-[10px] font-medium" style={{ color: l.col }}>{l.tag}</span>
              <span className="font-mono text-[11px] text-zinc-400 leading-relaxed">{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sign-in form ──────────────────────────────────────────────────────────────

export function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const navigate = useNavigate();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setLoading(true);
    setError("");
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        navigate("/home");
      }
    } catch (err: unknown) {
      const msg = (err as { errors?: { message: string }[] })?.errors?.[0]?.message;
      setError(msg ?? "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    if (!isLoaded) return;
    await signIn.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: "/sso-callback",
      redirectUrlComplete: "/home",
    });
  }

  const inputCls = "w-full rounded-xl border border-black/[.08] bg-white px-4 py-3 font-mono text-[13px] text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500/40 transition-colors";

  return (
    <div className="flex min-h-screen">
      {/* Left — form */}
      <div className="flex w-full flex-col justify-center px-8 py-12 lg:w-[480px] lg:shrink-0 bg-zinc-50">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10">
            <Logo size={40} />
          </div>

          <h1 className="mb-1 font-sans text-2xl font-semibold tracking-tight text-zinc-900">Welcome back</h1>
          <p className="mb-8 font-mono text-[13px] text-zinc-500">Sign in to your workspace</p>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={!isLoaded}
            className="mb-4 flex w-full items-center justify-center gap-3 rounded-xl border border-black/[.08] bg-white py-3 font-mono text-[13px] text-zinc-700 hover:bg-zinc-50 active:translate-y-[1px] transition-all disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
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

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <p className="mb-1.5 font-mono text-[11px] text-zinc-500">Email</p>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className={inputCls}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="font-mono text-[11px] text-zinc-500">Password</p>
                <a href="https://accounts.mondaily.com/sign-in/forgot-password" className="font-mono text-[11px] text-indigo-600 hover:underline">
                  Forgot?
                </a>
              </div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className={inputCls}
              />
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 font-mono text-[12px] text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !isLoaded}
              className="w-full rounded-xl bg-indigo-600 py-3 font-mono text-[13px] font-medium text-white hover:bg-indigo-500 active:translate-y-[1px] transition-all disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <p className="mt-6 text-center font-mono text-[12px] text-zinc-400">
            No account?{" "}
            <Link to="/sign-up" className="text-indigo-600 hover:underline">Start free</Link>
          </p>
        </div>
      </div>

      {/* Right — animated panel */}
      <div className="hidden lg:flex lg:flex-1">
        <AnimatedPanel />
      </div>
    </div>
  );
}
