import { useEffect, useState, useRef } from "react";
import { Check, Users, FileSpreadsheet, Zap, Mail, Building2, TrendingUp, LayoutDashboard } from "lucide-react";

// ── Fade-in wrapper ───────────────────────────────────────────────────────────

function FadeIn({ show, delay = 0, children }: { show: boolean; delay?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(8px)",
        transition: `opacity 0.4s ease ${delay}ms, transform 0.4s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ── Panel shell ───────────────────────────────────────────────────────────────

function PanelShell({ tag, title, children }: { tag: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col border-l border-black/[.06] bg-stone-50 px-10 py-10 overflow-y-auto">
      <div className="mb-8">
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-indigo-500">{tag}</p>
        <h2 className="font-sans text-xl font-semibold tracking-tight text-stone-900">{title}</h2>
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </div>
  );
}

// ── Animated counter ──────────────────────────────────────────────────────────

function Counter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    const step = Math.ceil(target / 30);
    const iv = setInterval(() => setVal(v => { const n = v + step; if (n >= target) { clearInterval(iv); return target; } return n; }), 40);
    return () => clearInterval(iv);
  }, [target]);
  return <>{val}{suffix}</>;
}

// ── Sign-up panel ─────────────────────────────────────────────────────────────

export function SignUpPanel({ email, stage }: { email: string; stage: "form" | "verify" | "done" }) {
  const hasEmail = email.includes("@");
  const isVerifying = stage === "verify";
  const isDone = stage === "done";

  return (
    <PanelShell tag="// account.create" title="Watch your account take shape.">

      {/* Profile card */}
      <div className="rounded-2xl border border-black/[.07] bg-white p-5">
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-sans text-lg font-semibold transition-all duration-300"
            style={{ background: hasEmail ? "#6366f1" : "#f4f4f5", color: hasEmail ? "white" : "#d4d4d8" }}
          >
            {hasEmail ? email.charAt(0).toUpperCase() : "?"}
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[13px] font-medium text-stone-800 truncate transition-all duration-300">
              {email || "your@email.com"}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${hasEmail ? "bg-emerald-500" : "bg-stone-300"}`} />
              <span className="font-mono text-[10px] text-stone-400">{hasEmail ? "identity registered" : "waiting for email"}</span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {[
            { label: "Identity", done: hasEmail },
            { label: "Credentials", done: isVerifying || isDone },
            { label: "Email verified", done: isDone },
            { label: "Workspace ready", done: isDone },
          ].map(({ label, done }) => (
            <div key={label} className="flex items-center gap-2.5">
              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-400 ${done ? "border-indigo-500 bg-indigo-500" : "border-stone-200 bg-white"}`}>
                {done && <Check size={9} className="text-white" strokeWidth={3} />}
              </div>
              <span className={`font-mono text-[11px] transition-colors duration-300 ${done ? "text-stone-700" : "text-stone-300"}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Mini dashboard preview */}
      <FadeIn show={hasEmail} delay={100}>
        <div className="rounded-2xl border border-black/[.07] bg-white overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-black/[.05] bg-stone-50 px-4 py-2.5">
            <div className="h-2 w-2 rounded-full bg-stone-200" />
            <div className="h-2 w-2 rounded-full bg-stone-200" />
            <div className="h-2 w-2 rounded-full bg-stone-200" />
            <span className="ml-2 font-mono text-[10px] text-stone-400">app.mondaily.com</span>
          </div>
          <div className="flex h-24 items-center justify-center">
            {isDone ? (
              <div className="flex items-center gap-2 text-indigo-500">
                <Zap size={14} />
                <span className="font-mono text-[12px]">Workspace launching…</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-stone-300">
                <LayoutDashboard size={14} />
                <span className="font-mono text-[11px]">Workspace slot reserved</span>
              </div>
            )}
          </div>
        </div>
      </FadeIn>

      {/* Features */}
      <FadeIn show={hasEmail} delay={200}>
        <div className="rounded-2xl border border-black/[.07] bg-white p-5">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-stone-400">What you unlock</p>
          <div className="space-y-2">
            {["Workspace graph · contacts, companies, deals", "Finance · invoices & expenses", "AI enrichment · auto-updated records", "Automations · no-code workflows"].map((f, i) => (
              <FadeIn key={f} show={hasEmail} delay={300 + i * 80}>
                <div className="flex items-center gap-2">
                  <Check size={10} className="shrink-0 text-indigo-500" />
                  <span className="font-mono text-[12px] text-stone-600">{f}</span>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </FadeIn>
    </PanelShell>
  );
}

// ── Profile panel ─────────────────────────────────────────────────────────────

export function ProfilePanel({ name, title }: { name: string; title: string }) {
  const hasName = name.trim().length > 0;
  const hasTitle = title.trim().length > 0;
  const initial = hasName ? name.trim().charAt(0).toUpperCase() : "?";

  return (
    <PanelShell tag="// profile.building" title="Watch your profile come alive.">

      {/* Live profile card */}
      <div className="rounded-2xl border border-black/[.07] bg-white p-6">
        <div className="flex items-center gap-4 mb-5">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-sans text-2xl font-bold transition-all duration-500"
            style={{ background: hasName ? "#6366f1" : "#f4f4f5", color: hasName ? "white" : "#d4d4d8" }}
          >
            {initial}
          </div>
          <div className="min-w-0">
            <p
              className="font-sans text-lg font-semibold tracking-tight transition-all duration-300"
              style={{ color: hasName ? "#18181b" : "#d4d4d8" }}
            >
              {hasName ? name : "Your name"}
            </p>
            <p
              className="font-mono text-[12px] transition-all duration-300"
              style={{ color: hasTitle ? "#6366f1" : "#d4d4d8" }}
            >
              {hasTitle ? title : "Job title"}
            </p>
          </div>
        </div>

        <div className="h-px bg-black/[.05] mb-4" />

        {/* Stat row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Role", value: "Admin", show: hasName },
            { label: "Access", value: "Full", show: hasName },
            { label: "Status", value: "Active", show: hasTitle },
          ].map(({ label, value, show }) => (
            <div key={label} className="rounded-lg border border-black/[.05] p-2.5 text-center">
              <p className="font-mono text-[10px] text-stone-400 mb-0.5">{label}</p>
              <p className={`font-mono text-[12px] font-semibold transition-colors duration-300 ${show ? "text-indigo-600" : "text-stone-200"}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Role badge */}
      <FadeIn show={hasName} delay={100}>
        <div className="rounded-2xl border border-black/[.07] bg-white p-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-indigo-500/20 bg-indigo-500/[.04] px-4 py-3">
            <Zap size={13} className="text-indigo-500 shrink-0" />
            <div>
              <p className="font-mono text-[12px] font-semibold text-indigo-700">Workspace Admin</p>
              <p className="font-mono text-[10px] text-stone-400">Full access · can invite teammates</p>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Checklist */}
      <FadeIn show={hasName}>
        <div className="rounded-2xl border border-black/[.07] bg-white p-5">
          <div className="space-y-2.5">
            {[
              { label: "Display name set", done: hasName },
              { label: "Job title configured", done: hasTitle },
              { label: "Profile complete", done: hasName && hasTitle },
            ].map(({ label, done }) => (
              <div key={label} className="flex items-center gap-2.5">
                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-400 ${done ? "border-indigo-500 bg-indigo-500" : "border-stone-200"}`}>
                  {done && <Check size={9} className="text-white" strokeWidth={3} />}
                </div>
                <span className={`font-mono text-[11px] transition-colors duration-300 ${done ? "text-stone-700" : "text-stone-300"}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </FadeIn>
    </PanelShell>
  );
}

// ── Workspace panel ───────────────────────────────────────────────────────────

export function WorkspacePanel({ name, size, industry }: { name: string; size: string; industry: string }) {
  const hasName = name.trim().length > 0;
  const [recordCount, setRecordCount] = useState(0);

  useEffect(() => {
    if (!hasName) { setRecordCount(0); return; }
    const iv = setInterval(() => setRecordCount(v => v < 1842 ? Math.min(v + 61, 1842) : 1842), 40);
    return () => clearInterval(iv);
  }, [hasName]);

  const NAV_ITEMS = [
    { icon: LayoutDashboard, label: "Home" },
    { icon: Users, label: "Records" },
    { icon: TrendingUp, label: "Pipeline" },
    { icon: Building2, label: "Finance" },
  ];

  const PIPELINE_DEALS = ["Acme Corp · £420k", "Globex Inc · £180k", "Initech · £95k"];

  return (
    <PanelShell tag="// workspace.create" title="Your workspace is assembling.">

      {/* Browser frame with live sidebar */}
      <div className="rounded-2xl border border-black/[.07] bg-white overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-black/[.05] bg-stone-50 px-4 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-stone-200" />
            <div className="h-2.5 w-2.5 rounded-full bg-stone-200" />
            <div className="h-2.5 w-2.5 rounded-full bg-stone-200" />
          </div>
          <div className="mx-auto flex items-center gap-1.5 rounded border border-black/[.06] bg-white px-3 py-1">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="font-mono text-[10px] text-stone-400">app.mondaily.com</span>
          </div>
        </div>

        <div className="flex h-52">
          {/* Sidebar */}
          <div className="w-32 border-r border-black/[.05] flex flex-col">
            <div className="px-3 py-3 border-b border-black/[.05]">
              <p
                className="font-mono text-[11px] font-bold truncate transition-all duration-300"
                style={{ color: hasName ? "#6366f1" : "#d4d4d8" }}
              >
                {hasName ? name : "Workspace"}
              </p>
            </div>
            <div className="flex-1 py-2">
              {NAV_ITEMS.map(({ icon: Icon, label }, i) => (
                <FadeIn key={label} show={hasName} delay={i * 80}>
                  <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-stone-50 cursor-default">
                    <Icon size={11} className="text-stone-400 shrink-0" />
                    <span className="font-mono text-[10px] text-stone-500">{label}</span>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 p-4 overflow-hidden">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-stone-400">Pipeline</span>
              <FadeIn show={hasName}>
                <span className="font-mono text-[10px] text-indigo-500">
                  <Counter target={recordCount} /> records
                </span>
              </FadeIn>
            </div>
            <div className="space-y-2">
              {PIPELINE_DEALS.map((deal, i) => (
                <FadeIn key={deal} show={hasName} delay={200 + i * 120}>
                  <div className="flex items-center gap-2 rounded-lg border border-black/[.05] bg-stone-50 px-3 py-2">
                    <div className="h-3 w-3 rounded bg-indigo-500/20 shrink-0" />
                    <span className="font-mono text-[10px] text-stone-600 truncate">{deal}</span>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Status checklist */}
      <div className="rounded-2xl border border-black/[.07] bg-white p-5">
        <div className="space-y-2.5">
          {[
            { label: `Workspace name${hasName ? ` "${name}"` : ""}`, done: hasName },
            { label: size ? `Team: ${size} people` : "Team size", done: !!size },
            { label: industry || "Industry", done: !!industry },
            { label: "Workspace graph activated", done: hasName },
          ].map(({ label, done }) => (
            <div key={label} className="flex items-center gap-2.5">
              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-400 ${done ? "border-indigo-500 bg-indigo-500" : "border-stone-200"}`}>
                {done && <Check size={9} className="text-white" strokeWidth={3} />}
              </div>
              <span className={`font-mono text-[11px] transition-colors duration-300 ${done ? "text-stone-700" : "text-stone-300"}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

// ── Connect email panel ───────────────────────────────────────────────────────

export function ConnectEmailPanel({ connected }: { connected: string[] }) {
  const PROVIDERS = [
    { id: "gmail", label: "Gmail", color: "#EA4335" },
    { id: "outlook", label: "Outlook", color: "#0078D4" },
  ];
  const anyConnected = connected.length > 0;

  return (
    <PanelShell tag="// email.graph" title="Building your relationship graph.">

      {/* Provider cards */}
      <div className="rounded-2xl border border-black/[.07] bg-white p-5 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-4">Connect your inbox</p>
        {PROVIDERS.map(({ id, label, color }) => {
          const isConnected = connected.includes(id);
          return (
            <div
              key={id}
              className="flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-400"
              style={{
                borderColor: isConnected ? `${color}30` : "rgba(0,0,0,0.06)",
                background: isConnected ? `${color}08` : "white",
              }}
            >
              <Mail size={14} style={{ color: isConnected ? color : "#d4d4d8" }} className="transition-colors duration-300 shrink-0" />
              <span className="flex-1 font-mono text-[12px] text-stone-700">{label}</span>
              {isConnected && (
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-mono text-[10px] text-emerald-600">Connected</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Graph preview */}
      <FadeIn show={anyConnected} delay={100}>
        <div className="rounded-2xl border border-black/[.07] bg-white p-5">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-stone-400">Relationship graph building</p>
          <div className="flex items-center justify-center py-4">
            <svg width="200" height="100" viewBox="0 0 200 100">
              {/* Animated connections */}
              <line x1="100" y1="50" x2="40" y2="20" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="4 2">
                <animate attributeName="stroke-dashoffset" values="0;-6" dur="1s" repeatCount="indefinite" />
              </line>
              <line x1="100" y1="50" x2="160" y2="20" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="4 2">
                <animate attributeName="stroke-dashoffset" values="0;-6" dur="1.3s" repeatCount="indefinite" />
              </line>
              <line x1="100" y1="50" x2="40" y2="80" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="4 2">
                <animate attributeName="stroke-dashoffset" values="0;-6" dur="0.9s" repeatCount="indefinite" />
              </line>
              <line x1="100" y1="50" x2="160" y2="80" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="4 2">
                <animate attributeName="stroke-dashoffset" values="0;-6" dur="1.1s" repeatCount="indefinite" />
              </line>
              {/* Nodes */}
              <circle cx="100" cy="50" r="10" fill="#6366f1" />
              <text x="100" y="54" textAnchor="middle" fill="white" fontSize="8" fontFamily="monospace">YOU</text>
              {[{x:40,y:20,l:"A"},{x:160,y:20,l:"B"},{x:40,y:80,l:"C"},{x:160,y:80,l:"D"}].map(({x,y,l}) => (
                <g key={l}>
                  <circle cx={x} cy={y} r="7" fill="#e0e7ff" />
                  <text x={x} y={y+3} textAnchor="middle" fill="#6366f1" fontSize="7" fontFamily="monospace">{l}</text>
                </g>
              ))}
            </svg>
          </div>
          <div className="space-y-1.5">
            {["Email threads → contact links", "Company mentions → deal signals", "Response patterns → relationship score"].map((f, i) => (
              <FadeIn key={f} show={anyConnected} delay={200 + i * 100}>
                <div className="flex items-center gap-2">
                  <Check size={9} className="text-indigo-500 shrink-0" />
                  <span className="font-mono text-[11px] text-stone-500">{f}</span>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </FadeIn>
    </PanelShell>
  );
}

// ── Invite panel ──────────────────────────────────────────────────────────────

export function InvitePanel({ emails, sent }: { emails: string[]; sent: boolean }) {
  const valid = emails.filter(e => e.includes("@"));

  return (
    <PanelShell tag="// team.building" title="Watch your team take shape.">

      {/* Team cards */}
      <div className="rounded-2xl border border-black/[.07] bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400">Team</p>
          <span className="font-mono text-[10px] text-indigo-500">{valid.length + 1} member{valid.length !== 0 ? "s" : ""}</span>
        </div>

        <div className="space-y-2.5">
          {/* You */}
          <div className="flex items-center gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/[.04] px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 font-semibold text-white text-xs">Y</div>
            <div>
              <p className="font-mono text-[12px] font-medium text-stone-800">You</p>
              <p className="font-mono text-[10px] text-indigo-500">Admin · workspace owner</p>
            </div>
          </div>

          {/* Invited members */}
          {valid.map((email, i) => (
            <FadeIn key={email} show delay={i * 80}>
              <div className="flex items-center gap-3 rounded-xl border border-black/[.06] bg-white px-3 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 font-semibold text-stone-600 text-xs">
                  {email.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-[12px] font-medium text-stone-700 truncate">{email.split("@")[0]}</p>
                  <p className="font-mono text-[10px] text-stone-400 truncate">{email}</p>
                </div>
                <span className="ml-auto shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[9px] text-amber-600">
                  {sent ? "Sent" : "Pending"}
                </span>
              </div>
            </FadeIn>
          ))}

          {/* Empty slot */}
          {valid.length === 0 && (
            <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-black/[.06] px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-stone-200">
                <Users size={11} className="text-stone-300" />
              </div>
              <span className="font-mono text-[11px] text-stone-300">Type an email to add a teammate</span>
            </div>
          )}
        </div>
      </div>

      {/* Sent confirmation */}
      {sent && (
        <FadeIn show delay={0}>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500">
                <Check size={10} className="text-white" strokeWidth={3} />
              </div>
              <span className="font-mono text-[12px] font-semibold text-emerald-700">{valid.length} invitation{valid.length !== 1 ? "s" : ""} sent</span>
            </div>
            <p className="font-mono text-[11px] text-emerald-600">Your team will receive secure invite links via email.</p>
          </div>
        </FadeIn>
      )}
    </PanelShell>
  );
}

// ── Import panel ──────────────────────────────────────────────────────────────

const ALL_ROWS = [
  { name: "Acme Corp",      type: "Company", arr: "£420k" },
  { name: "Jane Smith",     type: "Contact", arr: "—"     },
  { name: "Globex Inc",     type: "Company", arr: "£180k" },
  { name: "John Doe",       type: "Contact", arr: "—"     },
  { name: "Initech",        type: "Company", arr: "£95k"  },
];

export function ImportPanel({ file }: { file: string }) {
  const [visibleRows, setVisibleRows] = useState(0);

  useEffect(() => {
    if (!file) { setVisibleRows(0); return; }
    setVisibleRows(0);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setVisibleRows(i);
      if (i >= ALL_ROWS.length) clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  }, [file]);

  return (
    <PanelShell tag="// data.import" title="Your data is being reviewed.">

      {/* File status */}
      <div className="rounded-2xl border border-black/[.07] bg-white p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300 ${file ? "bg-indigo-500" : "bg-stone-100"}`}>
            <FileSpreadsheet size={16} className={file ? "text-white" : "text-stone-300"} />
          </div>
          <div className="min-w-0">
            <p className={`font-mono text-[12px] font-medium truncate transition-colors duration-300 ${file ? "text-stone-800" : "text-stone-300"}`}>
              {file || "No file selected"}
            </p>
            <p className="font-mono text-[10px] text-stone-400">{file ? "Ready for review" : "Drop a CSV or Excel file"}</p>
          </div>
        </div>

        {/* Data table */}
        <div className="rounded-xl border border-black/[.05] overflow-hidden">
          <div className="grid grid-cols-3 border-b border-black/[.05] bg-stone-50 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-stone-400">
            <span>Name</span><span>Type</span><span>ARR</span>
          </div>
          {ALL_ROWS.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-3 px-3 py-2 font-mono text-[11px] border-b border-black/[.03] last:border-0 transition-all duration-300"
              style={{
                opacity: i < visibleRows ? 1 : 0,
                transform: i < visibleRows ? "translateX(0)" : "translateX(-8px)",
              }}
            >
              <span className="truncate text-stone-700">{row.name}</span>
              <span className="text-stone-400">{row.type}</span>
              <span className="text-stone-600">{row.arr}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="rounded-2xl border border-black/[.07] bg-white p-5">
        <div className="space-y-2.5">
          {[
            { label: "File uploaded", done: !!file },
            { label: `${visibleRows} records parsed`, done: visibleRows > 0 },
            { label: "AI validation complete", done: visibleRows >= ALL_ROWS.length },
            { label: "Awaiting your confirmation", done: false },
          ].map(({ label, done }) => (
            <div key={label} className="flex items-center gap-2.5">
              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-400 ${done ? "border-indigo-500 bg-indigo-500" : "border-stone-200"}`}>
                {done && <Check size={9} className="text-white" strokeWidth={3} />}
              </div>
              <span className={`font-mono text-[11px] transition-colors duration-300 ${done ? "text-stone-700" : "text-stone-300"}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

// ── Plan panel ────────────────────────────────────────────────────────────────

const PLANS: Record<string, { price: string; period: string; features: string[] }> = {
  starter: {
    price: "$0", period: "forever",
    features: ["1 user", "500 contacts", "Records & pipeline", "Ask Mondaily AI (100/mo)", "1 email integration"],
  },
  pro: {
    price: "$49", period: "per user / mo",
    features: ["Unlimited contacts", "Full pipeline + AI scoring", "Sequences & automations", "Ask Mondaily AI (unlimited)", "AI enrichment (5,000/mo)"],
  },
  business: {
    price: "$89", period: "per user / mo",
    features: ["Everything in Pro", "Custom objects & fields", "Role-based access", "Finance module", "Webhook & API"],
  },
  enterprise: {
    price: "Custom", period: "talk to us",
    features: ["Everything in Business", "SAML SSO & SCIM", "Audit log", "Data residency", "Dedicated CSM"],
  },
};

export function PlanPanel({ selected }: { selected: string }) {
  const plan = PLANS[selected] ?? PLANS.starter!;
  const [unlockedCount, setUnlockedCount] = useState(0);
  const prevSelected = useRef(selected);

  useEffect(() => {
    if (prevSelected.current !== selected) {
      setUnlockedCount(0);
      prevSelected.current = selected;
    }
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setUnlockedCount(i);
      if (i >= plan.features.length) clearInterval(iv);
    }, 150);
    return () => clearInterval(iv);
  }, [selected, plan.features.length]);

  return (
    <PanelShell tag="// plan.select" title="Features unlocking now.">

      {/* Plan header */}
      <div className="rounded-2xl border border-black/[.07] bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-sans text-lg font-semibold capitalize text-stone-900">{selected}</p>
            <p className="font-mono text-[12px] text-stone-400">{plan.price}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
            <Zap size={16} className="text-indigo-500" />
          </div>
        </div>

        <div className="space-y-2.5">
          {plan.features.map((feature, i) => (
            <div
              key={feature}
              className="flex items-center gap-2.5 transition-all duration-300"
              style={{
                opacity: i < unlockedCount ? 1 : 0.15,
                transform: i < unlockedCount ? "translateX(0)" : "translateX(-6px)",
              }}
            >
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all duration-400"
                style={{ background: i < unlockedCount ? "#6366f1" : "#f4f4f5" }}
              >
                <Check size={10} className={i < unlockedCount ? "text-white" : "text-stone-300"} strokeWidth={3} />
              </div>
              <span className={`font-mono text-[12px] transition-colors duration-300 ${i < unlockedCount ? "text-stone-700" : "text-stone-300"}`}>
                {feature}
              </span>
              {i === unlockedCount - 1 && (
                <span className="ml-auto font-mono text-[9px] text-indigo-500 animate-pulse">unlocked</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Ready state */}
      <FadeIn show={unlockedCount >= plan.features.length} delay={100}>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500">
            <Check size={16} className="text-white" strokeWidth={2.5} />
          </div>
          <p className="font-mono text-[13px] font-semibold text-indigo-700">Workspace ready</p>
          <p className="mt-1 font-mono text-[11px] text-indigo-500">
            {selected === "free" ? "No billing required" : selected === "enterprise" ? "Our team will reach out" : "Billing configured"}
          </p>
        </div>
      </FadeIn>
    </PanelShell>
  );
}
