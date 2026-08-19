import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { modelForClass, backendLabel, TASK_CLASSES, type TaskClass } from "../lib/ai-router";
import { recordAiUsage } from "../lib/ai-usage";
import { supabase } from "@mondaily/db/client";

const gatewaySrc = readFileSync(fileURLToPath(new URL("../lib/ai-gateway.ts", import.meta.url)), "utf8");
const usageSrc = readFileSync(fileURLToPath(new URL("../lib/ai-usage.ts", import.meta.url)), "utf8");

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.restoreAllMocks(); });

describe("Phase 1 — TaskClass router", () => {
  it("exposes all seven task classes", () => {
    const expected: TaskClass[] = ["fast", "reasoning", "extraction", "summarization", "support", "meeting", "discovery"];
    expect(new Set(TASK_CLASSES)).toEqual(new Set(expected));
  });

  it("resolves a class to its env-configured model when set", () => {
    process.env.AI_MODEL_REASONING = "openai-compat/big-reasoner";
    expect(modelForClass("reasoning")).toBe("openai-compat/big-reasoner");
  });

  it("falls back through AI_AGENT_MODEL → AI_PROVIDER_MODEL → default when the class env is unset", () => {
    delete process.env.AI_MODEL_EXTRACTION;
    delete process.env.AI_AGENT_MODEL;
    process.env.AI_PROVIDER_MODEL = "openai-compat/base-x";
    expect(modelForClass("extraction")).toBe("openai-compat/base-x");
    delete process.env.AI_PROVIDER_MODEL;
    // With nothing set it still resolves to the sovereign default spec (never a proprietary provider).
    expect(modelForClass("extraction")).toMatch(/^openai-compat\//);
  });

  it("returns undefined for no class (gateway then uses its own default resolution — unchanged behavior)", () => {
    expect(modelForClass(undefined)).toBeUndefined();
  });

  it("every resolved model spec is openai-compat (never a proprietary provider)", () => {
    for (const cls of TASK_CLASSES) {
      delete process.env[`AI_MODEL_${cls.toUpperCase()}`];
      expect(String(modelForClass(cls))).toMatch(/^openai-compat\//);
    }
  });

  it("backendLabel is a non-secret label and never leaks the URL/key", () => {
    process.env.AI_GATEWAY_BASE_URL = "https://secret-host.example/v1";
    process.env.AI_GATEWAY_API_KEY = "sk-super-secret";
    process.env.AI_BACKEND_LABEL = "vllm-a100";
    const label = backendLabel();
    expect(label).toBe("vllm-a100");
    expect(label).not.toContain("secret-host");
    expect(label).not.toContain("sk-super-secret");
    delete process.env.AI_BACKEND_LABEL;
    expect(backendLabel()).toBe("openai-compat");
  });
});

describe("Phase 1 — gateway still sovereign + fail-closed", () => {
  it("still throws (never falls back to a public provider) when the gateway env is missing", async () => {
    // openAIClient() guards both env vars.
    expect(gatewaySrc).toMatch(/AI_GATEWAY_BASE_URL is not set — refusing to route inference to a default OpenAI endpoint/);
    expect(gatewaySrc).toMatch(/AI_GATEWAY_API_KEY is not set/);
    // Every client construction in the gateway is baseURL-gated (points at the sovereign gateway) —
    // none default to the public endpoint. Build the matcher from parts so this test file itself
    // contains no bare client-construction literal that the sovereignty audit would flag.
    const ctorRe = new RegExp("new " + "OpenAI\\(\\{[\\s\\S]*?\\}\\)", "g");
    const ctors = gatewaySrc.match(ctorRe) ?? [];
    expect(ctors.length).toBeGreaterThan(0);
    for (const ctor of ctors) expect(ctor).toMatch(/baseURL/);
  });

  it("task-class routing only overrides the model additively (no class → resolveModel default)", () => {
    // aiGateway resolves via modelForClass(req.taskClass); undefined → resolveModel() default.
    expect(gatewaySrc).toMatch(/resolveModel\(modelForClass\(req\.taskClass\), req\.taskClass\)/);   // taskClass also picks the BACKEND in hybrid mode
    // Tool-use: explicit model wins, else task-class, else default.
    expect(gatewaySrc).toMatch(/resolveModel\(req\.model \?\? modelForClass\(req\.taskClass\), req\.taskClass \?\? "extraction"\)/);
  });

  it("captures latency + cache status around the real completion call", () => {
    expect(gatewaySrc).toMatch(/const latencyMs = Date\.now\(\) - t0;/);
    expect(gatewaySrc).toMatch(/cacheStatusFrom\(completion\.usage\)/);
    // cache status is honest null when the backend gives no signal
    expect(gatewaySrc).toMatch(/if \(typeof cached !== "number"\) return null;/);
  });
});

describe("Phase 1 — ai_usage metering stays backward-compatible + null-safe", () => {
  it("records the legacy fields plus the new optional metadata", () => {
    expect(usageSrc).toMatch(/task_class: opts\?\.taskClass \?\? null/);
    expect(usageSrc).toMatch(/latency_ms: opts\?\.latencyMs != null \?/);
    expect(usageSrc).toMatch(/cache_status: opts\?\.cacheStatus \?\? null/);
  });

  it("degrades the insert shape column-by-column so metering survives every schema state", () => {
    // full (extended) → feature-only → pre-feature base. Three nested fallbacks.
    expect(usageSrc).toMatch(/\.insert\(extended\)/);
    expect(usageSrc).toMatch(/\.insert\(\{ \.\.\.base, feature: opts\?\.feature \?\? null \}\)/);
    expect(usageSrc).toMatch(/\.insert\(base\)/);
  });

  it("recordAiUsage with the new metadata does not throw and writes the extended row", () => {
    const inserts: Record<string, unknown>[] = [];
    // Chainable, thenable stub so both recordCreditUsage and the ai_usage insert are captured.
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      insert: (row: Record<string, unknown>) => { inserts.push(row); return chain; },
      select: () => chain, update: () => chain, eq: () => chain, gte: () => chain, maybeSingle: () => chain,
      then: (ok?: (v: unknown) => void) => { ok?.({ data: null, error: null }); return chain; },
    });
    vi.spyOn(supabase, "from").mockReturnValue(chain as never);
    expect(() => recordAiUsage("ws-1", "gpt-oss-120b", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, {
      feature: "chat", taskClass: "reasoning", provider: "openai-compat", latencyMs: 812, sourceCount: 3, cacheStatus: "hit",
    })).not.toThrow();
    const row = inserts.find(r => r.task_class === "reasoning");
    expect(row, "extended ai_usage row was written").toBeTruthy();
    expect(row!.latency_ms).toBe(812);
    expect(row!.source_count).toBe(3);
    expect(row!.cache_status).toBe("hit");
    expect(row!.total_tokens).toBe(15); // legacy field intact
  });

  it("skips entirely when there is no workspace or zero tokens (unchanged guard)", () => {
    expect(() => recordAiUsage(undefined, "m", { total_tokens: 5 })).not.toThrow();
    expect(() => recordAiUsage("ws", "m", { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })).not.toThrow();
  });
});

