import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { supabase } from "@mondaily/db/client";
import { grantAmountFor, burstCapFor, normalizeTierId, BURST_WINDOW_HOURS } from "@mondaily/shared/pricing";
import { maybeAutoRefill } from "./auto-refill";
import { getEntitlement } from "./entitlements";
import { isOwnerWorkspace } from "./owner";

export { BURST_WINDOW_HOURS };

/**
 * AI credit wallet (ai_credits_ledger). Balance = SUM(amount): grant/purchase add, usage subtracts.
 * The wallet is FLOORED AT ZERO — usage is clamped so a balance can never go negative (the -166k
 * bug), and enforcement fails CLOSED at zero across every AI path (see assertCreditsOk + the
 * gateway pre-flight). All amounts come from the shared pricing catalog — no hardcoded credits here.
 *
 * GRANDFATHERING: a workspace is only gated once ENROLLED (≥1 ledger row). Workspaces with no ledger
 * are never blocked, so this can't brick existing accounts while the feature rolls out.
 */

/** Raised when a workspace has no remaining credits / has hit its burst cap. Fails closed. */
export class CreditsExhaustedError extends Error {
  constructor(public readonly kind: "credits" | "burst", public readonly resetsAt: string | null, message: string) {
    super(message);
    this.name = "CreditsExhaustedError";
  }
}

/** Bring a workspace's balance up to EXACTLY its tier's allotment — grants only the shortfall
 *  (target - current), so calling twice is a no-op and it never stacks. */
export async function grantTierCredits(workspaceId: string, tier: string, description: string): Promise<void> {
  const target = grantAmountFor(normalizeTierId(tier));
  // Compare against GRANT rows only — never the wallet balance.
  //
  // Balance is grants + purchases − usage, so measuring against it made purchased credits pay for
  // the plan's included allotment: buy a 400k pack, then subscribe to Operator (1M included), and
  // the top-up computed 1M − 500k = 500k, quietly consuming the 400k the customer paid cash for.
  // It also re-granted spent credits, since usage pushes the balance back down.
  const { granted } = await ledgerBreakdown(workspaceId);
  const delta = target - granted;
  if (delta > 0) await grantCredits(workspaceId, delta, "grant", description);
}

async function resolveTier(workspaceId: string): Promise<string> {
  return (await getEntitlement(workspaceId)).tier;   // single source of truth
}

/**
 * RECONCILE included credits — bring a workspace's GRANT rows up to its resolved entitlement.
 *
 * This heals the class of bug behind the screenshot: a wallet whose grant rows were seeded at an old
 * value (e.g. the legacy 50k Scout seed) while the account was later entitled to Operator (1,000,000)
 * — so the "1M included" the UI advertised was never actually usable. We compare the sum of `grant`
 * rows to the tier's allotment and, if short, insert ONE top-up grant for exactly the shortfall.
 *
 * Idempotent: re-running computes a shortfall of ≤ 0 and inserts nothing. Never touches `purchase`
 * or `usage` rows, so purchased credits are always preserved and it can never double-grant.
 *
 * Pass `grantedSoFar` when the caller already has the ledger rows in hand (e.g. /credits/balance) to
 * avoid a redundant round-trip. Pass `enrollIfEmpty` on an ACTIVATION path (e.g. starting a trial)
 * so a workspace with no ledger yet gets its first grant instead of being skipped — read paths must
 * NOT set this (they must never enroll a workspace just by looking at it). Returns credits added.
 */
export async function reconcileIncludedCredits(
  workspaceId: string,
  opts: { grantedSoFar?: number; enrolled?: boolean; enrollIfEmpty?: boolean } = {},
): Promise<number> {
  const ent = await getEntitlement(workspaceId);
  const target = grantAmountFor(ent.tier);

  let granted = opts.grantedSoFar;
  let enrolled = opts.enrolled;
  if (granted === undefined || enrolled === undefined) {
    // Must be the exact grant total: a truncated sum would understate it and mint a bogus top-up
    // grant on every read, inflating the wallet without anyone buying anything.
    const b = await ledgerBreakdown(workspaceId);
    enrolled = b.enrolled;
    granted = b.granted;
  }
  if (!enrolled && !opts.enrollIfEmpty) return 0; // read paths never enroll a workspace by looking at it
  const shortfall = target - (granted ?? 0);
  if (shortfall <= 0) return 0;                  // already at/above entitlement — idempotent no-op
  await grantCredits(workspaceId, shortfall, "grant", `reconcile: included-credits top-up to ${ent.tier} entitlement`);
  return shortfall;
}

export interface LedgerBreakdown { enrolled: boolean; granted: number; purchased: number; used: number }

/**
 * THE one way to total the wallet. Never sum the ledger in JavaScript.
 *
 * A plain `.select("amount, transaction_type").eq("workspace_id", ws)` has no limit and no order, so
 * once a workspace exceeds PostgREST's max-rows cap it returns an ARBITRARY SUBSET — the totals then
 * vary between two identical reads (measured: `used` swinging 134,984 credits with no spend between
 * calls) and stop tracking real usage. Prefer the server-side aggregate; fall back to an explicitly
 * PAGED read so this is still exact on a deployment where the migration hasn't been applied yet.
 */
export async function ledgerBreakdown(workspaceId: string): Promise<LedgerBreakdown> {
  const { data, error } = await supabase.rpc("ai_credit_breakdown", { ws: workspaceId });
  const row = Array.isArray(data) ? data[0] : data;
  if (!error && row) {
    const entries = Number((row as { entries?: number }).entries ?? 0);
    return {
      enrolled: entries > 0,
      granted: Number((row as { granted?: number }).granted ?? 0),
      purchased: Number((row as { purchased?: number }).purchased ?? 0),
      used: Number((row as { used?: number }).used ?? 0),
    };
  }
  // Fallback: page through every row explicitly rather than trusting an unbounded select.
  const PAGE = 1000;
  let from = 0, granted = 0, purchased = 0, used = 0, entries = 0;
  for (;;) {
    const { data: page, error: pageErr } = await supabase
      .from("ai_credits_ledger").select("amount, transaction_type")
      .eq("workspace_id", workspaceId)
      .order("id", { ascending: true })          // stable order → pages can't overlap or skip
      .range(from, from + PAGE - 1);
    if (pageErr) return { enrolled: false, granted: 0, purchased: 0, used: 0 };  // never gate on a read failure
    const list = page ?? [];
    for (const r of list) {
      const amt = Number(r.amount) || 0;
      if (r.transaction_type === "grant") granted += amt;
      else if (r.transaction_type === "purchase") purchased += amt;
      else if (r.transaction_type === "usage") used += Math.abs(amt);
    }
    entries += list.length;
    if (list.length < PAGE) break;
    from += PAGE;
  }
  return { enrolled: entries > 0, granted, purchased, used };
}

/** Calendar-month key (UTC) — the period the included allowance is scoped to. Matches the
 *  `reset_at` the UI shows, so the promise and the mechanism can never drift apart. */
export function periodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const periodMarker = (d?: Date) => `period reset ${periodKey(d)}`;

/**
 * MONTHLY ALLOWANCE — applied lazily on read, never by a scheduled job.
 *
 * The catalog sells "N credits / month" and /credits/balance returns a `reset_at`, but nothing ever
 * reset anything: a Scout who spent their 100k never got more, and an ANNUAL subscriber received one
 * grant per YEAR (activateTier fires per invoice) against a per-month promise.
 *
 * Two buckets, both already present in the ledger — no schema change, no reinterpretation of history:
 *   grant    → the included/promotional allowance. Resets to the tier allotment each month.
 *   purchase → credits the customer paid for. NEVER expires, always carries over.
 * Usage consumes the grant bucket first (included_remaining = granted − used, floored at 0), so
 * purchased credits are only touched once the monthly allowance is exhausted.
 *
 * Deliberately NOT a cron: a scheduled job that mutates every wallet monthly can fail silently,
 * double-run, or drift — which is exactly the class of bug that minted 48.9M in duplicate credits
 * here. Doing it on read makes it self-healing, and idempotent via a per-period marker row that a
 * partial unique index enforces even under concurrent requests.
 *
 * Writes at most ONE row per workspace per month (amount 0 when nothing needs adjusting — the row
 * still matters as the marker that stops recomputation mid-month).
 */
export async function ensurePeriodAllowance(workspaceId: string): Promise<void> {
  const marker = periodMarker();
  const { data: already, error: probeErr } = await supabase
    .from("ai_credits_ledger").select("id")
    .eq("workspace_id", workspaceId).eq("transaction_type", "grant").eq("description", marker).limit(1);
  if (probeErr) return;                       // never block a read on ledger trouble
  if (already && already.length > 0) return;  // this period is already settled

  const b = await ledgerBreakdown(workspaceId);
  if (!b.enrolled) return;                    // read paths must never enroll a workspace

  const ent = await getEntitlement(workspaceId);
  const allotment = grantAmountFor(ent.tier);
  // What's left of the included bucket right now. Usage beyond `granted` has already eaten into
  // purchases, so it must not make this negative.
  const includedRemaining = Math.max(0, b.granted - b.used);
  // Negative when unused allowance is being expired (no rollover); positive when topping up.
  const delta = Math.round(allotment - includedRemaining);
  await supabase.from("ai_credits_ledger")
    .insert({ workspace_id: workspaceId, amount: delta, transaction_type: "grant", description: marker })
    .then(() => {}, () => {});   // a concurrent request won the unique index — that's success
}

export interface BurstStatus { limited: boolean; used: number; cap: number; resetsAt: string | null }

/** Sum usage in the trailing window; report whether the burst cap is hit and when it frees up.
 *  The burst cap is a FRACTION of the monthly wallet, so it can never let a user spend beyond their
 *  total credits — the wallet floor (assertCreditsOk) is the hard stop; burst just paces bursts. */
export async function burstStatus(workspaceId: string): Promise<BurstStatus> {
  const cap = burstCapFor(normalizeTierId(await resolveTier(workspaceId)));
  const since = new Date(Date.now() - BURST_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  // Server-side aggregate — a busy workspace can exceed the row cap inside one burst window, and a
  // truncated sum would silently UNDER-count usage and let the cap be overrun (see ledgerBreakdown).
  const { data: agg, error: aggErr } = await supabase.rpc("ai_credit_usage_since", { ws: workspaceId, since });
  const aggRow = Array.isArray(agg) ? agg[0] : agg;
  if (!aggErr && aggRow) {
    const used = Number((aggRow as { used?: number }).used ?? 0);
    const oldestAt = (aggRow as { oldest?: string | null }).oldest ?? null;
    if (used === 0 || !oldestAt) return { limited: false, used: 0, cap, resetsAt: null };
    const resetsAt = new Date(new Date(oldestAt).getTime() + BURST_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    return { limited: used >= cap, used, cap, resetsAt };
  }
  const { data, error } = await supabase
    .from("ai_credits_ledger")
    .select("amount, created_at")
    .eq("workspace_id", workspaceId)
    .eq("transaction_type", "usage")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(10000);
  if (error || !data || data.length === 0) return { limited: false, used: 0, cap, resetsAt: null };
  const used = data.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);
  const oldest = new Date(data[0]!.created_at as string).getTime();
  const resetsAt = new Date(oldest + BURST_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  return { limited: used >= cap, used, cap, resetsAt };
}

export async function creditStatus(workspaceId: string): Promise<{ balance: number; enrolled: boolean }> {
  const { data: probe, error } = await supabase
    .from("ai_credits_ledger").select("id").eq("workspace_id", workspaceId).limit(1);
  if (error) return { balance: 0, enrolled: false };       // table missing → don't gate
  if (!probe || probe.length === 0) return { balance: 0, enrolled: false };
  const { data: bal } = await supabase.rpc("ai_credit_balance", { ws: workspaceId });
  return { balance: Number(bal ?? 0), enrolled: true };
}

/** User-facing remaining credits — NEVER negative (the wallet is floored at 0). */
export async function remainingCredits(workspaceId: string): Promise<number> {
  const { balance } = await creditStatus(workspaceId);
  return Math.max(0, balance);
}

export async function grantCredits(workspaceId: string, amount: number, type: "grant" | "purchase", description: string): Promise<void> {
  if (amount <= 0) return;
  await supabase.from("ai_credits_ledger")
    .insert({ workspace_id: workspaceId, amount: Math.round(amount), transaction_type: type, description })
    .then(() => {}, () => {});
}

/**
 * Deduct token usage (negative). CLAMPED so the wallet can NEVER go below zero: we only deduct down
 * to the current balance. Fire-and-forget from the caller; the async body reads the balance first.
 * Only charges for work actually performed (real provider tokens) — a failed call reports 0 tokens.
 */
export function recordCreditUsage(workspaceId: string | undefined, tokens: number | undefined, description = "AI usage"): void {
  if (!workspaceId || !tokens || tokens <= 0) return;
  void (async () => {
    try {
      const { balance, enrolled } = await creditStatus(workspaceId);
      if (!enrolled) return; // not on the metered ledger → nothing to deduct
      const deduct = Math.min(Math.round(tokens), Math.max(0, balance)); // floor at zero
      if (deduct <= 0) return;
      await supabase.from("ai_credits_ledger")
        .insert({ workspace_id: workspaceId, amount: -deduct, transaction_type: "usage", description });
      await maybeAutoRefill(workspaceId);
    } catch { /* ledger is best-effort telemetry — never block the user's action */ }
  })();
}

/**
 * THE enforcement gate — call BEFORE running any AI/generative/agent action. Throws
 * CreditsExhaustedError (fail closed) when an enrolled workspace has no credits left or has hit its
 * rolling burst cap. Used by the route middleware (clean 402/429) AND the AI-gateway pre-flight (so
 * Discovery, agents, reports, and decision reasoning all fail closed too — not just /ask).
 */
export async function assertCreditsOk(workspaceId?: string): Promise<void> {
  if (!workspaceId) return;
  // Product-owner override: owner workspaces get unmetered AI (no payment). Gated to exact emails.
  if (await isOwnerWorkspace(workspaceId)) return;
  // Settle the month's allowance here too, not just on /credits/balance: a workspace that uses AI
  // without ever loading the billing UI must still get its monthly credits. Cheap — one indexed
  // lookup that short-circuits for the rest of the month once the period's marker row exists.
  await ensurePeriodAllowance(workspaceId);
  const { balance, enrolled } = await creditStatus(workspaceId);
  if (!enrolled) return;
  if (balance <= 0) {
    throw new CreditsExhaustedError("credits", null, "AI credits exhausted. Upgrade your plan or add a credit pack to keep using AI.");
  }
  const burst = await burstStatus(workspaceId);
  if (burst.limited) {
    throw new CreditsExhaustedError("burst", burst.resetsAt, `You've hit your short-term usage limit. It resets ${burst.resetsAt ? "around " + new Date(burst.resetsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "shortly"}.`);
  }
}

/** Route middleware — mount AFTER requireAuth on AI-consuming routes. Fails closed with a clear
 *  402 (out of credits) or 429 (burst), or falls through when the workspace isn't enrolled. */
export const verifyAiCredits = createMiddleware<{ Variables: { workspaceId: string } }>(async (c, next) => {
  const ws = c.get("workspaceId");
  if (ws) {
    try {
      await assertCreditsOk(ws);
    } catch (e) {
      if (e instanceof CreditsExhaustedError) {
        throw new HTTPException(e.kind === "credits" ? 402 : 429, { message: e.message });
      }
      throw e;
    }
  }
  await next();
});
