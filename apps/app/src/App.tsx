import type { ReactNode } from "react";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { SovereignAuthProvider } from "./components/auth/sovereign-auth-context";
import { ShadowLoginPage } from "./routes/auth/shadow-login";
import { ShadowActivatePage } from "./routes/auth/shadow-activate";
import { SignInPage } from "./routes/auth/sign-in";
import { SignUpPage } from "./routes/auth/sign-up";
import { WorkspaceSelectPage } from "./routes/auth/workspace-select";
import { InviteAcceptPage } from "./routes/auth/invite-accept";
import { SsoCallbackPage } from "./routes/auth/sso-callback";
import { OnboardingLayout } from "./routes/onboarding/onboarding-layout";
import { StepProfile } from "./routes/onboarding/step-profile";
import { StepWorkspace } from "./routes/onboarding/step-workspace";
import { StepConnectEmail } from "./routes/onboarding/step-connect-email";
import { StepInvite } from "./routes/onboarding/step-invite";
import { StepImport } from "./routes/onboarding/step-import";
import { StepPlan } from "./routes/onboarding/step-plan";
import { OnboardingPage } from "./routes/onboarding";
import { DashboardLayout } from "./routes/dashboard/layout";
import { HomePage } from "./routes/dashboard/home";
import { StatusPage } from "./routes/dashboard/status";
import { NotificationsPage } from "./routes/dashboard/notifications";
import { AgentActivityPage } from "./routes/dashboard/activity";
import { TeamOversightPage } from "./routes/dashboard/team-oversight";
import { TasksPage } from "./routes/dashboard/tasks";
import { NotesPage } from "./routes/dashboard/notes";
import { EmailsPage } from "./routes/dashboard/emails";
import { CallsPage } from "./routes/dashboard/calls";
import { CallDetailPage } from "./routes/dashboard/call-detail";
import { ReportsPage } from "./routes/dashboard/reports";
import { DashboardViewPage } from "./routes/dashboard/reports/dashboard-view";
import { ReportBuilderPage } from "./routes/dashboard/reports/report-builder";
import { SalesReportPage } from "./routes/dashboard/reports/sales-report";
import { AutomationsPage } from "./routes/dashboard/automations";
import { WorkflowBuilderPage } from "./routes/dashboard/automations/workflow-builder";
import { SequenceBuilderPage } from "./routes/dashboard/automations/sequence-builder";
import { AskPage } from "./routes/dashboard/ask/[threadId]";
import CanvasPage from "./routes/dashboard/canvas";
import { ObjectIndexPage } from "./routes/dashboard/objects/[objectType]/index";
import { PipelinePage } from "./routes/dashboard/pipeline";
import { RecordDetailPage } from "./routes/dashboard/objects/[objectType]/[recordId]";
import { SettingsLayout } from "./routes/dashboard/settings/layout";
import { AccountSettings } from "./routes/dashboard/settings/account";
import { WorkspaceSettings } from "./routes/dashboard/settings/workspace";
import { MembersSettings } from "./routes/dashboard/settings/members";
import { BillingSettings } from "./routes/dashboard/settings/billing";
import { ObjectsSettings } from "./routes/dashboard/settings/objects";
import { IntegrationsSettings } from "./routes/dashboard/settings/integrations";
import { EmailSettings } from "./routes/dashboard/settings/email";
import { SecuritySettings } from "./routes/dashboard/settings/security";
import { AskMondailySettings } from "./routes/dashboard/settings/ask-mondaily";
import { ListPage } from "./routes/dashboard/lists/[listId]";
import { SearchPage } from "./routes/dashboard/search";
import { InvoicesPage } from "./routes/dashboard/finance/invoices";
import { InvoiceDetailPage } from "./routes/dashboard/finance/[invoiceId]";
import { CreditNotesPage } from "./routes/dashboard/finance/credit-notes";
import { CreditNoteDetailPage } from "./routes/dashboard/finance/[creditNoteId]";
import { ApprovalsPage } from "./routes/dashboard/approvals";
import { DecisionsPage } from "./routes/dashboard/decisions";
import { DiscoveryPage } from "./routes/dashboard/discovery";
import { FinanceReportsPage } from "./routes/dashboard/finance/reports";
import { QuotesPage } from "./routes/dashboard/finance/quotes";
import { ExpensesPage } from "./routes/dashboard/finance/expenses";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useCurrentUser();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

// Redirects signed-in users to onboarding only if they have no Supabase workspace UUID yet.
// AuthGate in main.tsx is responsible for resolving and storing this UUID via bootstrap.
function DashboardRoute({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded, workspaceId } = useCurrentUser();
  const location = useLocation();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  const hasWorkspace = typeof workspaceId === "string" && workspaceId.length === 36;
  if (!hasWorkspace) return <Navigate to="/onboarding/profile" replace state={{ from: location }} />;
  // New users (bootstrap returned is_new=true) go through onboarding before the dashboard
  if (localStorage.getItem("mondaily_needs_onboarding") === "1") {
    localStorage.removeItem("mondaily_needs_onboarding");
    return <Navigate to="/onboarding/profile" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route path="/workspaces" element={<WorkspaceSelectPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="/sso-callback" element={<SsoCallbackPage />} />
      {/* Sovereign Auth (shadow mode) — native cookie session, runs alongside Clerk */}
      <Route path="/auth" element={<SovereignAuthProvider><Outlet /></SovereignAuthProvider>}>
        <Route path="shadow-login" element={<ShadowLoginPage />} />
        <Route path="shadow-activate" element={<ShadowActivatePage />} />
      </Route>
      <Route path="/onboarding-setup" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
      <Route path="/onboarding" element={<ProtectedRoute><OnboardingLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="profile" replace />} />
        <Route path="profile" element={<StepProfile />} />
        <Route path="workspace" element={<StepWorkspace />} />
        <Route path="connect-email" element={<StepConnectEmail />} />
        <Route path="invite" element={<StepInvite />} />
        <Route path="import" element={<StepImport />} />
        <Route path="plan" element={<StepPlan />} />
      </Route>
      <Route path="/" element={<DashboardRoute><DashboardLayout /></DashboardRoute>}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="activity" element={<AgentActivityPage />} />
        <Route path="team/oversight" element={<TeamOversightPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="emails" element={<EmailsPage />} />
        <Route path="calls" element={<CallsPage />} />
        <Route path="calls/:id" element={<CallDetailPage />} />
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
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="account" replace />} />
          <Route path="account" element={<AccountSettings />} />
          <Route path="workspace" element={<WorkspaceSettings />} />
          <Route path="members" element={<MembersSettings />} />
          <Route path="billing" element={<BillingSettings />} />
          <Route path="objects" element={<ObjectsSettings />} />
          <Route path="integrations" element={<IntegrationsSettings />} />
          <Route path="email" element={<EmailSettings />} />
          <Route path="security" element={<SecuritySettings />} />
          <Route path="ask-mondaily" element={<AskMondailySettings />} />
        </Route>
      </Route>
      <Route path="/dashboard/*" element={<Navigate to="/home" replace />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
