import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { nodesRouter } from "./routes/nodes";
import { searchRouter } from "./routes/search";
import { askRouter } from "./routes/ask";
import { agentsRouter } from "./routes/agents";
import { activitiesRouter } from "./routes/activities";
import { webhooksRouter } from "./routes/webhooks";
import { appDataRouter } from "./routes/app-data";
import { invitesRouter } from "./routes/invites";
import { notesRouter } from "./routes/notes";
import { emailsRouter } from "./routes/emails";
import { callsRouter } from "./routes/calls";
import { reportsRouter } from "./routes/reports";
import { dashboardsRouter } from "./routes/dashboards";
import { sequencesRouter } from "./routes/sequences";
import { listsRouter } from "./routes/lists";
import tasksRouter from "./routes/tasks";
import { chatsRouter } from "./routes/chats";
import { feedbackRouter } from "./routes/feedback";
import { membersRouter } from "./routes/members";
import { notificationsRouter } from "./routes/notifications";
import { taskReviewsRouter } from "./routes/task-reviews";
import { taskDetailsRouter } from "./routes/task-details";
import { importRouter } from "./routes/import";
import { generateRouter } from "./routes/generate";
import { digestsRouter } from "./routes/digests";
import { annotationsRouter } from "./routes/annotations";

const app = new Hono();

app.use("*", cors({
  origin: ["https://mondaily.com", "https://app.mondaily.com", "http://localhost:3000", "http://localhost:5173"],
  credentials: true
}));
app.use("*", logger());

app.route("/api/v1/import", importRouter);
app.route("/api/v1/generate", generateRouter);
app.route("/api/v1/nodes", nodesRouter);
app.route("/api/v1/search", searchRouter);
app.route("/api/v1/ask", askRouter);
app.route("/api/v1/agents", agentsRouter);
app.route("/api/v1/activities", activitiesRouter);
app.route("/api/v1/webhooks", webhooksRouter);
app.route("/api/v1/invites", invitesRouter);
app.route("/api/v1/notes", notesRouter);
app.route("/api/v1/emails", emailsRouter);
app.route("/api/v1/calls", callsRouter);
app.route("/api/v1/reports", reportsRouter);
app.route("/api/v1/dashboards", dashboardsRouter);
app.route("/api/v1/sequences", sequencesRouter);
app.route("/api/v1/lists", listsRouter);
app.route("/api/v1/chats", chatsRouter);
app.route("/api/v1/feedback", feedbackRouter);
app.route("/api/v1/members", membersRouter);
app.route("/api/v1/notifications", notificationsRouter);
app.route("/api/v1/tasks", taskReviewsRouter);
app.route("/api/v1/tasks", taskDetailsRouter);
app.route("/api/v1/tasks", tasksRouter);
app.route("/api/v1/digests", digestsRouter);
app.route("/api/v1/annotations", annotationsRouter);
app.route("/api/v1", appDataRouter);

app.get("/api/health", (c) => c.json({ ok: true, version: "1.0.0" }));

export default app;

import { serve } from '@hono/node-server'
const port = parseInt(process.env.PORT || '8787')
serve({ fetch: app.fetch, port }, () => {
  console.log(`Mondaily API running on port ${port}`)
})
