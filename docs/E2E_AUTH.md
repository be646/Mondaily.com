# Authenticated e2e — test account & safe run guide

The Playwright suite runs against **production** (`app.mondaily.com`). The **public** project needs no
credentials; the **authenticated** project runs only when a dedicated test account is provided, and is
**read-only** by default. No credentials or session state live in the repo.

## Commands
```bash
pnpm e2e          # public smoke + safety guards (no creds needed)
pnpm e2e:auth     # also runs the authenticated smoke (requires the env vars below)
```

## Required env vars
| Var | Required | Purpose |
|-----|----------|---------|
| `MONDAILY_TEST_EMAIL` | for `e2e:auth` | dedicated test account email (shadow-login) |
| `MONDAILY_TEST_PASSWORD` | for `e2e:auth` | its password |
| `TEST_ALLOW_MUTATIONS` | never in prod | opt-in for write/mutation suites; **leave unset** against production |

Without the first two, `auth.setup.ts` and `app.smoke.spec.ts` **honestly skip** (never a fake pass).
`TEST_ALLOW_MUTATIONS` gates any future mutation suite (`mutationSuite` in `e2e/_safety.ts`); unset ⇒
those suites skip, so e2e can never send email / take payment / run agents against production.

## Test account & workspace
- Use a **dedicated OWNER of a disposable test workspace** — never a real customer or a shared login.
  - **Owner (not low-privilege)** is required because the smoke visits admin-gated reads:
    `/settings/billing`, `/team/oversight`, `/settings/workspace`. A viewer/member would bounce or
    render empty on those, causing false failures. Owner of an **isolated** workspace keeps blast
    radius to that throwaway workspace only.
- The account should belong to **exactly one** workspace (the test one) so `/auth/workspace-select`
  isn't hit on login.
- Keep it on the **free Scout** tier (or an internal comp) — the smoke never triggers checkout.

## Useful seed data (optional — smoke passes on empty states too)
The route-load smoke only asserts each page renders its own label (empty states already contain the
words), so seeding is optional. For richer coverage add a little:
- 2–3 **tasks** (one overdue) → `/tasks`, `/home`
- 1 **contact/company** and 1 **deal** → Graph, `/discovery` saved leads
- 1 **calendar event** (today) → `/calendar`
- 1 **decision** in the queue → `/decisions`
- 1 **support ticket** (already valid) → `/settings/support`
Do NOT seed via the live UI during a run; seed once, out of band, in the test workspace.

## What the authenticated smoke safely checks (read-only)
For each of Home, **Ask**, Tasks, Calendar, **Inbox**, **Decisions**, **Discovery**, Activity,
Reports, Finance, **Team Oversight**, **Billing**, **Support**, Workspace:
- the route loads while still authenticated (no bounce to `/auth/shadow-login`),
- the page shows its real content (a route-specific text match),
- there are **no uncaught page errors**, and
- **no side-effecting request fires during load** — enforced by `attachReadOnlyGuard` (fails on any
  POST/PUT/PATCH/DELETE to a money/mail/ticket/agent/bulk endpoint; see `SIDE_EFFECT_RE`).

Requirement-6 surfaces covered: Home ✓ Billing ✓ Discovery ✓ **Support ✓** **Ask ✓** Inbox ✓
Calendar ✓ Decisions ✓.

## What it intentionally skips / avoids
- **No writes**: never clicks Send / Subscribe / Complete checkout / Create ticket / Save leads /
  Run agent. Those paths are on the read-only denylist and would fail the guard if triggered.
- **No real emails, payments, or agent runs** against production.
- **Mutation suites** are skipped unless `TEST_ALLOW_MUTATIONS=1` (intended only on a disposable,
  non-prod target).
- Authenticated suite **skips entirely** without `MONDAILY_TEST_EMAIL`/`PASSWORD`.

## Session state
`auth.setup.ts` signs in via the real shadow-login UI and writes `e2e/.auth/state.json`
(git-ignored). Credentials come only from env; nothing sensitive is committed.
