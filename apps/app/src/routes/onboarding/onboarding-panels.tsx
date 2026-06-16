import { Check, Mail, Users, FileSpreadsheet, Zap } from "lucide-react";

// ── Shared ────────────────────────────────────────────────────────────────────

function PanelShell({ tag, title, sub, children }: { tag: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-8 border-l border-black/[.06] bg-zinc-50 px-10 py-12">
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-indigo-500">{tag}</p>
        <h2 className="font-sans text-xl font-semibold tracking-tight text-zinc-900">{title}</h2>
        <p className="mt-1 font-mono text-[12px] text-zinc-500">{sub}</p>
      </div>
      <div className="flex flex-1 flex-col gap-6">{children}</div>
    </div>
  );
}

function LogLine({ status, text, done }: { status: string; text: string; done?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 shrink-0 font-mono text-[10px] font-semibold ${done ? "text-indigo-500" : "text-zinc-300"}`}>
        {done ? "✓" : "·"}
      </span>
      <div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">{status} </span>
        <span className="font-mono text-[11px] text-zinc-500">{text}</span>
      </div>
    </div>
  );
}

function Avatar({ name, sub, size = "md" }: { name: string; sub?: string; size?: "sm" | "md" }) {
  const initial = name?.trim().charAt(0).toUpperCase() || "?";
  const sz = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  return (
    <div className="flex items-center gap-3">
      <div className={`${sz} flex shrink-0 items-center justify-center rounded-full bg-indigo-500/10 font-semibold text-indigo-600`}>
        {initial}
      </div>
      {(name || sub) && (
        <div>
          {name && <p className="font-mono text-[12px] font-medium text-zinc-800">{name || "…"}</p>}
          {sub  && <p className="font-mono text-[10px] text-zinc-400">{sub}</p>}
        </div>
      )}
    </div>
  );
}

// ── Sign-up panel ─────────────────────────────────────────────────────────────

export function SignUpPanel({ email, stage }: { email: string; stage: "form" | "verify" | "done" }) {
  return (
    <PanelShell tag="// account.create" title="Your workspace awaits." sub="Fill in the form to get started.">
      <div className="rounded-2xl border border-black/[.07] bg-white p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/10 font-semibold text-indigo-600 text-sm">
            {email ? email.charAt(0).toUpperCase() : "?"}
          </div>
          <div>
            <p className="font-mono text-[13px] font-medium text-zinc-800">{email || "your@email.com"}</p>
            <p className="font-mono text-[10px] text-zinc-400">new account</p>
          </div>
        </div>
        <div className="h-px bg-black/[.05]" />
        <div className="space-y-2">
          <LogLine status="identity" text="email address registered" done={stage !== "form"} />
          <LogLine status="security" text="credentials configured" done={stage !== "form"} />
          <LogLine status="verify"   text="email verified" done={stage === "done"} />
          <LogLine status="workspace" text="workspace ready" done={stage === "done"} />
        </div>
      </div>

      <div className="rounded-2xl border border-black/[.07] bg-white p-6">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zinc-400">What you get</p>
        <div className="space-y-2.5">
          {["CRM · contacts, companies, deals", "Finance · invoices, expenses", "AI enrichment · auto-updated records", "Automations · no-code workflows"].map(f => (
            <div key={f} className="flex items-center gap-2">
              <Check size={11} className="shrink-0 text-indigo-500" />
              <span className="font-mono text-[12px] text-zinc-600">{f}</span>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

// ── Profile panel ─────────────────────────────────────────────────────────────

export function ProfilePanel({ name, title }: { name: string; title: string }) {
  const hasName  = name.trim().length > 0;
  const hasTitle = title.trim().length > 0;
  return (
    <PanelShell tag="// profile.building" title="Let's put a face to the name." sub="Your profile updates as you type.">
      <div className="rounded-2xl border border-black/[.07] bg-white p-6">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/10 font-sans text-2xl font-semibold text-indigo-600 transition-all">
            {hasName ? name.trim().charAt(0).toUpperCase() : "?"}
          </div>
          <div>
            <p className={`font-sans text-lg font-semibold tracking-tight transition-colors ${hasName ? "text-zinc-900" : "text-zinc-300"}`}>
              {hasName ? name : "Your name"}
            </p>
            <p className={`font-mono text-[12px] transition-colors ${hasTitle ? "text-indigo-500" : "text-zinc-300"}`}>
              {hasTitle ? title : "Job title"}
            </p>
          </div>
        </div>
        <div className="h-px bg-black/[.05] mb-4" />
        <div className="space-y-2">
          <LogLine status="profile"   text="display name set" done={hasName} />
          <LogLine status="role"      text="job title configured" done={hasTitle} />
          <LogLine status="workspace" text="ready to invite teammates" done={hasName && hasTitle} />
        </div>
      </div>

      <div className="rounded-2xl border border-black/[.07] bg-white p-5">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zinc-400">Your workspace role</p>
        <div className="flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[.04] px-3 py-2">
          <Zap size={12} className="text-indigo-500" />
          <span className="font-mono text-[12px] text-indigo-700">Admin · full access</span>
        </div>
      </div>
    </PanelShell>
  );
}

// ── Workspace panel ───────────────────────────────────────────────────────────

export function WorkspacePanel({ name, size, industry }: { name: string; size: string; industry: string }) {
  const hasName = name.trim().length > 0;
  return (
    <PanelShell tag="// workspace.create" title="Building your home base." sub="Your workspace configures itself.">
      <div className="rounded-2xl border border-black/[.07] bg-white overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/[.05] bg-zinc-50 px-4 py-2.5">
          <div className="h-2 w-2 rounded-full bg-black/[.08]" />
          <span className="font-mono text-[11px] text-zinc-400">app.mondaily.com</span>
        </div>
        <div className="flex">
          <div className="w-36 border-r border-black/[.05] p-3 space-y-1">
            <p className={`font-mono text-[11px] font-semibold truncate transition-colors ${hasName ? "text-zinc-800" : "text-zinc-300"}`}>
              {hasName ? name : "Workspace"}
            </p>
            {["Home", "CRM", "Finance", "Pipeline"].map(item => (
              <p key={item} className="font-mono text-[10px] text-zinc-400 px-1">{item}</p>
            ))}
          </div>
          <div className="flex-1 p-4 space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-400 mb-3">Records</p>
            {["Acme Corp", "Globex Inc", "Initech"].map(r => (
              <div key={r} className="flex items-center gap-2 rounded-lg border border-black/[.05] px-3 py-1.5">
                <div className="h-4 w-4 rounded bg-indigo-500/10" />
                <span className="font-mono text-[11px] text-zinc-600">{r}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <LogLine status="workspace" text={hasName ? `"${name}" created` : "name pending"} done={hasName} />
        <LogLine status="size"      text={size     ? `team size: ${size}` : "size pending"} done={!!size} />
        <LogLine status="industry"  text={industry  ? `industry: ${industry}` : "industry pending"} done={!!industry} />
        <LogLine status="crm"       text="CRM module activated" done={hasName} />
      </div>
    </PanelShell>
  );
}

// ── Email panel ───────────────────────────────────────────────────────────────

export function ConnectEmailPanel({ connected }: { connected: string[] }) {
  return (
    <PanelShell tag="// email.graph" title="Building your network." sub="Mondaily maps relationships from email.">
      <div className="rounded-2xl border border-black/[.07] bg-white p-6 space-y-4">
        {(["gmail", "outlook"] as const).map(p => (
          <div key={p} className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${connected.includes(p) ? "border-indigo-500/30 bg-indigo-500/[.04]" : "border-black/[.06]"}`}>
            <Mail size={14} className={connected.includes(p) ? "text-indigo-500" : "text-zinc-300"} />
            <span className="flex-1 font-mono text-[12px] text-zinc-700 capitalize">{p === "gmail" ? "Gmail" : "Outlook"}</span>
            {connected.includes(p) && <Check size={12} className="text-indigo-500" />}
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-black/[.07] bg-white p-5">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zinc-400">What gets built</p>
        <div className="space-y-2">
          {["Relationship graph from email threads", "Auto-link contacts to companies", "Deal signals from email activity"].map(f => (
            <div key={f} className="flex items-start gap-2">
              <Check size={10} className={`mt-0.5 shrink-0 ${connected.length ? "text-indigo-500" : "text-zinc-300"}`} />
              <span className="font-mono text-[11px] text-zinc-500">{f}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <LogLine status="gmail"   text="Gmail connected" done={connected.includes("gmail")} />
        <LogLine status="outlook" text="Outlook connected" done={connected.includes("outlook")} />
        <LogLine status="graph"   text="relationship graph building" done={connected.length > 0} />
      </div>
    </PanelShell>
  );
}

// ── Invite panel ──────────────────────────────────────────────────────────────

export function InvitePanel({ emails, sent }: { emails: string[]; sent: boolean }) {
  const valid = emails.filter(e => e.includes("@"));
  return (
    <PanelShell tag="// team.building" title="Your team is taking shape." sub="Each invite adds a teammate card.">
      <div className="rounded-2xl border border-black/[.07] bg-white p-6">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-zinc-400">Team · {valid.length + 1} member{valid.length !== 0 ? "s" : ""}</p>
        <div className="space-y-3">
          <Avatar name="You" sub="Admin · workspace owner" />
          {valid.map(email => (
            <Avatar key={email} name={email.split("@")[0] ?? ""} sub={`${email} · invited`} />
          ))}
          {valid.length === 0 && (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-black/[.08]">
                <Users size={12} className="text-zinc-300" />
              </div>
              <span className="font-mono text-[11px] text-zinc-300">Add a teammate above</span>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <LogLine status="owner"  text="you are workspace admin" done />
        <LogLine status="invite" text={valid.length ? `${valid.length} invite${valid.length > 1 ? "s" : ""} prepared` : "no invites yet"} done={valid.length > 0} />
        <LogLine status="email"  text="invitation emails queued" done={sent} />
      </div>
    </PanelShell>
  );
}

// ── Import panel ──────────────────────────────────────────────────────────────

const PREVIEW_ROWS = [
  { name: "Acme Corp",      type: "Company", arr: "£420k" },
  { name: "Jane Smith",     type: "Contact", arr: "—" },
  { name: "Globex Inc",     type: "Company", arr: "£180k" },
  { name: "John Doe",       type: "Contact", arr: "—" },
  { name: "Initech",        type: "Company", arr: "£95k" },
];

export function ImportPanel({ file }: { file: string }) {
  return (
    <PanelShell tag="// data.import" title="Ready to import your data." sub="Mondaily reviews before anything changes.">
      <div className="rounded-2xl border border-black/[.07] bg-white overflow-hidden">
        <div className="flex items-center gap-2 border-b border-black/[.05] bg-zinc-50 px-4 py-2">
          <FileSpreadsheet size={12} className={file ? "text-indigo-500" : "text-zinc-300"} />
          <span className="font-mono text-[11px] text-zinc-500">{file || "no file selected"}</span>
        </div>
        <div className="divide-y divide-black/[.04]">
          <div className="grid grid-cols-3 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
            <span>Name</span><span>Type</span><span>ARR</span>
          </div>
          {(file ? PREVIEW_ROWS : PREVIEW_ROWS.slice(0, 2)).map((row, i) => (
            <div key={i} className={`grid grid-cols-3 px-4 py-2 font-mono text-[11px] transition-opacity ${file ? "text-zinc-700 opacity-100" : "text-zinc-300 opacity-50"}`}>
              <span className="truncate">{row.name}</span>
              <span className="text-zinc-400">{row.type}</span>
              <span>{row.arr}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <LogLine status="file"   text={file ? `"${file}" ready` : "waiting for file"} done={!!file} />
        <LogLine status="parse"  text="records parsed and validated" done={!!file} />
        <LogLine status="review" text="import review prepared" done={!!file} />
        <LogLine status="import" text="pending your confirmation" done={false} />
      </div>
    </PanelShell>
  );
}

// ── Plan panel ────────────────────────────────────────────────────────────────

const PLAN_FEATURES: Record<string, string[]> = {
  free:       ["3 seats", "50K records", "Basic AI enrichment", "CRM module"],
  pro:        ["Unlimited seats", "Full AI agents", "All verticals", "Priority support", "Custom automations"],
  enterprise: ["SSO & SAML", "Audit logs", "SLA guarantee", "Dedicated CSM", "Custom contracts"],
};

export function PlanPanel({ selected }: { selected: string }) {
  const features = PLAN_FEATURES[selected] ?? PLAN_FEATURES.free!;
  return (
    <PanelShell tag="// plan.select" title="Unlocking your workspace." sub="Features activate as you choose.">
      <div className="rounded-2xl border border-black/[.07] bg-white p-6">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400">Selected plan</p>
        <p className="mb-4 font-sans text-lg font-semibold capitalize text-zinc-900">{selected}</p>
        <div className="space-y-2.5">
          {features.map((f, i) => (
            <div key={f} className="flex items-center gap-2" style={{ transitionDelay: `${i * 60}ms` }}>
              <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500/10">
                <Check size={9} className="text-indigo-600" />
              </div>
              <span className="font-mono text-[12px] text-zinc-700">{f}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <LogLine status="plan"     text={`${selected} plan activated`} done />
        <LogLine status="billing"  text={selected === "free" ? "no billing required" : "billing configured"} done />
        <LogLine status="features" text="modules unlocked" done />
        <LogLine status="ready"    text="workspace ready to use" done />
      </div>
    </PanelShell>
  );
}
