import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Design-system consistency pass. Interactive buttons/chips are squared (rounded-sm); metadata
 * dots/avatars/status pills stay circular; decorative gradients/orbs and bright one-off colors are
 * removed. Source guards over the touched surfaces.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../apps/app/src/${p}`, import.meta.url)), "utf8");
const help = read("components/help/help-panel.tsx");
const salesReport = read("routes/dashboard/reports/sales-report.tsx");
const recordTable = read("components/records/record-table.tsx");
const recordDetail = read("components/records/record-detail.tsx");
const tasks = read("routes/dashboard/tasks.tsx");
const taskPanel = read("components/tasks/task-detail-panel.tsx");
const notes = read("routes/dashboard/notes.tsx");
const objectsIndex = read("routes/dashboard/objects/[objectType]/index.tsx");
const invoiceDetail = read("routes/dashboard/finance/[invoiceId].tsx");
const creditNoteDetail = read("routes/dashboard/finance/[creditNoteId].tsx");
const SETTINGS = ["account", "integrations", "workspace", "security", "training"].map((n) => read(`routes/dashboard/settings/${n}.tsx`));

const hasButtonBubbly = (src: string) =>
  src.split("\n").some((l) => /rounded-(lg|xl)/.test(l) && /hover:bg-\[var\(--surface/.test(l));

describe("interactive controls squared (no bubbly buttons)", () => {
  it("settings buttons are squared (no rounded-lg/xl + surface-hover on one line)", () => {
    for (const s of SETTINGS) expect(hasButtonBubbly(s)).toBe(false);
  });
  it("records + tasks + report dashboard button radii squared", () => {
    for (const s of [recordTable, recordDetail, tasks]) expect(hasButtonBubbly(s)).toBe(false);
  });
  it("help suggestion chips + FAB squared (no interactive rounded-full border)", () => {
    expect(help).not.toMatch(/rounded-full border/);
  });
  it("notes + objects index + finance detail button radii squared", () => {
    for (const s of [notes, objectsIndex, invoiceDetail, creditNoteDetail]) expect(hasButtonBubbly(s)).toBe(false);
  });
  it("task-detail-panel picker chips squared (avatars + label pills stay circular)", () => {
    // Interactive assignee/due/priority picker chips were `rounded-full border px-2.5`.
    expect(taskPanel).not.toMatch(/rounded-full border px-2\.5/);
    expect(taskPanel).toMatch(/rounded-full border flex items-center justify-center/); // avatar stack circles
  });
});

describe("intentional circular metadata preserved", () => {
  it("help keeps tiny status dots + the state badge circular", () => {
    expect(help).toMatch(/h-1\.5 w-1\.5 rounded-full/);          // status dots
    expect(help).toMatch(/rounded-full px-2 py-0\.5 text-\[10px\] font-medium/); // state badge (metadata)
  });
});

describe("decorative blobs/gradients + bright one-off colors removed", () => {
  it("sales-report: no decorative orb or one-off panel gradient (bar fills allowed)", () => {
    expect(salesReport).not.toMatch(/opacity-20 blur-2xl/);
    expect(salesReport).not.toMatch(/linear-gradient\(135deg,rgba\(113,119,132/);
  });
  it("help diagnostics use the matte palette (no bright #ef4444)", () => {
    expect(help).not.toMatch(/#ef4444/);
  });
});
