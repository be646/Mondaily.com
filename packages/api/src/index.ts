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

const app = new Hono();

app.use("*", cors({
  origin: ["https://mondaily.com", "https://app.mondaily.com", "http://localhost:3000", "http://localhost:5173"],
  credentials: true
}));
app.use("*", logger());

app.route("/api/v1/nodes", nodesRouter);
app.route("/api/v1/search", searchRouter);
app.route("/api/v1/ask", askRouter);
app.route("/api/v1/agents", agentsRouter);
app.route("/api/v1/activities", activitiesRouter);
app.route("/api/v1/webhooks", webhooksRouter);
app.route("/api/v1/invites", invitesRouter);
app.route("/api/v1/notes", notesRouter);
app.route("/api/v1/emails", emailsRouter);
app.route("/api/v1", appDataRouter);

app.get("/api/health", (c) => c.json({ ok: true, version: "1.0.0" }));

export default app;
