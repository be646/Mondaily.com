import { GuestCallPage } from "./routes/guest-call";
import { WorkspaceSelectPage } from "./routes/auth/workspace-select";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { WorkspaceDiagnostic } from "./components/workspace-diagnostic";
import { RouteThinking } from "./components/ui/page-state";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ShadowLoginPage } from "./routes/auth/shadow-login";
import { ShadowRegisterPage } from "./routes/auth/shadow-register";
import { DashboardLayout } from "./routes/dashboard/layout";
import { HomePage } from "./routes/dashboard/home";
const StatusPage = lazy(() => import("./routes/dashboard/status").then(m => ({ default: m.StatusPage })));
const NotificationsPage = lazy(() => import("./routes/dashboard/notifications").then(m => ({ default: m.NotificationsPage })));
const AgentActivityPage = lazy(() => import("./routes/dashboard/activity").then(m => ({ default: m.AgentActivityPage })));
const TeamOversightPage = lazy(() => import("./routes/dashboard/team-oversight").then(m => ({ default: m.TeamOversightPage })));
const MessagesPage = lazy(() => import("./routes/dashboard/messages").then(m => ({ default: m.MessagesPage })));
const TasksPage = lazy(() => import("./routes/dashboard/tasks").then(m => ({ default: m.TasksPage })));
const NotesPage = lazy(() => import("./routes/dashboard/notes").then(m => ({ default: m.NotesPage })));
const EmailsPage = lazy(() => import("./routes/dashboard/emails").then(m => ({ default: m.EmailsPage })));
const CallsPage = lazy(() => import("./routes/dashboard/calls").then(m => ({ default: m.CallsPage })));
const CalendarPage = lazy(() => import("./routes/dashboard/calendar").then(m => ({ default: m.CalendarPage })));
const CallRoomDispatch = lazy(() => import("./routes/dashboard/call-room").then(m => ({ default: m.CallRoomDispatch })));
const ReportsPage = lazy(() => import("./routes/dashboard/reports").then(m => ({ default: m.ReportsPage })));
const InsightsPage = lazy(() => import("./routes/dashboard/insights").then(m => ({ default: m.InsightsPage })));
const BriefingPage = lazy(() => import("./routes/dashboard/briefing").then(m => ({ default: m.BriefingPage })));
const OwnerConsolePage = lazy(() => import("./routes/dashboard/owner-console").then(m => ({ default: m.OwnerConsolePage })));
const GoalsPage = lazy(() => import("./routes/dashboard/goals").then(m => ({ default: m.GoalsPage })));
const DashboardViewPage = lazy(() => import("./routes/dashboard/reports/dashboard-view").then(m => ({ default: m.DashboardViewPage })));
const ReportBuilderPage = lazy(() => import("./routes/dashboard/reports/report-builder").then(m => ({ default: m.ReportBuilderPage })));
const SalesReportPage = lazy(() => import("./routes/dashboard/reports/sales-report").then(m => ({ default: m.SalesReportPage })));
const AutomationsPage = lazy(() => import("./routes/dashboard/automations").then(m => ({ default: m.AutomationsPage })));
const WorkflowBuilderPage = lazy(() => import("./routes/dashboard/automations/workflow-builder").then(m => ({ default: m.WorkflowBuilderPage })));
const SequenceBuilderPage = lazy(() => import("./routes/dashboard/automations/sequence-builder").then(m => ({ default: m.SequenceBuilderPage })));
const AskPage = lazy(() => import("./routes/dashboard/ask/[threadId]").then(m => ({ default: m.AskPage })));
const CanvasPage = lazy(() => import("./routes/dashboard/canvas"));
const ObjectIndexPage = lazy(() => import("./routes/dashboard/objects/[objectType]/index").then(m => ({ default: m.ObjectIndexPage })));
// PipelinePage is NOT imported: `pipeline` is a redirect to /objects/deals?view=board, so the
// component was lazy-loaded into the bundle and rendered by nothing. The file is left on disk
// — it is a working page, just unrouted — but it no longer costs a chunk. Delete it or restore
// the route deliberately; do not re-add this import to "fix" the unused file.
const RecordDetailPage = lazy(() => import("./routes/dashboard/objects/[objectType]/[recordId]").then(m => ({ default: m.RecordDetailPage })));
// SettingsLayout stays static — it's the stable settings shell/nav. The individual settings pages are
// lazy-loaded so their code (and settings/email's Tiptap editor → the ~304 kB vendor-editor chunk) no
// longer sits in the eager first-paint graph. Same lazy()+Suspense pattern as the other heavy routes.
import { SettingsLayout } from "./routes/dashboard/settings/layout";
const AccountSettings = lazy(() => import("./routes/dashboard/settings/account").then(m => ({ default: m.AccountSettings })));
const WorkspaceSettings = lazy(() => import("./routes/dashboard/settings/workspace").then(m => ({ default: m.WorkspaceSettings })));
const MembersSettings = lazy(() => import("./routes/dashboard/settings/members").then(m => ({ default: m.MembersSettings })));
const BillingSettings = lazy(() => import("./routes/dashboard/settings/billing").then(m => ({ default: m.BillingSettings })));
const ObjectsSettings = lazy(() => import("./routes/dashboard/settings/objects").then(m => ({ default: m.ObjectsSettings })));
const DataHealthSettings = lazy(() => import("./routes/dashboard/settings/data-health").then(m => ({ default: m.DataHealthSettings })));
const SupportSettings = lazy(() => import("./routes/dashboard/settings/support").then(m => ({ default: m.SupportSettings })));
const CallsSettings = lazy(() => import("./routes/dashboard/settings/calls").then(m => ({ default: m.CallsSettings })));
const IntegrationsSettings = lazy(() => import("./routes/dashboard/settings/integrations").then(m => ({ default: m.IntegrationsSettings })));
const EmailSettings = lazy(() => import("./routes/dashboard/settings/email").then(m => ({ default: m.EmailSettings })));
const SecuritySettings = lazy(() => import("./routes/dashboard/settings/security").then(m => ({ default: m.SecuritySettings })));
const TrainingSettings = lazy(() => import("./routes/dashboard/settings/training").then(m => ({ default: m.TrainingSettings })));
const AskMondailySettings = lazy(() => import("./routes/dashboard/settings/ask-mondaily").then(m => ({ default: m.AskMondailySettings })));
const AIControlRoomSettings = lazy(() => import("./routes/dashboard/settings/ai-control-room").then(m => ({ default: m.AIControlRoomSettings })));
const ListPage = lazy(() => import("./routes/dashboard/lists/[listId]").then(m => ({ default: m.ListPage })));
const SearchPage = lazy(() => import("./routes/dashboard/search").then(m => ({ default: m.SearchPage })));
const FinanceShell = lazy(() => import("./routes/dashboard/finance/shell").then(m => ({ default: m.FinanceShell })));
const CommsShell = lazy(() => import("./routes/dashboard/group-shells").then(m => ({ default: m.CommsShell })));
const AiShell = lazy(() => import("./routes/dashboard/group-shells").then(m => ({ default: m.AiShell })));
const AnalyticsShell = lazy(() => import("./routes/dashboard/group-shells").then(m => ({ default: m.AnalyticsShell })));
const InvoicesPage = lazy(() => import("./routes/dashboard/finance/invoices").then(m => ({ default: m.InvoicesPage })));
const InvoiceDetailPage = lazy(() => import("./routes/dashboard/finance/[invoiceId]").then(m => ({ default: m.InvoiceDetailPage })));
const CreditNotesPage = lazy(() => import("./routes/dashboard/finance/credit-notes").then(m => ({ default: m.CreditNotesPage })));
const CreditNoteDetailPage = lazy(() => import("./routes/dashboard/finance/[creditNoteId]").then(m => ({ default: m.CreditNoteDetailPage })));
const ApprovalsPage = lazy(() => import("./routes/dashboard/approvals").then(m => ({ default: m.ApprovalsPage })));
const DecisionsPage = lazy(() => import("./routes/dashboard/decisions").then(m => ({ default: m.DecisionsPage })));
const DiscoveryPage = lazy(() => import("./routes/dashboard/discovery").then(m => ({ default: m.DiscoveryPage })));
const PlatformSupportPage = lazy(() => import("./routes/dashboard/platform-support").then(m => ({ default: m.PlatformSupportPage })));
// Lazy: the ONLY recharts consumer — keeps the ~400KB charting lib out of the main chunk.
const FinanceReportsPage = lazy(() => import("./routes/dashboard/finance/reports").then(m => ({ default: m.FinanceReportsPage })));
const QuotesPage = lazy(() => import("./routes/dashboard/finance/quotes").then(m => ({ default: m.QuotesPage })));
const ExpensesPage = lazy(() => import("./routes/dashboard/finance/expenses").then(m => ({ default: m.ExpensesPage })));

// Plain <Navigate to="/x" /> drops the query string — this preserves it, so a marketing link like
// /sign-up?plan=operator survives the legacy-path redirect instead of losing the plan selection.
function RedirectKeepingQuery({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useCurrentUser();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/auth/shadow-login" replace />;
  return <>{children}</>;
}

// Gates the dashboard. Normal working users (valid workspace id) pass straight through untouched.
// When workspace data genuinely can't resolve, we show the WorkspaceDiagnostic instead of silently
// dumping the user into onboarding or an empty Home.
function DashboardRoute({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded, workspaceId, onboarded } = useCurrentUser();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/auth/shadow-login" replace />;
  // Fresh signup (bootstrap returned is_new=true) runs the conversational onboarding console first.
  // The console clears this flag AND hard-redirects, so there's no SPA loop-back. Kept before the
  // workspace check so a brand-new user still flows seamlessly into onboarding.
  // The SERVER decides. The localStorage flag only made the very first hop faster; on its own it
  // meant that closing the tab mid-onboarding — or signing in from another device — dropped the
  // user onto an empty dashboard with `workspaces.onboarded` still false forever: no trial
  // stamped, no profile, no starter tasks, and no way back.
  if (localStorage.getItem("mondaily_needs_onboarding") === "1") {
    localStorage.removeItem("mondaily_needs_onboarding");
    return <Navigate to="/onboarding" replace />;
  }
  if (onboarded === false) return <Navigate to="/onboarding" replace />;
  // A valid 36-char workspace UUID → normal path, render the dashboard.
  const hasWorkspace = typeof workspaceId === "string" && workspaceId.length === 36;
  if (!hasWorkspace) return <WorkspaceDiagnostic />;
  return <>{children}</>;
}


// ── Rarely-loaded routes are lazy ───────────────────────────────────────────────
// Guest calls, invite acceptance, workspace restore, email verification, activation,
// forgot/reset password and onboarding are pages most sessions never open. Shipping them
// in the main chunk made every user download them to reach the dashboard. Login, register,
// the dashboard layout and Home stay EAGER — they are the hot paths, and a lazy chunk there
// would add a round-trip to the first impression.
//
// GuestCallPage and WorkspaceSelectPage are exempt for a reason that is easy to miss: a guest
// clicking a call link lands DIRECTLY on GuestCallPage — it is their first paint, and a lazy
// chunk delays joining a live call — and WorkspaceSelectPage renders immediately after login for
// multi-workspace users. Both were already pinned static by the calls-readiness tests.
const RestoreWorkspacePage = lazy(() => import("./routes/restore-workspace").then(m => ({ default: m.RestoreWorkspacePage })));
const ShadowActivatePage = lazy(() => import("./routes/auth/shadow-activate").then(m => ({ default: m.ShadowActivatePage })));
const ShadowForgotPage = lazy(() => import("./routes/auth/shadow-forgot").then(m => ({ default: m.ShadowForgotPage })));
const ShadowResetPage = lazy(() => import("./routes/auth/shadow-reset").then(m => ({ default: m.ShadowResetPage })));
const InviteAcceptPage = lazy(() => import("./routes/auth/invite-accept").then(m => ({ default: m.InviteAcceptPage })));
const VerifyEmailPage = lazy(() => import("./routes/auth/verify-email").then(m => ({ default: m.VerifyEmailPage })));
const TerminalOnboardingPage = lazy(() => import("./routes/onboarding/terminal-console").then(m => ({ default: m.TerminalOnboardingPage })));

export function App() {
  return (
    // One Suspense boundary for the lazy-loaded heavy routes (calendar, discovery, reports,
    // builders, canvas, call room, record detail) — first visit shows a quiet inline loader.
    // Wrapped in an ErrorBoundary so a stale-chunk load (after a deploy) auto-recovers instead of
    // stranding the user on a "reload" screen.
    <ErrorBoundary>
    <Suspense fallback={<RouteThinking />}>
    <Routes>
      {/* Legacy Clerk auth paths → native login */}
      <Route path="/sign-in/*" element={<RedirectKeepingQuery to="/auth/shadow-login" />} />
      <Route path="/sign-up/*" element={<RedirectKeepingQuery to="/auth/register" />} />
      <Route path="/sso-callback" element={<Navigate to="/auth/shadow-login" replace />} />
      <Route path="/workspaces" element={<WorkspaceSelectPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      {/* PUBLIC guest call — no account; token rides in the URL fragment. Standalone (no dashboard). */}
      <Route path="/join/:eventId" element={<GuestCallPage />} />
      {/* Sovereign Auth — native cookie session (the sole auth runtime) */}
      <Route path="/restore" element={<RestoreWorkspacePage />} />
      <Route path="/auth" element={<Outlet />}>
        <Route path="shadow-login" element={<ShadowLoginPage />} />
        <Route path="register" element={<ShadowRegisterPage />} />
        <Route path="shadow-activate" element={<ShadowActivatePage />} />
        <Route path="forgot" element={<ShadowForgotPage />} />
        <Route path="reset" element={<ShadowResetPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
      </Route>
      {/* Conversational AI Onboarding Console — single canonical path, no nested step router
          (the old multi-step OnboardingLayout was the source of the loop-back defect). */}
      <Route path="/onboarding" element={<ProtectedRoute><TerminalOnboardingPage /></ProtectedRoute>} />
      <Route path="/onboarding/welcome" element={<Navigate to="/onboarding" replace />} />
      <Route path="/" element={<DashboardRoute><DashboardLayout /></DashboardRoute>}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        {/* AI Center shell — Agents · Decisions · Goals · Discovery · Automations. */}
        <Route element={<AiShell />}>
          <Route path="activity" element={<AgentActivityPage />} />
          <Route path="decisions" element={<DecisionsPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="discovery" element={<DiscoveryPage />} />
          <Route path="automations" element={<AutomationsPage />} />
        </Route>
        {/* Analytics shell — Reports · Insights · Team; the immersive builders stay outside. */}
        <Route element={<AnalyticsShell />}>
          <Route path="reports" element={<ReportsPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="team/oversight" element={<TeamOversightPage />} />
        </Route>
        {/* Comms shell — Inbox · Emails · Calls share one tab strip; URLs unchanged. */}
        <Route element={<CommsShell />}>
          <Route path="messages" element={<MessagesPage />} />
          <Route path="emails" element={<EmailsPage />} />
          <Route path="calls" element={<CallsPage />} />
        </Route>
        <Route path="tasks" element={<TasksPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        {/* /calls/:id dispatches: a calendar-event id → the live Mondaily call room; else the call record. */}
        <Route path="calls/:id" element={<CallRoomDispatch />} />
        <Route path="briefing" element={<BriefingPage />} />
        <Route path="console" element={<OwnerConsolePage />} />
        <Route path="reports/sales" element={<SalesReportPage />} />
        <Route path="reports/dashboards/:id" element={<DashboardViewPage />} />
        <Route path="reports/:id" element={<ReportBuilderPage />} />
        <Route path="automations/workflows/:id" element={<WorkflowBuilderPage />} />
        <Route path="automations/sequences/:id" element={<SequenceBuilderPage />} />
        <Route path="ask/:threadId?" element={<AskPage />} />
        <Route path="objects/:objectType" element={<ObjectIndexPage />} />
        <Route path="objects/:objectType/:recordId" element={<RecordDetailPage />} />
        <Route path="pipeline" element={<Navigate to="/objects/deals?view=board" replace />} />
        <Route path="canvas" element={<CanvasPage />} />
        <Route path="lists/:listId" element={<ListPage />} />
        <Route path="search" element={<SearchPage />} />
        {/* Finance — ONE tab shell over six surfaces. The pages are unchanged; the shell adds the
            strip and the URL space. /approvals redirects in so old links keep working. */}
        <Route path="finance" element={<FinanceShell />}>
          <Route index element={<Navigate to="/finance/invoices" replace />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="invoices/:invoiceId" element={<InvoiceDetailPage />} />
          <Route path="credit-notes" element={<CreditNotesPage />} />
          <Route path="credit-notes/:creditNoteId" element={<CreditNoteDetailPage />} />
          <Route path="reports" element={<FinanceReportsPage />} />
          <Route path="quotes" element={<QuotesPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
        </Route>
        <Route path="approvals" element={<Navigate to="/finance/approvals" replace />} />
        {/* Mondaily-internal (PLATFORM_ADMIN_EMAILS): page self-gates via the capability probe; API is hard-gated. */}
        <Route path="platform/support" element={<PlatformSupportPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="account" replace />} />
          <Route path="account" element={<AccountSettings />} />
          <Route path="workspace" element={<WorkspaceSettings />} />
          <Route path="members" element={<MembersSettings />} />
          <Route path="billing" element={<BillingSettings />} />
          <Route path="objects" element={<ObjectsSettings />} />
          <Route path="data-health" element={<DataHealthSettings />} />
          <Route path="integrations" element={<IntegrationsSettings />} />
          <Route path="email" element={<EmailSettings />} />
          <Route path="calls" element={<CallsSettings />} />
          <Route path="security" element={<SecuritySettings />} />
          <Route path="ask-mondaily" element={<AskMondailySettings />} />
          <Route path="ai-control-room" element={<AIControlRoomSettings />} />
          <Route path="training" element={<TrainingSettings />} />
          <Route path="support" element={<SupportSettings />} />
        </Route>
      </Route>
      <Route path="/dashboard/*" element={<Navigate to="/home" replace />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
