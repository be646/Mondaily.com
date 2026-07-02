# Landing ↔ App Feature Parity

Every capability the landing page (apps/web) implies, mapped to its real state in the app.
Status legend: **Built** (works now) · **Needs env** (code complete, waiting on a server env var)
· **Partial** (works with caveats) · **Roadmap** (not built yet).

The in-app source of truth is the live **Workspace Readiness** page (`/status`), which audits most of
these against the running backend. This table is the landing-facing summary.

| Landing claim / feature | App state | Status | Notes |
|---|---|---|---|
| AI-native autonomous workspace | Home control room, agents, decision queue | **Built** | Agents prepare, you approve — no silent autonomous execution. |
| Ask Mondaily (chat over your graph) | `/home` Ask + `/ask` engine | **Built** | Thread memory, source cards, action chips — real tool calls. |
| Workspace Graph (records/contacts/deals) | `/objects/*`, sheets, board view | **Built** | Custom object types, segments, bulk actions. |
| Discovery — search the open web + social | `/discovery` + Prospecting Agent | **Needs env** | Live streaming, AI overview, deep contact-harvest, saved-search monitors. Needs `AI_GATEWAY_API_KEY` + `SOVEREIGN_SEARCH_URL`. |
| Enrichment of records | Inngest job + gpt-oss | **Needs env** | Same two env vars as Discovery. |
| Reports & forecasts | `/reports` rebuild (charts, forecast, AI insight) | **Built** | Real computed data; forecast is least-squares projection. |
| Finance & Billing module (invoices, quotes, expenses, credit notes) | `/finance/*` | **Built** | CRUD + chasing via Decision Queue approval. |
| Automations (trigger → condition → action) | `/automations` | **Built** | Real-time Inngest event triggers + daily cron backstop. |
| Email — Gmail + Outlook | Direct Google + Microsoft Graph OAuth | **Needs env** | Connect, read, reply, compose/send. Needs `GOOGLE_CLIENT_ID/SECRET` and/or `MICROSOFT_CLIENT_ID/SECRET`. |
| Calendar sync — Google + Outlook | Direct OAuth (read-only), events on Home | **Needs env** | One "Connect" grants mail + calendar. Same client id/secret. Google verification review gates >100 users. |
| Team Oversight / audit trail | `/team-oversight` | **Built** | Owner/admin only; full behavioral timeline. |
| Billing / subscriptions | Embedded Stripe Payment Element | **Needs env** | On-page card entry, subscriptions, webhook tier activation. Needs `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_OPERATOR/COMMAND_MONTH`, `STRIPE_WEBHOOK_SECRET`. |
| MCP / external AI client access | `/api/mcp` + per-workspace token | **Built** | Read-only graph access; key from Settings → Integrations. |
| Voice commands | Disabled mic in Ask | **Roadmap** | Shown as "coming soon", not claimed as working. |
| Native calendar-based meeting briefs | Meetings card | **Partial** | Real events render once calendar is connected; AI meeting briefs are roadmap. |

## Sovereignty note
No third-party integration middlemen. All AI runs on the sovereign Cerebras gateway; all web search
runs on the self-hosted SearXNG appliance; email/calendar use **direct** Google/Microsoft OAuth (no
Nylas). Absence of an env var = "Needs env", never a silent fallback to a third-party endpoint.
