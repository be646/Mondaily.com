import { inngest } from "../lib/inngest";
import { startJob, completeJob, failJob } from "../lib/agent-logger";
import { supabase } from "@mondaily/db/client";

// Runs daily at 2am — scores every contact/company per workspace
export const relationshipHealth = inngest.createFunction(
  { id: "crm-relationship-health", name: "CRM: Relationship Health Scoring", concurrency: { limit: 1 } },
  { cron: "0 2 * * *" },
  async () => {
    const { data: workspaces } = await supabase.from("workspaces").select("id");
    if (!workspaces?.length) return { processed: 0 };

    let totalScored = 0;

    for (const ws of workspaces) {
      const jobId = await startJob({
        workspace_id: ws.id,
        agent_name: "relationship_health",
        trigger_type: "scheduled",
        input: { workspace_id: ws.id },
      });

      try {
        const { data: contacts } = await supabase
          .from("nodes")
          .select("id, data")
          .eq("workspace_id", ws.id)
          .in("object_type", ["contact", "person", "lead", "company", "account"]);

        if (!contacts?.length) {
          await completeJob(jobId, { scored: 0 }, []);
          continue;
        }

        for (const contact of contacts) {
          const signals: Record<string, unknown> = {};
          let score = 50; // baseline

          // Signal 1: days since last contact
          const lastContact = contact.data?.last_contacted_at ?? contact.data?.last_contact;
          if (lastContact) {
            const days = Math.floor((Date.now() - new Date(lastContact).getTime()) / 86400000);
            signals.days_since_contact = days;
            if (days <= 7)  score += 25;
            else if (days <= 30) score += 10;
            else if (days <= 90) score -= 10;
            else score -= 25;
          } else {
            signals.days_since_contact = null;
            score -= 15;
          }

          // Signal 2: open tasks
          const { count: openTasks } = await supabase
            .from("nodes")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ws.id)
            .eq("object_type", "task")
            .eq("data->>status", "todo")
            .eq("data->>record_id", contact.id);
          signals.open_tasks = openTasks ?? 0;
          if ((openTasks ?? 0) > 3) score -= 10;

          // Signal 3: open deals
          const { count: openDeals } = await supabase
            .from("nodes")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", ws.id)
            .eq("object_type", "deal")
            .not("data->>stage", "in", '("closed_won","closed_lost")')
            .eq("data->>contact_id", contact.id);
          signals.open_deals = openDeals ?? 0;
          if ((openDeals ?? 0) > 0) score += 15;

          // Signal 4: recent activity
          const { count: recentActivity } = await supabase
            .from("activities")
            .select("id", { count: "exact", head: true })
            .eq("node_id", contact.id)
            .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
          signals.recent_activity_30d = recentActivity ?? 0;
          if ((recentActivity ?? 0) >= 5) score += 15;
          else if ((recentActivity ?? 0) >= 2) score += 5;
          else if ((recentActivity ?? 0) === 0) score -= 10;

          const finalScore = Math.max(0, Math.min(100, score));

          await supabase
            .from("nodes")
            .update({
              relationship_health: finalScore,
              health_updated_at: new Date().toISOString(),
              health_signals: signals,
            })
            .eq("id", contact.id);

          totalScored++;
        }

        await completeJob(jobId, { scored: contacts.length }, []);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await failJob(jobId, msg);
      }
    }

    return { total_scored: totalScored };
  },
);
