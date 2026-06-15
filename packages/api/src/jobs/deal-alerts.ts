import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { startJob, completeJob, failJob } from "../lib/agent-logger";

export const dealAlerts = inngest.createFunction(
  { id: "crm-deal-alerts", name: "CRM: Deal Alerts", concurrency: { limit: 2 } },
  { cron: "0 8 * * *" }, // 8am daily
  async () => {
    const jobId = await startJob({
      workspace_id: "system",
      agent_name: "deal_alerts",
      trigger_type: "schedule",
      input: {},
      node_ids: [],
    });

    try {
      const { data: workspaces } = await supabase.from("workspaces").select("id");
      let totalAlerts = 0;

      for (const ws of workspaces ?? []) {
        const { data: deals } = await supabase
          .from("nodes")
          .select("id, data, updated_at")
          .eq("workspace_id", ws.id)
          .ilike("object_type", "%deal%");

        for (const deal of deals ?? []) {
          const data = deal.data as Record<string, unknown>;
          const stage = String(data.stage ?? data.status ?? "").toLowerCase();
          if (["won", "lost", "closed"].some(s => stage.includes(s))) continue;

          const lastActivity = new Date(deal.updated_at);
          const daysInactive = Math.floor((Date.now() - lastActivity.getTime()) / 86400000);

          if (daysInactive >= 14) {
            // Check if alert already exists and not dismissed
            const { data: existing } = await supabase
              .from("deal_alerts")
              .select("id")
              .eq("node_id", deal.id)
              .eq("alert_type", "cold_deal")
              .is("dismissed_at", null)
              .single();

            if (!existing) {
              await supabase.from("deal_alerts").insert({
                workspace_id: ws.id,
                node_id: deal.id,
                alert_type: "cold_deal",
                days_inactive: daysInactive,
              });

              await supabase.from("notifications").insert({
                workspace_id: ws.id,
                type: "alert",
                title: "🥶 Cold deal detected",
                body: `"${data.name ?? data.title ?? "Deal"}" has had no activity for ${daysInactive} days`,
                metadata: { node_id: deal.id, days_inactive: daysInactive },
              });

              totalAlerts++;
            }
          }
        }
      }

      await completeJob(jobId, { alerts_created: totalAlerts }, []);
      return { alerts_created: totalAlerts };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await failJob(jobId, msg);
      throw err;
    }
  },
);
