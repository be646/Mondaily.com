import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { WorkspaceDiagnostic } from "./components/workspace-diagnostic";
import { RouteThinking } from "./components/ui/page-state";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ShadowLoginPage } from "./routes/auth/shadow-login";
import { ShadowActivatePage } from "./routes/auth/shadow-activate";
import { ShadowRegisterPage } from "./routes/auth/shadow-register";
import { ShadowForgotPage } from "./routes/auth/shadow-forgot";
import { ShadowResetPage } from "./routes/auth/shadow-reset";
import { WorkspaceSelectPage } from "./routes/auth/workspace-select";
import { InviteAcceptPage } from "./routes/auth/invite-accept";
import { VerifyEmailPage } from "./routes/auth/verify-email";
import { TerminalOnboardingPage } from "./routes/onboarding/terminal-console";
import { DashboardLayout } from "./routes/dashboard/layout";
import { HomePage } from "./routes/dashboard/home";
import { StatusPage } from "./routes/dashboard/status";
import { NotificationsPage } from "./routes/dashboard/notifications";
import { AgentActivityPage } from "./routes/dashboard/activity";
const TeamOversightPage = lazy(() => import("./routes/dashboard/team-oversight").then(m => ({ default: m.TeamOversightPage })));
const MessagesPage = lazy(() => import("./routes/dashboard/messages").then(m => ({ default: m.MessagesPage })));
const TasksPage = lazy(() => import("./routes/dashboard/tasks").then(m => ({ default: m.TasksPage })));
const NotesPage = lazy(() => import("./routes/dashboard/notes").then(m => ({ default: m.NotesPage })));
const EmailsPage = lazy(() => import("./routes/dashboard/emails").then(m => ({ default: m.EmailsPage })));
const CallsPage = lazy(() => import("./routes/dashboard/calls").then(m => ({ default: m.CallsPage })));
const CalendarPage = lazy(() => import("./routes/dashboard/calendar").then(m => ({ default: m.CalendarPage })));
const CallRoomDispatch = lazy(() => import("./routes/dashboard/call-room").then(m => ({ default: m.CallRoomDispatch })));
const ReportsPage = lazy(() => import("./routes/dashboard/reports").then(m => ({ default: m.ReportsPage })));
const DashboardViewPage = lazy(() => import("./routes/dashboard/reports/dashboard-view").then(m => ({ default: m.DashboardViewPage })));
const ReportBuilderPage = lazy(() => import("./routes/dashboard/reports/report-builder").then(m => ({ default: m.ReportBuilderPage })));
const SalesReportPage = lazy(() => import("./routes/dashboard/reports/sales-report").then(m => ({ default: m.SalesReportPage })));
const AutomationsPage = lazy(() => import("./routes/dashboard/automations").then(m => ({ default: m.AutomationsPage })));
const WorkflowBuilderPage = lazy(() => import("./routes/dashboard/automations/workflow-builder").then(m => ({ default: m.WorkflowBuilderPage })));
const SequenceBuilderPage = lazy(() => import("./routes/dashboard/automations/sequence-builder").then(m => ({ default: m.SequenceBuilderPage })));
import { AskPage } from "./routes/dashboard/ask/[threadId]";
const CanvasPage = lazy(() => import("./routes/dashboard/canvas"));
const ObjectIndexPage = lazy(() => import("./routes/dashboard/objects/[objectType]/index").then(m => ({ default: m.ObjectIndexPage })));
const PipelinePage = lazy(() => import("./routes/dashboard/pipeline").then(m => ({ default: m.PipelinePage })));
const RecordDetailPage = lazy(() => import("./routes/dashboard/objects/[objectType]/[recordId]").then(m => ({ default: m.RecordDetailPage })));
import { SettingsLayout } from "./routes/dashboard/settings/layout";
import { AccountSettings } from "./routes/dashboard/settings/account";
import { WorkspaceSettings } from "./routes/dashboard/settings/workspace";
import { MembersSettings } from "./routes/dashboard/settings/members";
import { BillingSettings } from "./routes/dashboard/settings/billing";
import { ObjectsSettings } from "./routes/dashboard/settings/objects";
import { SupportSettings } from "./routes/dashboard/settings/support";
import { CallsSettings } from "./routes/dashboard/settings/calls";
import { IntegrationsSettings } from "./routes/dashboard/settings/integrations";
import { EmailSettings } from "./routes/dashboard/settings/email";
import { SecuritySettings } from "./routes/dashboard/settings/security";
import { TrainingSettings } from "./routes/dashboard/settings/training";
import { AskMondailySettings } from "./routes/dashboard/settings/ask-mondaily";
import { AIControlRoomSettings } from "./routes/dashboard/settings/ai-control-room";
const ListPage = lazy(() => import("./routes/dashboard/lists/[listId]").then(m => ({ default: m.ListPage })));
const SearchPage = lazy(() => import("./routes/dashboard/search").then(m => ({ default: m.SearchPage })));
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
  const { isSignedIn, isLoaded, workspaceId } = useCurrentUser();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/auth/shadow-login" replace />;
  // Fresh signup (bootstrap returned is_new=true) runs the conversational onboarding console first.
  // The console clears this flag AND hard-redirects, so there's no SPA loop-back. Kept before the
  // workspace check so a brand-new user still flows seamlessly into onboarding.
  if (localStorage.getItem("mondaily_needs_onboarding") === "1") {
    localStorage.removeItem("mondaily_needs_onboarding");
    return <Navigate to="/onboarding" replace />;
  }
  // A valid 36-char workspace UUID → normal path, render the dashboard.
  const hasWorkspace = typeof workspaceId === "string" && workspaceId.length === 36;
  if (!hasWorkspace) return <WorkspaceDiagnostic />;
  return <>{children}</>;
}

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
      {/* Sovereign Auth — native cookie session (the sole auth runtime) */}
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
        <Route path="activity" element={<AgentActivityPage />} />
        <Route path="team/oversight" element={<TeamOversightPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="emails" element={<EmailsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="calls" element={<CallsPage />} />
        {/* /calls/:id dispatches: a calendar-event id → the live Mondaily call room; else the call record. */}
        <Route path="calls/:id" element={<CallRoomDispatch />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/sales" element={<SalesReportPage />} />
        <Route path="reports/dashboards/:id" element={<DashboardViewPage />} />
        <Route path="reports/:id" element={<ReportBuilderPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="automations/workflows/:id" element={<WorkflowBuilderPage />} />
        <Route path="automations/sequences/:id" element={<SequenceBuilderPage />} />
        <Route path="ask/:threadId?" element={<AskPage />} />
        <Route path="objects/:objectType" element={<ObjectIndexPage />} />
        <Route path="objects/:objectType/:recordId" element={<RecordDetailPage />} />
        <Route path="pipeline" element={<Navigate to="/objects/deals?view=board" replace />} />
        <Route path="canvas" element={<CanvasPage />} />
        <Route path="lists/:listId" element={<ListPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="finance/invoices" element={<InvoicesPage />} />
        <Route path="finance/invoices/:invoiceId" element={<InvoiceDetailPage />} />
        <Route path="finance/credit-notes" element={<CreditNotesPage />} />
        <Route path="finance/credit-notes/:creditNoteId" element={<CreditNoteDetailPage />} />
        <Route path="finance/reports" element={<FinanceReportsPage />} />
        <Route path="finance/quotes" element={<QuotesPage />} />
        <Route path="finance/expenses" element={<ExpensesPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="decisions" element={<DecisionsPage />} />
        <Route path="discovery" element={<DiscoveryPage />} />
        {/* Mondaily-internal (PLATFORM_ADMIN_EMAILS): page self-gates via the capability probe; API is hard-gated. */}
        <Route path="platform/support" element={<PlatformSupportPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="account" replace />} />
          <Route path="account" element={<AccountSettings />} />
          <Route path="workspace" element={<WorkspaceSettings />} />
          <Route path="members" element={<MembersSettings />} />
          <Route path="billing" element={<BillingSettings />} />
          <Route path="objects" element={<ObjectsSettings />} />
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
