import { supabase } from "@mondaily/db/client";
import { periodKey, wallClock, type PeriodConfig } from "@mondaily/shared/period";
import { workspacePeriodConfig } from "./period-close";
import { sendWorkspaceEmail } from "./mail";
import { composeWorkspaceReport, type ExportPeriod, type ReportBundle } from "./report-export";

/**
 * Scheduled report delivery — "email me this every week / month / …".
 *
 * DESIGN, following the period-close playbook exactly:
 *   - The cron runs HOURLY and asks the WORKSPACE's calendar what just ended. A single UTC
 *     trigger would mail a Warsaw month two hours early and an Auckland month twelve late.
 *   - A send covers the last COMPLETED period (composeWorkspaceReport complete:true), never the
 *     few hours of the new one.
 *   - Idempotence is a recorded fact, not a hope: settings.report_schedule.last_sent maps each
 *     cadence to the period key it last covered. Same key → no second email, however often the
 *     cron fires. There is no "did we send recently" time heuristic to race.
 *   - Recipients are the workspace's owners and admins — the people the Owner Console already
 *     addresses. No per-report recipient list to drift out of date.
 *   - The email body carries the real KPI table inline (email clients strip stylesheets, so the
 *     styling is inline) plus links to the full HTML report and the Excel workbook. The files are
 *     behind the session cookie, exactly like the in-app links.
 */

export const REPORT_CADENCES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];

export interface ReportSchedule {
  /** cadence → enabled */
  enabled: Partial<Record<ReportCadence, boolean>>;
  /** cadence → period key of the last window a report was SENT for (idempotence anchor). */
  last_sent?: Partial<Record<ReportCadence, string>>;
}

const API_ORIGIN = (process.env.API_URL ?? "https://api.mondaily.com").replace(/\/$/, "");
const APP_ORIGIN = (process.env.APP_URL ?? "https://app.mondaily.com").replace(/\/$/, "");

/** The key identifying the CURRENT period of a cadence — a send is due when it differs from last_sent. */
export function currentPeriodKey(cadence: ReportCadence, cfg: PeriodConfig, now: Date): string {
  if (cadence === "daily") {
    const w = wallClock(now, cfg.timeZone);
    return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
  }
  const type = ({ weekly: "WEEKLY", monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY" } as const)[cadence];
  return periodKey(now, type, cfg);
}

const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 2 });

/** Inline-styled email body — the KPI truth plus links; charts live in the linked full report. */
export function reportEmailHtml(b: ReportBundle, ws: string): { subject: string; body: string } {
  const periodTitle = b.meta.period[0]!.toUpperCase() + b.meta.period.slice(1);
  const dt = (iso: string) => iso.slice(0, 10);
  const window = `${dt(b.meta.range.start)} → ${dt(b.meta.range.end)}`;
  const qs = `period=${b.meta.period}&complete=1&ws=${ws}`;
  const td = `padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;`;
  const rows = b.kpis.map(k => `<tr>
      <td style="${td}">${k.label}</td>
      <td style="${td}text-align:right;font-variant-numeric:tabular-nums;">${fmt(k.value)} ${b.meta.base}</td>
      <td style="${td}color:#6b7280;">${
        k.kind === "balance" ? "as of send time"
        : k.delta == null ? (k.previous != null ? `prev ${fmt(k.previous)}` : "no prior base")
        : `${k.delta >= 0 ? "+" : ""}${k.delta}% vs previous ${b.meta.period.replace(/ly$/, "")}`
      }</td>
    </tr>${k.note ? `<tr><td colspan="3" style="padding:0 10px 6px;font-size:11px;color:#b45309;">${k.note}</td></tr>` : ""}`).join("");
  const closeLine = b.meta.close
    ? `<p style="font-size:12px;color:#6b7280;">Filed close snapshot <b>${b.meta.close.key}</b> (hash ${b.meta.close.hash.slice(0, 16)}…): ${
        b.meta.close.drifted ? "the live ledger has moved since the close — the linked report discloses each change." : "recomputation agrees with the filed figures."}</p>`
    : "";
  return {
    subject: `${periodTitle} report — ${window}`,
    body: `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;color:#111827;">
      <h2 style="font-size:18px;margin:16px 0 2px;">${periodTitle} report</h2>
      <p style="font-size:13px;color:#6b7280;margin:0 0 14px;">${window} · ${b.meta.timeZone} · base ${b.meta.base}</p>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      ${closeLine}
      <p style="margin:18px 0;">
        <a href="${API_ORIGIN}/api/v1/reports/export.html?${qs}" style="display:inline-block;padding:8px 14px;background:#111827;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;">Full report with charts</a>
        &nbsp;<a href="${API_ORIGIN}/api/v1/reports/export.xlsx?${qs}" style="display:inline-block;padding:8px 14px;border:1px solid #d1d5db;border-radius:6px;color:#111827;text-decoration:none;font-size:13px;">Excel workbook</a>
      </p>
      <p style="font-size:11px;color:#9ca3af;">Sent by Mondaily on the workspace's calendar. Flow metrics are counted inside the window; balances are as of send time. Manage this schedule under <a href="${APP_ORIGIN}/reports" style="color:#6b7280;">Reports</a>.</p>
    </div>`,
  };
}

export function readSchedule(settings: Record<string, unknown> | null | undefined): ReportSchedule {
  const raw = (settings?.report_schedule ?? {}) as Partial<ReportSchedule> & Record<string, unknown>;
  const enabled: ReportSchedule["enabled"] = {};
  for (const c of REPORT_CADENCES) if ((raw.enabled as Record<string, unknown> | undefined)?.[c] === true) enabled[c] = true;
  return { enabled, last_sent: (raw.last_sent as ReportSchedule["last_sent"]) ?? {} };
}

async function ownerAdminRecipients(ws: string): Promise<{ email: string; name?: string }[]> {
  const { data } = await supabase.from("workspace_members")
    .select("email, name, role").eq("workspace_id", ws).in("role", ["owner", "admin"]).limit(50);
  return (data ?? [])
    .filter(m => typeof m.email === "string" && m.email.includes("@"))
    .map(m => ({ email: String(m.email), name: typeof m.name === "string" ? m.name : undefined }));
}

export interface DeliveryResult { workspace: string; cadence: ReportCadence; period: string; sent: number; status: "sent" | "skipped" | "no_recipients" | "failed"; detail?: string }

/**
 * One workspace's due sends. Exposed separately from the sweep so the owner's "send me a test now"
 * route and the cron share every line of the composition and delivery path.
 */
export async function deliverDueReports(
  wsId: string, wsRow: { settings?: unknown; timezone?: unknown }, now: Date = new Date(),
): Promise<DeliveryResult[]> {
  const cfg = workspacePeriodConfig(wsRow as { timezone?: unknown; settings?: unknown } | null);
  const schedule = readSchedule(wsRow.settings as Record<string, unknown> | null);
  const out: DeliveryResult[] = [];
  const due = REPORT_CADENCES.filter(c => schedule.enabled[c] && schedule.last_sent?.[c] !== currentPeriodKey(c, cfg, now));
  if (!due.length) return out;

  const recipients = await ownerAdminRecipients(wsId);
  for (const cadence of due) {
    const key = currentPeriodKey(cadence, cfg, now);
    if (!recipients.length) { out.push({ workspace: wsId, cadence, period: key, sent: 0, status: "no_recipients" }); continue; }
    try {
      const bundle = await composeWorkspaceReport(wsId, cadence as ExportPeriod, undefined, now, { complete: true });
      const { subject, body } = reportEmailHtml(bundle, wsId);
      const ok = await sendWorkspaceEmail(wsId, { subject, body, to: recipients });
      if (!ok) { out.push({ workspace: wsId, cadence, period: key, sent: 0, status: "failed", detail: "mail transport declined" }); continue; }
      // Record the send ONLY after it succeeded — a failed send stays due for the next hour.
      const settings = (wsRow.settings ?? {}) as Record<string, unknown>;
      const nextSchedule = { enabled: { ...schedule.enabled }, last_sent: { ...(schedule.last_sent ?? {}), [cadence]: key } };
      await supabase.from("workspaces").update({ settings: { ...settings, report_schedule: nextSchedule } }).eq("id", wsId);
      (wsRow as { settings?: unknown }).settings = { ...settings, report_schedule: nextSchedule };
      out.push({ workspace: wsId, cadence, period: key, sent: recipients.length, status: "sent" });
    } catch (e) {
      out.push({ workspace: wsId, cadence, period: key, sent: 0, status: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** The hourly sweep — every workspace, isolated failures, like closeDuePeriods. */
export async function runReportDelivery(now: Date = new Date()): Promise<{ workspaces: number; results: DeliveryResult[] }> {
  const { data: workspaces, error } = await supabase.from("workspaces").select("id, settings, timezone").is("deleted_at", null);
  if (error) throw new Error(error.message);
  const results: DeliveryResult[] = [];
  for (const ws of workspaces ?? []) {
    try {
      results.push(...await deliverDueReports(String(ws.id), ws as { settings?: unknown; timezone?: unknown }, now));
    } catch (e) {
      results.push({ workspace: String(ws.id), cadence: "daily", period: "-", sent: 0, status: "failed", detail: String(e) });
    }
  }
  return { workspaces: (workspaces ?? []).length, results };
}
