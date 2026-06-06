import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { nodesRouter } from "./routes/nodes";
import { searchRouter } from "./routes/search";
import { askRouter } from "./routes/ask";
import { agentsRouter } from "./routes/agents";
import { activitiesRouter } from "./routes/activities";
import { webhooksRouter } from "./routes/webhooks";

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

app.get("/api/health", (c) => c.json({ ok: true, version: "1.0.0" }));

export default app;

