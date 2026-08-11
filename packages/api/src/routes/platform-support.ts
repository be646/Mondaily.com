import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validate";
import { supabase } from "@mondaily/db/client";
import { getCookie } from "hono/cookie";
import { verifyAccessToken, ACCESS_COOKIE } from "../lib/auth-tokens";
import { requirePlatformAdmin, isPlatformAdmin } from "../middleware/platform-admin";
import { createNotification } from "../lib/notify";
import { SUPPORT_STATUSES } from "./support";
import { mailSupportReplied, mailWaitingOnUser, mailResolved } from "../lib/support-mail";

/**
 * MONDAILY PLATFORM SUPPORT DASHBOARD (internal) — where ticket status/review/close actually live.
 * Workspace users (including workspace admins) can only open tickets and reply; this surface is for
 * Mondaily's own operators, gated by the PLATFORM_ADMIN_EMAILS allowlist (fail-closed).
 *
 * CROSS-WORKSPACE BY DESIGN: these queries intentionally read support_ticket nodes from every
 * workspace — that is the product (Mondaily triaging its customers' tickets). workspace_id is data
 * on each row here, not an access scope; access is the platform-admin gate above. No other node
 * types are ever read or written from this router.
 */
type Variables = { userId: string };
const router = new Hono<{ Variables: Variables }>();

interface TicketComment { author_id: string; author_role: "admin" | "requester" | "mondaily"; body: string; at: string }
interface TicketData {
  category: string; subject: string; message: string; status: (typeof SUPPORT_STATUSES)[number];
  updated_at?: string; comments?: TicketComment[];
  status_history?: { status: string; at: string; by: string }[];
  metadata?: { requester?: { name?: string; email?: string } } & Record<string, unknown>;
  /** When we last put the ball in the customer's court — the clock the sweep reads. */
  waiting_since?: string;
  reminders_sent?: number[];
  closed_reason?: string;
}

/** The requester's mailbox, or null when the ticket has none (older tickets predate the stamp). */
function requesterOf(t: TicketNode): { email: string; name?: string } | null {
  const r = t.data.metadata?.requester;
  return r?.email ? { email: r.email, name: r.name } : null;
}
interface TicketNode { id: string; workspace_id: string; created_by: string | null; created_at: string; data: TicketData }

// GET /platform/support/me — capability probe for the app sidebar/route guard. Answers true/false
// (never 403) so the frontend can decide whether to show the dashboard link at all.
router.get("/me", async (c) => {
  try {
    const at = getCookie(c, ACCESS_COOKIE);
    if (!at) return c.json({ platform_admin: false });
    const claims = await verifyAccessToken(at);
    if (!claims?.sub) return c.json({ platform_admin: false });
    return c.json({ platform_admin: await isPlatformAdmin(claims.sub) });
  } catch { return c.json({ platform_admin: false }); }
});

// Everything below is hard-gated.
router.use("*", requirePlatformAdmin);

async function getTicketAnywhere(id: string): Promise<TicketNode | null> {
  const { data } = await supabase.from("nodes")
    .select("id, workspace_id, created_by, created_at, data")
    .eq("object_type", "support_ticket").eq("id", id).maybeSingle();   // cross-workspace: platform gate is the scope
  return data ? { ...data, data: (data.data ?? {}) as TicketData } as TicketNode : null;
}

/** workspace_id → name, for triage context. */
async function workspaceNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("workspaces").select("id, name").in("id", ids);
  return new Map((data ?? []).map((w) => [String(w.id), String(w.name ?? "Workspace")]));
}

// GET /platform/support/tickets?status= — every workspace's tickets, newest activity first.
router.get("/tickets", zValidator("query", z.object({ status: z.enum(SUPPORT_STATUSES).optional() })), async (c) => {
  const { data } = await supabase.from("nodes")
    .select("id, workspace_id, created_by, created_at, data")
    .eq("object_type", "support_ticket")                               // cross-workspace by design (see header)
    .order("created_at", { ascending: false }).limit(500);
  const status = c.req.valid("query").status;
  const rows = ((data ?? []) as TicketNode[])
    .map((n) => ({ ...n, data: (n.data ?? {}) as TicketData }))
    .filter((n) => !status || n.data.status === status);
  const wsNames = await workspaceNames([...new Set(rows.map((r) => r.workspace_id))]);
  const now = Date.now();
  const tickets = rows.map((n) => {
    const comments = n.data.comments ?? [];
    // "Answered" means SUPPORT replied, not that the thread has messages. A requester adding three
    // follow-ups because nobody responded is the opposite of answered, and sorting by last activity
    // pushed exactly those tickets to the top as though they were being handled.
    // Both non-customer roles count. This router writes "mondaily" (see the reply handler below)
    // while the workspace router writes "admin", so checking only "admin" meant every ticket
    // answered from THIS dashboard stayed "unanswered" forever — the SLA number measured the wrong
    // thing and got worse the more replies we sent. Anything that is not the requester is a reply.
    const answered = comments.some((cm) => cm.author_role !== "requester");
    // "waiting_on_user" is deliberately NOT counted: the ball is with the customer, so counting it
    // as our unanswered time would inflate the number and hide the tickets we actually owe.
    const open = n.data.status === "open" || n.data.status === "in_review";
    return {
      id: n.id, workspace_id: n.workspace_id, workspace_name: wsNames.get(n.workspace_id) ?? "Workspace",
      subject: n.data.subject, category: n.data.category, status: n.data.status,
      created_at: n.created_at, last_updated: n.data.updated_at ?? n.created_at,
      comment_count: comments.length,
      answered,
      // Hours the requester has been waiting with no support reply. The service number.
      waiting_hours: open && !answered
        ? Math.floor((now - new Date(n.created_at).getTime()) / 3_600_000)
        : null,
    };
  }).sort((a, b) => {
    // UNANSWERED AND OLDEST FIRST. Sorting by last activity buried the person nobody has replied
    // to under every ticket that had recent chatter — the queue looked busy while someone waited.
    if (a.waiting_hours != null && b.waiting_hours != null) return b.waiting_hours - a.waiting_hours;
    if (a.waiting_hours != null) return -1;
    if (b.waiting_hours != null) return 1;
    return new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime();
  });

  const waiting = tickets.filter((t) => t.waiting_hours != null);
  return c.json({
    tickets,
    sla: {
      unanswered: waiting.length,
      // The oldest unanswered ticket is the one that defines your service, not the average.
      longest_wait_hours: waiting.length ? waiting[0]!.waiting_hours : 0,
    },
  });
});

// GET /platform/support/tickets/:id — full detail incl. thread + workspace context.
router.get("/tickets/:id", async (c) => {
  const t = await getTicketAnywhere(c.req.param("id"));
  if (!t) return c.json({ error: "Ticket not found." }, 404);
  const wsNames = await workspaceNames([t.workspace_id]);
  return c.json({
    id: t.id, workspace_id: t.workspace_id, workspace_name: wsNames.get(t.workspace_id) ?? "Workspace",
    subject: t.data.subject, message: t.data.message, category: t.data.category, status: t.data.status,
    created_by: t.created_by, created_at: t.created_at,
    comments: t.data.comments ?? [], status_history: t.data.status_history ?? [],
  });
});

// PATCH /platform/support/tickets/:id — THE status handler (moved here from the workspace route,
// which now always refuses). Records history + notifies the requester in their workspace.
router.patch("/tickets/:id", zValidator("json", z.object({ status: z.enum(SUPPORT_STATUSES) })), async (c) => {
  const userId = c.get("userId");
  const t = await getTicketAnywhere(c.req.param("id"));
  if (!t) return c.json({ error: "Ticket not found." }, 404);
  const now = new Date().toISOString();
  const nextStatus = c.req.valid("json").status;
  const updated: TicketData = {
    ...t.data, status: nextStatus, updated_at: now,
    status_history: [...(t.data.status_history ?? []), { status: nextStatus, at: now, by: `platform:${userId}` }],
    // Moving TO waiting_on_user starts the reminder clock from now, and clears any reminders sent
    // during an earlier wait — otherwise a ticket that went waiting → answered → waiting again
    // would skip straight to its closing warning on a question the customer only just received.
    ...(nextStatus === "waiting_on_user"
      ? { waiting_since: now, reminders_sent: [] }
      : { waiting_since: undefined, reminders_sent: undefined }),
  };
  const { error } = await supabase.from("nodes").update({ data: updated })
    .eq("workspace_id", t.workspace_id).eq("id", t.id).eq("object_type", "support_ticket");
  if (error) return c.json({ error: "Could not update the ticket." }, 500);
  if (t.created_by) {
    await createNotification({
      workspace_id: t.workspace_id, user_id: t.created_by, type: "support",
      title: `Support request ${nextStatus.replace(/_/g, " ")}: ${t.data.subject}`,
      body: `Mondaily support set your request to ${nextStatus.replace(/_/g, " ")}.`,
      metadata: { support_ticket_id: t.id, status: nextStatus },
    }).catch(() => false);
  }

  // EMAIL ONLY THE TWO TRANSITIONS THE CUSTOMER MUST ACT ON OR CARE ABOUT. An in-app notification
  // is enough for in_review; mailing every internal state change trains people to ignore us.
  const to = requesterOf(t);
  if (to) {
    const info = { id: t.id, subject: t.data.subject };
    if (nextStatus === "waiting_on_user") {
      const lastReply = [...(t.data.comments ?? [])].reverse().find((cm) => cm.author_role !== "requester");
      // The ask IS our last reply. Sending "we need something from you" without saying what would
      // make the email an obstacle rather than a prompt.
      await mailWaitingOnUser(to, info, lastReply?.body ?? "Could you send us a little more detail so we can carry on?");
    } else if (nextStatus === "resolved") {
      await mailResolved(to, info, [...(t.data.comments ?? [])].reverse().find((cm) => cm.author_role !== "requester")?.body);
    }
  }
  return c.json({ id: t.id, status: nextStatus, last_updated: now });
});

// POST /platform/support/tickets/:id/comments — reply AS Mondaily support (author_role "mondaily").
router.post("/tickets/:id/comments", zValidator("json", z.object({ body: z.string().min(1).max(8000) })), async (c) => {
  const userId = c.get("userId");
  const t = await getTicketAnywhere(c.req.param("id"));
  if (!t) return c.json({ error: "Ticket not found." }, 404);
  const now = new Date().toISOString();
  const comment: TicketComment = { author_id: `platform:${userId}`, author_role: "mondaily", body: c.req.valid("json").body, at: now };
  const updated: TicketData = { ...t.data, updated_at: now, comments: [...(t.data.comments ?? []), comment] };
  const { error } = await supabase.from("nodes").update({ data: updated })
    .eq("workspace_id", t.workspace_id).eq("id", t.id).eq("object_type", "support_ticket");
  if (error) return c.json({ error: "Could not post the reply." }, 500);
  if (t.created_by) {
    await createNotification({
      workspace_id: t.workspace_id, user_id: t.created_by, type: "support",
      title: `Mondaily support replied: ${t.data.subject}`,
      body: comment.body.slice(0, 140),
      metadata: { support_ticket_id: t.id },
    }).catch(() => false);
  }
  // The reply travels IN the email. Making someone log in to read two sentences is the difference
  // between support that feels answered and support that feels like a ticketing system.
  const to = requesterOf(t);
  if (to) await mailSupportReplied(to, { id: t.id, subject: t.data.subject }, { author: "Mondaily support", body: comment.body, at: now });
  return c.json({ ok: true, comment });
});

/**
 * GET /platform/support/signups — who has actually joined.
 *
 * Written because I advised "watch the panel for your first 20 signups" and then checked: no such
 * panel existed. Support lists tickets; nothing listed workspaces, so at a public launch there was
 * no way to see how many people signed up, let alone whether they got through onboarding.
 *
 * ONBOARDING COMPLETION IS THE COLUMN THAT MATTERS. Signup never reached onboarding at all until it
 * was fixed today, and the symptom was invisible from the inside: the account worked, it simply had
 * no trial, no profile and no starter tasks. A row here that stays `onboarded: false` is that bug
 * returning, and it would otherwise be silent again.
 *
 * Cross-workspace by design — the platform-admin gate above IS the scope.
 */
router.get("/signups", zValidator("query", z.object({
  days: z.coerce.number().min(1).max(90).default(14),
  limit: z.coerce.number().min(1).max(200).default(100),
})), async (c) => {
  const { days, limit } = c.req.valid("query");
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: rows, error } = await supabase
    .from("workspaces")
    .select("id, name, created_at, onboarded, plan, deleted_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return c.json({ error: error.message }, 500);

  const ids = (rows ?? []).map(r => String(r.id));
  // Member counts in ONE query — a per-row lookup would be N+1 and would slow down exactly when
  // signups are healthy, which is the worst time for the dashboard to crawl.
  const counts = new Map<string, number>();
  // The owner's email, so an operator can tell a real person who got stuck from an automated
  // signup. Without it, twelve un-onboarded workspaces are indistinguishable from twelve bots —
  // and the response to those two is completely different.
  const owners = new Map<string, string>();
  if (ids.length) {
    const { data: mem } = await supabase.from("workspace_members")
      .select("workspace_id, email, role, created_at").in("workspace_id", ids)
      .order("created_at", { ascending: true });
    for (const m of mem ?? []) {
      const k = String(m.workspace_id);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!owners.has(k) && m.email) owners.set(k, String(m.email));
    }
  }

  const signups = (rows ?? []).map(r => ({
    workspace_id: r.id,
    name: r.name,
    created_at: r.created_at,
    onboarded: r.onboarded === true,
    plan: r.plan ?? null,
    members: counts.get(String(r.id)) ?? 0,
    owner_email: owners.get(String(r.id)) ?? null,
    deleted: r.deleted_at != null,
  }));

  const live = signups.filter(s => !s.deleted);
  return c.json({
    days,
    signups,
    summary: {
      total: live.length,
      onboarded: live.filter(s => s.onboarded).length,
      // The number to watch. Persistent stragglers mean onboarding is not being reached.
      not_onboarded: live.filter(s => !s.onboarded).length,
      deleted: signups.length - live.length,
    },
  });
});

export { router as platformSupportRouter };
