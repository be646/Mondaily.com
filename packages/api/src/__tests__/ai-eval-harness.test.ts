import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

/**
 * Phase 3A.1 — offline AI eval harness guardrails. These tests PROVE the harness is isolated from
 * the app runtime and fails closed. They do NOT run the eval against any endpoint.
 */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const HARNESS = `${REPO}scripts/ai-eval/harness.mjs`;
const src = readFileSync(HARNESS, "utf8");

describe("Phase 3A.1 — harness isolation", () => {
  it("imports nothing from the app runtime (@mondaily/*, apps/, packages/)", () => {
    // no bare @mondaily imports, no relative reach into packages/ or apps/
    expect(src).not.toMatch(/from\s+["']@mondaily\//);
    expect(src).not.toMatch(/from\s+["'].*\/(apps|packages)\//);
    // only node: stdlib imports
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    for (const i of imports) expect(i.startsWith("node:")).toBe(true);
  });

  it("is imported by NOTHING in apps/ or packages/", () => {
    const files = [
      ...globSync(`${REPO}apps/**/*.{ts,tsx,js,mjs}`, { exclude: (p) => p.includes("node_modules") }),
      ...globSync(`${REPO}packages/**/*.{ts,tsx,js,mjs}`, { exclude: (p) => p.includes("node_modules") }),
    ];
    const referencing = files
      // exclude this guardrail test itself (it names the harness in string literals, doesn't import it)
      .filter((f) => !f.endsWith("ai-eval-harness.test.ts"))
      .filter((f) => {
        const t = readFileSync(f, "utf8");
        return /(from|import|require)\s*\(?\s*["'][^"']*(ai-eval\/harness|scripts\/ai-eval)/.test(t);
      });
    expect(referencing).toEqual([]);
  });

  it("guards production + declares fail-closed env contract in source", () => {
    expect(src).toMatch(/refusing to run in a production environment/);
    expect(src).toMatch(/VERCEL \|\| env\.NODE_ENV === "production"/);
    expect(src).toMatch(/offline mode requires local env vars/);
    // does not READ the live app's inference env (may name them in comments, never reads them)
    expect(src).not.toMatch(/env\.AI_GATEWAY|env\.AI_MODEL|process\.env\.AI_GATEWAY|process\.env\.AI_MODEL/);
  });
});

describe("Phase 3A.1 — harness fails closed (executed, no endpoints hit)", () => {
  const runExpectFail = (args: string[], env: Record<string, string> = {}) => {
    try {
      execFileSync("node", [HARNESS, ...args], { env: { ...process.env, ...env }, stdio: "pipe" });
      return { code: 0, out: "" };
    } catch (e: unknown) {
      const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
      return { code: err.status ?? -1, out: `${err.stderr ?? ""}${err.stdout ?? ""}` };
    }
  };

  it("dry-run passes with synthetic fixtures (exit 0, no env needed)", () => {
    const out = execFileSync("node", [HARNESS, "--dry-run"], { stdio: "pipe" }).toString();
    expect(out).toMatch(/dry-run PASS/);
  });

  it("offline WITHOUT env exits non-zero (missing-env fail-closed)", () => {
    const r = runExpectFail(["--offline"], { EVAL_HOSTED_BASE_URL: "", EVAL_PRIVATE_BASE_URL: "" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/requires local env vars|missing/);
  });

  it("offline in a production env is refused even WITH env present", () => {
    const full = {
      VERCEL: "1",
      EVAL_HOSTED_BASE_URL: "http://x", EVAL_HOSTED_API_KEY: "x", EVAL_HOSTED_MODEL: "x",
      EVAL_PRIVATE_BASE_URL: "http://x", EVAL_PRIVATE_API_KEY: "x", EVAL_PRIVATE_MODEL: "x",
    };
    const r = runExpectFail(["--offline"], full);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/production environment/);
  });
});
