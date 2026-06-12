import { Show } from "@clerk/react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { SignInPage } from "./routes/auth/sign-in";
import { SignUpPage } from "./routes/auth/sign-up";
import { WorkspaceSelectPage } from "./routes/auth/workspace-select";
import { InviteAcceptPage } from "./routes/auth/invite-accept";
import { OnboardingLayout } from "./routes/onboarding/onboarding-layout";
import { StepProfile } from "./routes/onboarding/step-profile";
import { StepWorkspace } from "./routes/onboarding/step-workspace";
import { StepConnectEmail } from "./routes/onboarding/step-connect-email";
import { StepInvite } from "./routes/onboarding/step-invite";
import { StepImport } from "./routes/onboarding/step-import";
import { StepPlan } from "./routes/onboarding/step-plan";
import { DashboardLayout } from "./routes/dashboard/layout";
import { HomePage } from "./routes/dashboard/home";
import { NotificationsPage } from "./routes/dashboard/notifications";
import { TasksPage } from "./routes/dashboard/tasks";
import { NotesPage } from "./routes/dashboard/notes";
import { EmailsPage } from "./routes/dashboard/emails";
import { CallsPage } from "./routes/dashboard/calls";
import { CallDetailPage } from "./routes/dashboard/call-detail";
import { ReportsPage } from "./routes/dashboard/reports";
import { DashboardViewPage } from "./routes/dashboard/reports/dashboard-view";
import { ReportBuilderPage } from "./routes/dashboard/reports/report-builder";
import { AutomationsPage } from "./routes/dashboard/automations";
import { WorkflowBuilderPage } from "./routes/dashboard/automations/workflow-builder";
import { SequenceBuilderPage } from "./routes/dashboard/automations/sequence-builder";
import { AskPage } from "./routes/dashboard/ask/[threadId]";
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

function ProtectedRoute({ children }: { children: ReactNode }) {
  return <Show when="signed-in" fallback={<Navigate to="/sign-in" replace />}>{children}</Show>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route path="/workspaces" element={<WorkspaceSelectPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="/onboarding" element={<ProtectedRoute><OnboardingLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="profile" replace />} />
        <Route path="profile" element={<StepProfile />} />
        <Route path="workspace" element={<StepWorkspace />} />
        <Route path="connect-email" element={<StepConnectEmail />} />
        <Route path="invite" element={<StepInvite />} />
        <Route path="import" element={<StepImport />} />
        <Route path="plan" element={<StepPlan />} />
      </Route>
      <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="emails" element={<EmailsPage />} />
        <Route path="calls" element={<CallsPage />} />
        <Route path="calls/:id" element={<CallDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/dashboards/:id" element={<DashboardViewPage />} />
        <Route path="reports/:id" element={<ReportBuilderPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="automations/workflows/:id" element={<WorkflowBuilderPage />} />
        <Route path="automations/sequences/:id" element={<SequenceBuilderPage />} />
        <Route path="ask/:threadId?" element={<AskPage />} />
        <Route path="objects/:objectType" element={<ObjectIndexPage />} />
        <Route path="objects/:objectType/:recordId" element={<RecordDetailPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="lists/:listId" element={<ListPage />} />
        <Route path="search" element={<SearchPage />} />
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
