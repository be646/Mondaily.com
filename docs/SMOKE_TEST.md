# Mondaily smoke test checklist

Minimal manual pass before a release. Run against the deployed app (app.mondaily.com) or a local
dev server. Each step lists the expected result; anything else is a bug. Tick every box before ship.

## 1. Auth + onboarding (fresh user)
- [ ] `/auth/register` — create an account with a new email → lands on onboarding, no error.
- [ ] Onboarding console runs (survey → AI analysis → plan select) → lands on `/home`.
- [ ] A chosen marketing plan (`/sign-up?plan=operator`) is honored in onboarding.

## 2. Auth (existing user)
- [ ] `/auth/shadow-login` with valid credentials → `/home`, workspace resolves.
- [ ] Wrong password 6× → lockout message (15 min).
- [ ] Reload `/home` → still signed in (cookie session), no bounce to login.

## 3. Home control room
- [ ] Greeting + telemetry strip (open tasks / unread) render with real counts.
- [ ] Attention stream: decisions show inline with Approve / Dismiss / Snooze visible (no double-click).
- [ ] Approve a decision → row confirms + slides out; count drops.
- [ ] Agent Constellation grid shows real state + last-run time per agent.
- [ ] Pulse tiles show real 14-day sparklines.
- [ ] Meetings card: "Connect Google/Outlook" buttons open the OAuth popup (or real events if connected).

## 4. Ask Mondaily
- [ ] Ask "what changed this week" → streamed answer with source cards.
- [ ] Follow-up question retains thread context.
- [ ] An action chip (e.g. create task) performs a real action.

## 5. Tasks
- [ ] Create a task from the Home task box → appears in list, overdue-sorted.
- [ ] Assign to a member → assignee notified.
- [ ] Open task detail → edit + save persists.

## 6. Lists
- [ ] Create a list → header shows name, object badge, aligned actions.
- [ ] Add / remove a record → count updates.
- [ ] Assign + share dropdowns open and apply.
- [ ] Export CSV downloads.

## 7. Discovery / Prospecting
- [ ] `/discovery` search (e.g. "aesthetic clinics London") → live agent feed streams stages.
- [ ] Results render Google-style with golden confidence bars + source links.
- [ ] AI overview panel appears; every result has a real source URL (no invented leads).
- [ ] "Add as lead" creates a People record; "Watch this search" adds a monitor.
- [ ] Deep mode toggle runs the contact-harvest pass.

## 8. Finance
- [ ] `/finance/invoices` — create an invoice, totals compute.
- [ ] `/finance/reports` renders.
- [ ] Overdue invoice → Finance Agent can queue a chase in the Decision Queue.

## 9. Agents
- [ ] Run-now on a runnable agent (Relationship / Finance / etc.) → returns a real summary.
- [ ] Disabled/not-configured agents render honestly (dashed, no fake state).

## 10. Workspace Readiness (`/status`)
- [ ] Live system status lists each env check with real operational/needs-setup state.
- [ ] Feature reality matrix + agent capability board render.
- [ ] Migrations section reflects real applied/not-applied.

## 11. Landing (apps/web)
- [ ] Nav links + mobile menu work; all anchors resolve.
- [ ] Pricing tiers match `lib/plans.ts` (Scout/Operator/Command/Sovereign).
- [ ] CTA links reach the app sign-up.

## Isolation guard (do not skip)
- [ ] Sign in as workspace A, note a record id; sign in as workspace B → that id is NOT accessible
      via any detail route or API call (404, never another workspace's data).
