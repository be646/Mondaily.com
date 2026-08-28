import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Tabs } from "@/components/ui/tabs";
import { useDecisionQueue } from "../../components/ai/decision-queue";
import { useLanguage } from "../../hooks/useLanguage";

/**
 * GROUP SHELLS — the Finance-shell pattern extended to the three groups that are one job split
 * across pages. Each shell is a PATHLESS layout route: the child pages keep their exact URLs
 * (nothing redirects, no bookmark, notification link or agent-emitted href breaks) and render
 * unchanged through the Outlet; the shell adds one hairline row of tabs. That turned twelve
 * sidebar rows into three:
 *
 *   Comms      Inbox · Emails · Calls          (one communication job, three channels)
 *   AI Center  Agents · Decisions · Goals · Discovery · Automations
 *              (agents raise decisions, goals direct them, automations execute)
 *   Analytics  Reports · Insights · Team       (all three answer "how is it going")
 *
 * Full-screen children stay OUTSIDE their shell on purpose: the live call room (/calls/:id) and
 * the workflow/sequence/report builders are immersive surfaces, and a nav strip over a live call
 * would be chrome over someone's face.
 */
interface ShellTab { key: string; label: string; tkey?: string; path: string; count?: number }

function GroupShell({ tabs }: { tabs: readonly ShellTab[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const active = tabs.find(tab => location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`))?.key ?? tabs[0]!.key;
  return (
    <div>
      <div className="flex items-stretch px-4 sm:px-6">
        <Tabs
          className="min-w-0"
          items={tabs.map(tab => ({ id: tab.key, label: tab.tkey ? t(tab.tkey) : tab.label, count: tab.count }))}
          active={active}
          onChange={(id) => { const tab = tabs.find(x => x.key === id); if (tab) navigate(tab.path); }}
        />
        {/* Continue the tab underline across the full width — one hairline, same as Finance. */}
        <div className="flex-1 border-b border-[var(--border-soft)]" />
      </div>
      <Outlet />
    </div>
  );
}

export function CommsShell() {
  return <GroupShell tabs={[
    { key: "inbox", label: "Inbox", tkey: "nav.inbox", path: "/messages" },
    { key: "emails", label: "Emails", tkey: "nav.emails", path: "/emails" },
    { key: "calls", label: "Calls", tkey: "nav.calls", path: "/calls" },
  ]} />;
}

export function AiShell() {
  // Pending decisions badge the Decisions tab — approvals must never hide behind a tab silently.
  // Count only when known (query settled); unknown renders no badge, per the Tabs contract.
  const decisions = useDecisionQueue();
  const pending = decisions.data ? decisions.data.length : undefined;
  return <GroupShell tabs={[
    { key: "agents", label: "Agents", tkey: "nav.agents", path: "/activity" },
    { key: "decisions", label: "Decisions", tkey: "nav.decisions", path: "/decisions", count: pending },
    { key: "goals", label: "Goals", path: "/goals" },
    { key: "discovery", label: "Discovery", tkey: "nav.discovery", path: "/discovery" },
    { key: "automations", label: "Automations", tkey: "nav.automations", path: "/automations" },
  ]} />;
}

export function AnalyticsShell() {
  return <GroupShell tabs={[
    { key: "reports", label: "Reports", tkey: "nav.reports", path: "/reports" },
    { key: "insights", label: "Insights", path: "/insights" },
    { key: "team", label: "Team", tkey: "nav.team_oversight", path: "/team/oversight" },
  ]} />;
}
