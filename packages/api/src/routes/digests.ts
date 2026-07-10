import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { makeBaseConverter } from "../lib/currency-store";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

function unpack(node: { id: string; data: Record<string, unknown>; updated_at: string }) {
  return { id: node.id, ...node.data, updated_at: node.updated_at };
}

const DigestSchema = z.object({
  object_type: z.string().min(1),
  period:      z.enum(["today", "week", "month", "quarter", "year"]),
  frequency:   z.enum(["daily", "weekly", "monthly"]),
  day_of_week: z.number().min(0).max(6).optional(), // 0=Sun for weekly
  hour:        z.number().min(0).max(23).default(8),
  recipients:  z.array(z.string().email()).min(1),
  label:       z.string().optional(),
});

router.get("/", async (c) => {
  const { data, error } = await supabase
    .from("nodes")
    .select("id,data,updated_at")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "digest_schedule")
    .order("updated_at", { ascending: false });
  return error ? c.json({ error: error.message }, 400) : c.json((data ?? []).map(n => unpack(n as never)));
});

router.post("/", zValidator("json", DigestSchema), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase
    .from("nodes")
    .insert({
      workspace_id: c.get("workspaceId"),
      vertical: "shared",
      object_type: "digest_schedule",
      data: { ...body, enabled: true },
      created_by: c.get("userId"),
    })
    .select("id,data,updated_at")
    .single();
  return error ? c.json({ error: error.message }, 400) : c.json(unpack(data as never), 201);
});

router.delete("/:id", async (c) => {
  const { error } = await supabase
    .from("nodes")
    .delete()
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "digest_schedule")
    .eq("id", c.req.param("id"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

// ─── Send a digest now ────────────────────────────────────────────────────────
router.post("/:id/send", async (c) => {
  const { data: node } = await supabase
    .from("nodes")
    .select("id,data")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", "digest_schedule")
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (!node) return c.json({ error: "Digest not found" }, 404);

  const cfg = node.data as {
    object_type: string; period: string; frequency: string;
    recipients: string[]; label?: string;
  };

  // Fetch records
  const { data: records } = await supabase
    .from("nodes")
    .select("id,data,created_at,updated_at")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("object_type", cfg.object_type)
    .limit(500);

  const recs = records ?? [];

  // Compute basic stats
  const total = recs.length;
  const valueCol = ["deal_value","value","amount","price","revenue","arr","budget"].find(k =>
    recs.some(r => r.data[k] != null && !isNaN(Number(r.data[k])))
  );
  const stageCol = ["deal_stage","stage","status","phase"].find(k =>
    recs.some(r => r.data[k] != null)
  );

  const WON = ["won","closed won","completed","converted","done","paid","approved"];
  const LOST = ["lost","closed lost","rejected","declined","dead","cancelled"];
  const wonRecs  = stageCol ? recs.filter(r => WON.some(k => String(r.data[stageCol] ?? "").toLowerCase().includes(k))) : recs;
  const lostRecs = stageCol ? recs.filter(r => LOST.some(k => String(r.data[stageCol] ?? "").toLowerCase().includes(k))) : [];
  // Multi-currency: convert each record's value to the workspace base currency before summing
  // (fail-closed to face value when a rate is missing) — and label with the base symbol, not "$".
  const { base, toBase } = await makeBaseConverter(c.get("workspaceId"));
  const val$ = (r: { data: Record<string, unknown> }) => toBase(Number(r.data[valueCol!] ?? 0), r.data.currency as string | undefined);
  const wonValue = valueCol ? wonRecs.reduce((s, r) => s + val$(r), 0) : 0;
  const totalValue = valueCol ? recs.reduce((s, r) => s + val$(r), 0) : 0;
  const winRate  = (wonRecs.length + lostRecs.length) > 0
    ? Math.round(wonRecs.length / (wonRecs.length + lostRecs.length) * 100) : null;

  const SYM: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", PLN: "zł", JPY: "¥" };
  const sym = SYM[base] ?? `${base} `;
  const fmt = (n: number) => n >= 1_000_000 ? `${sym}${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${sym}${(n/1_000).toFixed(0)}K` : `${sym}${n.toLocaleString()}`;

  const label = cfg.label || `${cfg.object_type} · ${cfg.period}`;
  const now   = new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

  const statsRows = [
    ["Total records", String(total)],
    ...(wonRecs.length ? [["Completed / Won", String(wonRecs.length)]] : []),
    ...(valueCol && wonValue ? [["Won value", fmt(wonValue)]] : []),
    ...(valueCol && totalValue ? [["Total pipeline value", fmt(totalValue)]] : []),
    ...(winRate !== null ? [["Win rate", `${winRate}%`]] : []),
  ];

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${label} Digest</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f4f4f5; margin:0; padding:24px 0; }
  .wrap { max-width:560px; margin:0 auto; }
  .card { background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .header { background:#ef4444; padding:24px 28px; }
  .header h1 { margin:0; color:#fff; font-size:20px; font-weight:700; }
  .header p  { margin:4px 0 0; color:rgba(255,255,255,.75); font-size:13px; }
  .body { padding:24px 28px; }
  .kpi-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:24px; }
  .kpi { background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:14px 16px; }
  .kpi-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:#6b7280; margin:0 0 4px; }
  .kpi-value { font-size:22px; font-weight:700; color:#111827; margin:0; }
  .footer { padding:16px 28px; border-top:1px solid #f3f4f6; text-align:center; }
  .footer p { margin:0; font-size:12px; color:#9ca3af; }
  .footer a { color:#ef4444; text-decoration:none; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="header">
      <h1>${label} Digest</h1>
      <p>${now}</p>
    </div>
    <div class="body">
      <div class="kpi-grid">
        ${statsRows.map(([l, v]) => `<div class="kpi"><p class="kpi-label">${l}</p><p class="kpi-value">${v}</p></div>`).join("")}
      </div>
      <p style="font-size:13px;color:#6b7280;margin:0">
        This is your ${cfg.frequency} digest for <strong>${cfg.object_type}</strong> (${cfg.period} view).<br>
        Data pulled live from your Mondaily workspace.
      </p>
    </div>
    <div class="footer">
      <p>Sent by <a href="https://mondaily.com">Mondaily</a> · <a href="https://app.mondaily.com/reports">Open Live Report →</a></p>
    </div>
  </div>
</div>
</body>
</html>`;

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return c.json({ error: "RESEND_API_KEY is not configured on this server" }, 503);

  const results = await Promise.all(cfg.recipients.map(async (to) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Mondaily Reports <reports@mondaily.com>",
        to,
        subject: `${label} — ${now}`,
        html,
      }),
    });
    return { to, ok: res.ok, status: res.status };
  }));

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) return c.json({ error: `Failed to send to: ${failed.map(r => r.to).join(", ")}`, results }, 500);
  return c.json({ ok: true, sent: results.length });
});

export { router as digestsRouter };
