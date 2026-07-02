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

## Sovereignty note — sovereign-first architecture
Mondaily is **sovereign-first**, not "100% sovereign" in the absolute sense. Precisely:

- **AI inference** runs on a private AI gateway (Cerebras via `AI_GATEWAY_*`). There is **no** silent
  fallback to Anthropic/OpenAI — if the gateway env is missing, AI features report "Needs env"
  rather than routing to a proprietary provider.
- **Web search** (Discovery, Prospecting, enrichment, Ask web search) routes through the self-hosted
  sovereign search appliance (SearXNG + scraper, `SOVEREIGN_SEARCH_URL`). **Tavily has been fully
  removed** — no third-party search API is called anywhere.
- **Workspace data** is isolated: every AI request is workspace-scoped and can't read another
  workspace's data.
- **Google / Outlook** are **optional, client-authorized connectors** — not core AI infrastructure
  and not a sovereignty failure. Email/calendar data is accessed only after a user connects an
  account, stays workspace-scoped, is never used for AI training unless explicitly approved, and can
  be disconnected at any time. (Direct Google/Microsoft OAuth — no Nylas middleman.)
- **Stripe** is a **payment processor / payment rail**, not AI or data infrastructure. Mondaily never
  stores card numbers (they live with Stripe), billing metadata is workspace-scoped, and AI tools
  can't access raw card/payment data.

**Full "100% sovereign" would additionally require self-hosted/private inference and search to be
configured.** Until self-hosted inference is live, describe the current state as **sovereign-first**.
