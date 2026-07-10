# Mondaily QA smoke checklist

Run on app.mondaily.com after every significant deploy. The app is auth-gated, so this is a
manual (or future authenticated-Playwright) pass — each item is a concrete click path with the
expected honest result. **Any "fake" observation (fabricated score, fake running status, wrong
count) is a P1.**

Automated gates that must ALREADY be green before this list (CI/local):
`turbo run typecheck build --force` · `vitest run` in packages/api (666+) ·
`scripts/audit/sovereignty-audit.sh` · `scripts/audit/workspace-isolation-scan.mjs`
(43 documented false positives, see script header — any NEW flag needs review).

Automated e2e (Playwright, runs against production):
- `pnpm e2e` — public smoke, no credentials: landing render/plans/CTA, all same-site links
  resolve, SEO meta, login page render + unauthenticated redirect, API health commit.
- `MONDAILY_TEST_EMAIL=… MONDAILY_TEST_PASSWORD=… pnpm e2e:auth` — additionally signs in via
  the real login UI and verifies every core route loads authenticated with no uncaught errors
  (sections 2–14 route-load layer). Use a dedicated low-privilege test account. Without creds
  the authenticated suite reports SKIPPED, never a fake pass.

## 1 · Landing (mondaily.com)
- [ ] Every nav link + footer link resolves (no 404); language selector switches copy.
- [ ] Pricing shows localized currency; switcher appears ONLY when local currency ∉ {USD, EUR, GBP}.
- [ ] All CTAs land on signup/pricing/docs; marketing chat answers plans/features/sovereignty via API proxy (Network tab: no AI key in web requests).
- [ ] Simulated demos are labeled as simulations; no fake "live" claims.

## 2 · Shell & routes
- [ ] Every sidebar route renders (Home, Ask, Graph sections, Tasks, Calendar, Inbox, Discovery, Decisions, Automations, Finance ×5, Reports, Notes, Emails, Calls, Team Oversight, Activity, Settings ×all).
- [ ] Light + dark theme (and paper/daylight/rose) readable on: Decisions, Finance Reports, Tasks, Calendar.
- [ ] No bright saturated colors anywhere — matte palette only (green #5f8169 / amber #97824f / rose #9c6b72 / slate #717784).

## 3 · Ask + agents (proof-of-work standard)
- [ ] Ask answers a workspace question with sources, or says it has insufficient data — never invents.
- [ ] Activity (Agent Control Room): thin LIVE header; every completed job shows structured steps with timestamps + sources; "Run now" produces a real job with steps; nothing shows "running" without a live job.
- [ ] Agent identity/icons consistent everywhere (single registry).

## 4 · Discovery
- [ ] Search returns source-backed results with match reasons; missing fields shown honestly.
- [ ] Save lead → appears in Graph (no duplicate on re-save). Add-to-list, create-task, send-to-Decision-Queue each work and cross-link.
- [ ] Deep mode / monitors understandable; empty + error states are compact and honest.

## 5 · Decisions
- [ ] Filters are compact dropdowns + chips; counts correct; list dense but scannable.
- [ ] Dossier shows evidence, exact transformation, audit trail; approve / reject / snooze all work.
- [ ] Bulk approval requires clear confirmation; null confidence shows "source-backed", never a made-up %.
- [ ] Notification deep-link opens the specific decision.

## 6 · Calendar + calls
- [ ] Week/day time-grid renders with hour rail + now-line; clicking a slot opens New Meeting pre-filled; month drag moves a non-recurring event.
- [ ] Today's Brief items click through to the meeting; Meeting Brief shows real agenda/attendees/AI prep with sources.
- [ ] Mondaily call link joins the room (or an honest 503 "not configured" when LiveKit env is absent). No provider branding. Recording/transcript only appear when actually produced.

## 7 · Inbox (member chat)
- [ ] Send / read / delete a 1:1 message; unread badge updates; empty state offers a compose CTA.
- [ ] AI draft is a draft only — never auto-sends.

## 8 · Finance + currency
- [ ] Invoices/Quotes/Expenses/Credit Notes: create → edit → status transitions work; totals convert to display currency with "at ECB rate" disclosure; currency dropdowns show the full 25-currency set; new records default to workspace base currency.
- [ ] Finance Reports: charts render (lazy chunk loads), mixed-currency banner honest when rates missing.

## 9 · Billing
- [ ] Plan prices match packages/shared/src/pricing.ts on landing + onboarding + billing; localized billing currency; switcher rule (only when local ∉ big-3).
- [ ] Credits never display negative; trial banner disappears after activation; pack bonuses (+10/20%, annual +10%) displayed.
- [ ] Buy credits opens Stripe checkout; subscribe uses embedded Payment Element; auto-refill toggle does not claim active without a saved card.

## 10 · Support
- [ ] Help chat persists across navigation AND reload; diagnoses (route, plan, credits, gateway status) before offering a ticket; ticket only on explicit escalation.
- [ ] Workspace users can NOT change ticket status (platform dashboard only).

## 11 · Team Oversight
- [ ] Loads for owner/admin only; member row expands inline (click toggles open/close); metrics real (AI credits match usage); Print report works; AI efficiency review generates grounded output or declines on insufficient data.

## 12 · Security spot-checks (after any API change)
- [ ] POST /api/v1/status/log as a normal user → 403.
- [ ] Prospecting run with a foreign destination_list_id → no entries created in the foreign list.
- [ ] Reaction on a foreign commentId via own task → 404.
