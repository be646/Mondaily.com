import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { createNotification } from "../lib/notify";

/**
 * Proactive daily brief — a sovereign, in-house morning summary. Once a day it
 * compiles each workspace's real state (overdue/open tasks, pending decisions,
 * records touched in the last 24h) and posts an in-app notification (the bell),
 * nudging the user to open the full brief in chat. Purely data-driven (counts) —
 * no AI call, so it never consumes the inference rate limit at scale.
 */
export const dailyBrief = inngest.createFunction(
  { id: "daily-brief", name: "Daily brief notification", concurrency: { limit: 4 } },
  { cron: "0 7 * * *" }, // 07:00 UTC, every day
  async () => {
    const { data: workspaces } = await supabase.from("workspaces").select("id");
    if (!workspaces?.length) return { briefs_posted: 0 };

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    let posted = 0;

    for (const ws of workspaces) {
      const wsId = ws.id as string;
      try {
        const { data: tasks } = await supabase
          .from("tasks").select("completed, due_date, status").eq("workspace_id", wsId);
        const active = (tasks ?? []).filter(t => !t.completed && t.status !== "done");
        const openCount = active.length;
        const overdue = active.filter(t => t.due_date && new Date(t.due_date) < now).length;

        const { count: pending } = await supabase
          .from("decision_queue").select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId).eq("status", "pending");

        const { count: recent } = await supabase
          .from("nodes").select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId).gte("updated_at", dayAgo);

        const pendingN = pending ?? 0;
        const recentN = recent ?? 0;

        // Nothing to say → skip (don't spam an empty workspace).
        if (overdue === 0 && openCount === 0 && pendingN === 0 && recentN === 0) continue;

        const parts: string[] = [];
        if (overdue > 0) parts.push(`${overdue} overdue task${overdue === 1 ? "" : "s"}`);
        if (openCount > 0) parts.push(`${openCount} open task${openCount === 1 ? "" : "s"}`);
        if (pendingN > 0) parts.push(`${pendingN} pending decision${pendingN === 1 ? "" : "s"}`);
        if (recentN > 0) parts.push(`${recentN} record${recentN === 1 ? "" : "s"} updated`);

        await createNotification({
          workspace_id: wsId,
          type: "daily_brief",
          title: "☀️ Your daily brief",
          body: `Today: ${parts.join(" · ")}. Ask "what should I focus on today?" for the full picture.`,
          metadata: { overdue, open: openCount, pending_decisions: pendingN, recent_records: recentN },
          source: { source_agent: "insights", route: "/home" },
        });
        posted++;
      } catch (e) {
        console.error(`[daily-brief] workspace ${wsId} failed (non-fatal):`, e instanceof Error ? e.message : String(e));
      }
    }
    return { briefs_posted: posted };
  },
);
