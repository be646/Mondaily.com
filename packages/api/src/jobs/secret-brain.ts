import { supabase } from "@mondaily/db/client";
import { makeBaseConverter } from "../lib/currency-store";
import { dealStage, dealValue, isOpen as stageIsOpen } from "../lib/money";

/**
 * SECRET BRAIN — shadow mode. The workspace intelligence engine's first, deliberately humble form:
 * DETERMINISTIC detectors over real workspace data. No AI generation in the detection path at all —
 * every signal is code-computed with evidence (ids + numbers), so the brain's judgment can be
 * audited before it is ever allowed to propose work.
 *
 * SHADOW CONTRACT (guarded):
 *   • READS only — never inserts/updates workspace data, decisions, tasks, or mail
 *   • every run is logged to brain_runs with proof-of-work (detectors, rows scanned, duration)
 *   • every signal carries evidence — the exact ids and computed numbers behind the claim
 *   • fail-soft: missing tables (migration not applied) → honest {enabled:false}, never a crash
 */

const TABLE_MISSING = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message ?? ""));

interface Signal { kind: string; severity: "info" | "watch" | "risk"; title: string; detail: string; evidence: Record<string, unknown> }

export async function runSecretBrain(now: Date = new Date()): Promise<{ enabled: boolean; runs: number; signals: number; failed: number }> {
  // Migration check first — honest disable, not a crash.
  const probe = await supabase.from("brain_runs").select("id", { head: true, count: "exact" }).limit(1);
  if (TABLE_MISSING(probe.error)) return { enabled: false, runs: 0, signals: 0, failed: 0 };

  const { data: wsList } = await supabase.from("workspaces").select("id, name");
  let runs = 0, totalSignals = 0, failed = 0;

  for (const w of wsList ?? []) {
    const ws = String(w.id);
    const t0 = Date.now();
    const { data: run } = await supabase.from("brain_runs").insert({ workspace_id: ws, mode: "shadow" }).select("id").single();
    if (!run) { failed++; continue; }
    try {
      const nowMs = now.getTime();
      const [{ data: deals }, { data: tasks }, { data: pending }, conv] = await Promise.all([
        supabase.from("nodes").select("id, data, created_at, updated_at").eq("workspace_id", ws)
          .or("object_type.ilike.%deal%,object_type.ilike.%opportunit%").limit(20000),
        supabase.from("tasks").select("id, assignee_id, due_date, completed").eq("workspace_id", ws).eq("completed", false).limit(5000),
        supabase.from("decision_queue").select("id, created_at").eq("workspace_id", ws).eq("status", "pending").limit(2000),
        makeBaseConverter(ws),
      ]);

      const signals: Signal[] = [];
      const money = (v: number) => `${conv.base} ${Math.round(v).toLocaleString()}`;

      // ── Detector 1: stalled high-value deals (open, >14d untouched, top decile by value) ──
      const open = (deals ?? []).filter(d => stageIsOpen(dealStage((d.data ?? {}) as Record<string, unknown>)));
      const valued = open.map(d => ({ d, val: conv.toBase(dealValue((d.data ?? {}) as Record<string, unknown>), ((d.data as Record<string, unknown>)?.currency as string | undefined) ?? null) }))
        .filter(x => x.val > 0).sort((a, b) => b.val - a.val);
      const threshold = valued.length > 0 ? valued[Math.floor(valued.length / 10)]?.val ?? valued[0]!.val : 0;
      for (const { d, val } of valued) {
        const touched = Date.parse(String(d.updated_at ?? d.created_at ?? ""));
        const idleDays = Number.isFinite(touched) ? Math.floor((nowMs - touched) / 86_400_000) : null;
        if (val >= threshold && idleDays != null && idleDays >= 14) {
          const name = String(((d.data ?? {}) as Record<string, unknown>).name ?? "Unnamed deal");
          signals.push({
            kind: "stalled_deal", severity: idleDays >= 30 ? "risk" : "watch",
            title: `High-value deal idle ${idleDays}d: ${name}`,
            detail: `${money(val)} open deal untouched for ${idleDays} days — top-decile value for this workspace.`,
            evidence: { node_id: d.id, value_base: Math.round(val), idle_days: idleDays, threshold_base: Math.round(threshold) },
          });
        }
      }

      // ── Detector 2: overdue task pileups per member (≥3 overdue) ──
      const overdueBy = new Map<string, string[]>();
      for (const t of tasks ?? []) {
        if (t.due_date && Date.parse(String(t.due_date)) < nowMs && t.assignee_id) {
          const list = overdueBy.get(String(t.assignee_id)) ?? [];
          list.push(String(t.id)); overdueBy.set(String(t.assignee_id), list);
        }
      }
      for (const [assignee, ids] of overdueBy) {
        if (ids.length >= 3) signals.push({
          kind: "overdue_pileup", severity: ids.length >= 6 ? "risk" : "watch",
          title: `${ids.length} overdue tasks on one member`,
          detail: `One assignee is carrying ${ids.length} overdue tasks — a workload or blocking problem, not a motivation one.`,
          evidence: { assignee_id: assignee, task_ids: ids.slice(0, 20), overdue_count: ids.length },
        });
      }

      // ── Detector 3: aging decision queue (pending ≥7d) ──
      const aging = (pending ?? []).filter(p => nowMs - Date.parse(String(p.created_at)) >= 7 * 86_400_000);
      if (aging.length > 0) signals.push({
        kind: "aging_decisions", severity: aging.length >= 5 ? "risk" : "watch",
        title: `${aging.length} decision(s) waiting over a week`,
        detail: `Agent proposals are sitting unreviewed — the approval loop is the bottleneck, not the agents.`,
        evidence: { decision_ids: aging.map(a => String(a.id)).slice(0, 20), count: aging.length },
      });

      // ── Detector 4: pipeline concentration (one deal >50% of open value) ──
      const totalOpen = valued.reduce((s, x) => s + x.val, 0);
      if (valued.length >= 2 && totalOpen > 0 && valued[0]!.val / totalOpen > 0.5) {
        const top = valued[0]!;
        signals.push({
          kind: "pipeline_concentration", severity: "watch",
          title: `One deal is ${Math.round((top.val / totalOpen) * 100)}% of the open pipeline`,
          detail: `${money(top.val)} of ${money(totalOpen)} open value sits in a single deal — forecast risk if it slips.`,
          evidence: { node_id: top.d.id, value_base: Math.round(top.val), pipeline_base: Math.round(totalOpen), share_pct: Math.round((top.val / totalOpen) * 100) },
        });
      }

      if (signals.length > 0) {
        await supabase.from("intelligence_signals").insert(signals.map(s => ({ ...s, workspace_id: ws, run_id: run.id })));
      }

      // ── ADVISOR MODE (opt-in per workspace, default OFF) ────────────────────────────────────
      // When workspaces.settings.brain_advisor === true, each signal becomes an evidence-backed
      // PROPOSAL in the existing decision queue. Contract: proposals are deduped by a
      // deterministic source key (no daily re-spam), risk stays advisory (low/medium), and they
      // are NEVER auto-approved — a human resolves every one. The brain still mutates nothing
      // itself; the QUEUE is the only place its judgment can become action, behind your click.
      try {
        const { data: wsRow } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
        const advisor = !!(wsRow?.settings as { brain_advisor?: boolean } | null)?.brain_advisor;
        if (advisor && signals.length > 0) {
          const keyOf = (sg: Signal) => `brain:${sg.kind}:${String((sg.evidence.node_id ?? sg.evidence.assignee_id ?? sg.evidence.count ?? "team"))}`;
          // Dedup: anything currently OPEN, plus anything RESOLVED in the last 14 days — a
          // rejection means "stop proposing this" for two weeks, not "ask me again tomorrow".
          const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
          const [{ data: open }, { data: recent }] = await Promise.all([
            supabase.from("decision_queue").select("source_id")
              .eq("workspace_id", ws).eq("source_type", "brain_signal").in("status", ["pending", "snoozed"]).limit(500),
            supabase.from("decision_queue").select("source_id")
              .eq("workspace_id", ws).eq("source_type", "brain_signal").gte("resolved_at", since14).limit(500),
          ]);
          const seen = new Set([...(open ?? []), ...(recent ?? [])].map(e => String(e.source_id)));
          const ACTION: Record<string, string> = {
            stalled_deal: "Re-engage this deal — assign an owner follow-up within 2 business days.",
            overdue_pileup: "Rebalance this member's overdue tasks — reassign or re-date the oldest ones.",
            aging_decisions: "Review the waiting decisions — the approval loop is the current bottleneck.",
            pipeline_concentration: "De-risk the forecast — advance or split reliance on the dominant deal.",
          };
          for (const sg of signals) {
            const key = keyOf(sg);
            if (seen.has(key)) continue;
            await supabase.from("decision_queue").insert({
              workspace_id: ws, source_type: "brain_signal", source_id: key, agent_name: "Signal Agent",
              title: sg.title, summary: sg.detail,
              recommended_action: ACTION[sg.kind] ?? "Review this signal.",
              risk_level: sg.severity === "risk" ? "medium" : "low",   // advisory ceiling — never high
              evidence: [{ type: "brain_signal", title: sg.title, ...sg.evidence, brain_run_id: run.id }],
            }).then(() => {}, () => {});
            // deliberately NO maybeAutoApprove — advisor proposals always wait for a human
          }
        }
      } catch { /* advisor is best-effort — a proposal failure never fails the sweep */ }
      await supabase.from("brain_runs").update({
        finished_at: new Date().toISOString(), status: "completed", signals_count: signals.length,
        proof: {
          detectors: ["stalled_deal", "overdue_pileup", "aging_decisions", "pipeline_concentration"],
          rows_scanned: { deals: (deals ?? []).length, open_tasks: (tasks ?? []).length, pending_decisions: (pending ?? []).length },
          duration_ms: Date.now() - t0,
        },
      }).eq("id", run.id);
      runs++; totalSignals += signals.length;
    } catch (e) {
      await supabase.from("brain_runs").update({ finished_at: new Date().toISOString(), status: "failed", error: String(e).slice(0, 500) }).eq("id", run.id).then(() => {}, () => {});
      failed++;
    }
  }
  return { enabled: true, runs, signals: totalSignals, failed };
}
