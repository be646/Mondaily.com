import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "./routes/dashboard/layout";
import { HomePage } from "./routes/dashboard/home";
import { AskPage } from "./routes/dashboard/ask/[threadId]";
import { ObjectIndexPage } from "./routes/dashboard/objects/[objectType]/index";
import { RecordDetailPage } from "./routes/dashboard/objects/[objectType]/[recordId]";
import { PlaceholderPage } from "./routes/placeholder";
import { SignInPage } from "./routes/auth/sign-in";
import { SignUpPage } from "./routes/auth/sign-up";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard/home" replace />} />
      <Route path="/auth/sign-in" element={<SignInPage />} />
      <Route path="/auth/sign-up" element={<SignUpPage />} />
      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route path="home" element={<HomePage />} />
        <Route path="notifications" element={<PlaceholderPage title="Notifications" />} />
        <Route path="tasks" element={<PlaceholderPage title="Tasks" />} />
        <Route path="notes" element={<PlaceholderPage title="Notes" />} />
        <Route path="emails" element={<PlaceholderPage title="Emails" />} />
        <Route path="calls" element={<PlaceholderPage title="Calls" />} />
        <Route path="reports" element={<PlaceholderPage title="Reports" />} />
        <Route path="automations" element={<PlaceholderPage title="Automations" />} />
        <Route path="ask/:threadId" element={<AskPage />} />
        <Route path="objects/:objectType" element={<ObjectIndexPage />} />
        <Route path="objects/:objectType/:recordId" element={<RecordDetailPage />} />
        <Route path="settings/*" element={<PlaceholderPage title="Settings" />} />
      </Route>
    </Routes>
  );
}

