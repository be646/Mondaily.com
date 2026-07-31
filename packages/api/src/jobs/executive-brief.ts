import { supabase } from "@mondaily/db/client";
import { aiGateway } from "../lib/ai-gateway";
import { groundingViolations } from "../lib/grounding";
import { sendTransactionalEmail } from "../lib/mail";
import { computeOutcomes } from "../lib/outcomes";
import { goalActual } from "../routes/activities";
import { goalAttainmentPct } from "../lib/oversight-metrics";

/**
 * Executive brief — the AUTONOMOUS monthly report. Runs from cron on the 1st, covers the JUST-
 * COMPLETED calendar month vs the month before, and emails every owner/admin of each workspace
 * that had any activity. Built entirely from the shared engines (outcomes + baseline + grounding):
 *   • every number is code-computed; the one AI paragraph is grounding-validated or dropped
 *   • recipients are resolved server-side from workspace_members (role owner/admin) — never input
 *   • fail-soft per workspace: one workspace's failure never blocks the rest
 *   • honest skip: a workspace with zero deals AND zero tasks in the month gets no email
 */
export async function runExecutiveBrief(now: Date = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  // The just-completed calendar month, and the one before it.
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1;
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1).getTime();
  const prevEnd = monthStart - 1;
  const monthName = new Date(monthStart).toLocaleString("en", { month: "long", year: "numeric" });

  const { data: wsList } = await supabase.from("workspaces").select("id, name");
  let sent = 0, skipped = 0, failed = 0;

  for (const w of wsList ?? []) {
    const ws = String(w.id);
    try {
      const [outcomes, { data: tasks }, { data: decisions }, { data: admins }] = await Promise.all([
        computeOutcomes(ws, monthStart, monthEnd, prevStart, prevEnd),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("completed", true)
          .gte("completed_at", new Date(monthStart).toISOString()).lte("completed_at", new Date(monthEnd).toISOString()),
        supabase.from("decision_queue").select("id", { count: "exact", head: true }).eq("workspace_id", ws)
          .gte("resolved_at", new Date(monthStart).toISOString()).lte("resolved_at", new Date(monthEnd).toISOString()),
        supabase.from("workspace_members").select("email, name, role").eq("workspace_id", ws).in("role", ["owner", "admin"]),
      ]);
      // Active goals with real attainment — same computation the Goals panel uses.
      const { data: goalRows } = await supabase.from("workspace_goals").select("*").eq("workspace_id", ws).eq("active", true).limit(20).then(r => r, () => ({ data: null }));
      const goals = await Promise.all((goalRows ?? []).map(async g => {
        const actual = await goalActual(ws, String(g.metric), (g.target_user_id as string) ?? null, Number(g.window_days ?? 30)).catch(() => 0);
        return { label: (g.label as string) ?? String(g.metric), actual, target: Number(g.target_value), pct: goalAttainmentPct(actual, Number(g.target_value)) };
      }));
      const tasksDone = (tasks as unknown as { count?: number } | null)?.count ?? 0;
      const decisionsDone = (decisions as unknown as { count?: number } | null)?.count ?? 0;
      const t = outcomes.team;
      const recipients = (admins ?? []).map(a => ({ email: String(a.email ?? "").trim(), name: (a.name as string | undefined) ?? undefined })).filter(r => r.email);

      // Honest skip — nothing happened, no recipients, nothing to say.
      if (recipients.length === 0 || (t.deals_won === 0 && t.deals_lost === 0 && t.pipeline_deals === 0 && tasksDone === 0 && decisionsDone === 0)) { skipped++; continue; }

      const cur = outcomes.base_currency;
      const money = (v: number) => `${cur} ${Math.round(v).toLocaleString()}`;
      const digest = `Workspace ${w.name ?? ws} — ${monthName}: value won ${money(t.value_won)} across ${t.deals_won} deals, value lost ${money(t.value_lost)} across ${t.deals_lost} deals, open pipeline ${money(t.pipeline_value)} across ${t.pipeline_deals} deals, win rate ${t.win_rate_pct ?? "n/a"}%, tasks completed ${tasksDone}, decisions resolved ${decisionsDone}.`;

      let insight: string | null = null;
      try {
        const { text } = await aiGateway({
          system: "You write ONE short executive paragraph (2-3 sentences) summarizing a company's month from recorded numbers. Use ONLY numbers present in the data. Neutral and factual — no advice, no invented context.",
          prompt: digest, maxTokens: 180, workspaceId: ws, userId: "system:executive-brief", feature: "executive_brief",
        });
        const candidate = (text ?? "").trim();
        if (candidate && groundingViolations(candidate, digest).length === 0) insight = candidate;
      } catch { /* brief ships without the AI paragraph */ }

      const dwl = t.deltas?.value_won;
      const deltaLine = dwl && dwl.kind === "pct" ? ` (${(dwl.direction ?? 0) >= 0 ? "▲" : "▼"} ${dwl.label} vs prior month)`
        : dwl && dwl.kind === "new" ? " (first wins on record for a month)"
        : dwl && dwl.kind === "raw" ? ` (${dwl.detail})` : "";
      const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const kpi = (label: string, value: string, sub?: string) =>
        `<td style="padding:12px 16px;border-left:1px solid #e8e8e4"><div style="font:600 18px/1.2 ui-monospace,monospace;color:#111">${esc(value)}</div><div style="font:11px -apple-system,sans-serif;color:#777;margin-top:2px">${esc(label)}${sub ? ` · ${esc(sub)}` : ""}</div></td>`;

      const html = `<!doctype html><html><body style="margin:0;background:#fafafa;padding:24px">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e8e8e4;border-radius:8px;overflow:hidden">
  <div style="padding:20px 24px;border-bottom:1px solid #e8e8e4">
    <div style="font:600 16px -apple-system,sans-serif;color:#111">${esc(String(w.name ?? "Workspace"))} — executive brief</div>
    <div style="font:11px -apple-system,sans-serif;color:#777;margin-top:3px">${esc(monthName)} · sent automatically on the 1st · Mondaily</div>
  </div>
  <table role="presentation" style="width:100%;border-collapse:collapse;border-bottom:1px solid #e8e8e4"><tr>
    ${kpi("Value won", money(t.value_won) + deltaLine, `${t.deals_won} deals`)}${kpi("Value lost", money(t.value_lost), `${t.deals_lost} deals`)}
  </tr></table>
  <table role="presentation" style="width:100%;border-collapse:collapse;border-bottom:1px solid #e8e8e4"><tr>
    ${kpi("Open pipeline", money(t.pipeline_value), `${t.pipeline_deals} deals · as of send`)}${kpi("Win rate", t.win_rate_pct != null ? `${t.win_rate_pct}%` : "—", "of closed deals")}${kpi("Avg deal", t.avg_deal_size != null ? money(t.avg_deal_size) : "—")}
  </tr></table>
  <table role="presentation" style="width:100%;border-collapse:collapse;border-bottom:1px solid #e8e8e4"><tr>
    ${kpi("Tasks completed", String(tasksDone))}${kpi("Decisions resolved", String(decisionsDone))}
  </tr></table>
  ${goals.length > 0 ? `<div style="padding:16px 24px;border-bottom:1px solid #e8e8e4"><div style="font:600 11px -apple-system,sans-serif;color:#999;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Goals</div>${goals.map(g => `
    <div style="display:flex;justify-content:space-between;font:12px -apple-system,sans-serif;color:#333;padding:3px 0"><span>${esc(g.label)}</span><span style="font-variant-numeric:tabular-nums;color:${g.pct >= 100 ? "#2f9e6b" : g.pct >= 70 ? "#555" : "#c6892e"}">${g.actual.toLocaleString()}/${g.target.toLocaleString()} · ${g.pct}%</span></div>`).join("")}</div>` : ""}
  ${insight ? `<div style="padding:16px 24px;border-bottom:1px solid #e8e8e4"><div style="font:600 11px -apple-system,sans-serif;color:#999;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">AI summary</div><p style="font:13px/1.5 -apple-system,sans-serif;color:#333;margin:0">${esc(insight)}</p></div>` : ""}
  <div style="padding:12px 24px"><p style="font:10px -apple-system,sans-serif;color:#aaa;margin:0">All figures are recorded workspace activity for ${esc(monthName)}, in ${esc(cur)}.${t.unconverted > 0 ? ` ${t.unconverted} deal(s) could not be currency-converted and are excluded from totals.` : ""} Nothing is estimated.</p></div>
</div></body></html>`;

      const ok = await sendTransactionalEmail({ subject: `${w.name ?? "Workspace"} — executive brief · ${monthName}`, to: recipients, body: html });
      if (ok) sent++; else failed++;
    } catch { failed++; }
  }
  return { sent, skipped, failed };
}
