import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "@mondaily/db/client";

// Mock the mailer so no real send happens; toggle acceptance per test.
const sendMock = vi.fn<[string, string, string], Promise<boolean>>();
vi.mock("../lib/pending-plan-email", () => ({
  sendPendingPlanReminderEmail: (ws: string, plan: string, phase: string) => sendMock(ws, plan, phase),
}));

import { pendingReminderDecision, runPendingPlanReminders } from "../jobs/pending-plan-reminders";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;                 // fixed "set at" epoch
const iso = (ms: number) => new Date(ms).toISOString();

describe("pendingReminderDecision — pure cadence logic", () => {
  const base = { setAt: iso(T0), reminders: {} as Record<string, string | undefined> };

  it("no reminder before day 2", () => {
    expect(pendingReminderDecision({ plan: "command", ...base, nowMs: T0 + 1 * DAY }).action).toBe("none");
  });

  it("day 2 reminder fires once, then never again", () => {
    const d = pendingReminderDecision({ plan: "command", ...base, nowMs: T0 + 2 * DAY });
    expect(d).toMatchObject({ action: "send", phase: "day2", sentKey: "command_day2_sent_at" });
    // once stamped, no duplicate
    const d2 = pendingReminderDecision({ plan: "command", setAt: iso(T0), reminders: { command_day2_sent_at: iso(T0 + 2 * DAY) }, nowMs: T0 + 3 * DAY });
    expect(d2.action).toBe("none");
  });

  it("day 7 reminder fires once (after day2 already sent)", () => {
    const d = pendingReminderDecision({ plan: "command", setAt: iso(T0), reminders: { command_day2_sent_at: iso(T0 + 2 * DAY) }, nowMs: T0 + 7 * DAY });
    expect(d).toMatchObject({ action: "send", phase: "day7", sentKey: "command_day7_sent_at" });
    expect(d.alsoStampKey).toBeUndefined();
  });

  it("day 7 with a MISSED day2 sends day7 and marks day2 handled (no stale day2 later)", () => {
    const d = pendingReminderDecision({ plan: "command", setAt: iso(T0), reminders: {}, nowMs: T0 + 8 * DAY });
    expect(d).toMatchObject({ action: "send", phase: "day7", sentKey: "command_day7_sent_at", alsoStampKey: "command_day2_sent_at" });
  });

  it("no duplicate if day7 sent_at already exists", () => {
    expect(pendingReminderDecision({ plan: "command", setAt: iso(T0), reminders: { command_day7_sent_at: iso(T0 + 7 * DAY) }, nowMs: T0 + 30 * DAY }).action).toBe("none");
  });

  it("pending_plan cleared / Scout / Operator ⇒ nothing", () => {
    for (const plan of [undefined, "scout", "operator"]) {
      expect(pendingReminderDecision({ plan, setAt: iso(T0), reminders: {}, nowMs: T0 + 30 * DAY }).action).toBe("none");
    }
  });

  it("missing anchor ⇒ backfill only (no send)", () => {
    expect(pendingReminderDecision({ plan: "sovereign", setAt: undefined, reminders: {}, nowMs: T0 + 30 * DAY }).action).toBe("backfill_anchor");
  });

  it("sovereign uses its own reminder keys", () => {
    const d = pendingReminderDecision({ plan: "sovereign", setAt: iso(T0), reminders: {}, nowMs: T0 + 2 * DAY });
    expect(d.sentKey).toBe("sovereign_day2_sent_at");
  });
});

describe("runPendingPlanReminders — orchestration + persistence", () => {
  function stub(rows: { id: string; settings: Record<string, unknown> }[]) {
    const updates: { id: string; settings: Record<string, unknown> }[] = [];
    vi.spyOn(supabase, "from").mockImplementation(() => {
      const b: Record<string, unknown> = {
        select: () => Promise.resolve({ data: rows }),
        update: (payload: { settings: Record<string, unknown> }) => ({
          eq: (_c: string, id: string) => { updates.push({ id, settings: payload.settings }); return Promise.resolve({ error: null }); },
        }),
      };
      return b as never;
    });
    return updates;
  }
  beforeEach(() => { vi.restoreAllMocks(); sendMock.mockReset(); sendMock.mockResolvedValue(true); });

  it("sends day2 to a pending Command workspace and stamps the reminder", async () => {
    const updates = stub([{ id: "ws1", settings: { pending_plan: "command", pending_plan_set_at: iso(T0) } }]);
    const r = await runPendingPlanReminders(T0 + 2 * DAY);
    expect(r.sent).toBe(1);
    expect(sendMock).toHaveBeenCalledWith("ws1", "command", "day2");
    expect((updates[0]!.settings.pending_plan_reminders as Record<string, string>).command_day2_sent_at).toBeTruthy();
  });

  it("does NOT send to Scout/Operator/cleared workspaces", async () => {
    stub([
      { id: "a", settings: { account_tier: "scout" } },
      { id: "b", settings: { pending_plan: "operator" } },
      { id: "c", settings: {} },
    ]);
    const r = await runPendingPlanReminders(T0 + 30 * DAY);
    expect(r.scanned).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("mail missing/declined ⇒ no stamp (retry later), job doesn't crash", async () => {
    sendMock.mockResolvedValue(false);
    const updates = stub([{ id: "ws1", settings: { pending_plan: "command", pending_plan_set_at: iso(T0) } }]);
    const r = await runPendingPlanReminders(T0 + 2 * DAY);
    expect(r.sent).toBe(0);
    expect(updates.length).toBe(0);   // nothing persisted ⇒ will retry next run
  });

  it("missing anchor ⇒ backfills pending_plan_set_at, sends nothing that run", async () => {
    const updates = stub([{ id: "ws1", settings: { pending_plan: "sovereign" } }]);
    const r = await runPendingPlanReminders(T0);
    expect(r.backfilled).toBe(1);
    expect(r.sent).toBe(0);
    expect(updates[0]!.settings.pending_plan_set_at).toBeTruthy();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("already-sent day2 ⇒ no duplicate", async () => {
    stub([{ id: "ws1", settings: { pending_plan: "command", pending_plan_set_at: iso(T0), pending_plan_reminders: { command_day2_sent_at: iso(T0 + 2 * DAY) } } }]);
    const r = await runPendingPlanReminders(T0 + 3 * DAY);
    expect(r.sent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
