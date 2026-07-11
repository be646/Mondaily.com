# Mondaily AI Eval Package — Phase 3A

**Status:** planning/validation only. **Version:** 1.0.0 (2026-07-11).

This directory prepares Mondaily to evaluate **private vLLM/SGLang inference** against the
current hosted gateway **without changing any live inference today**. Nothing here is imported
by the app, the AI gateway, the router, memory, Ask, agents, or prompts. It is docs + fixtures.

> **Hard boundary.** No file in `docs/ai-eval/` may be imported from `apps/`, `packages/api`,
> `packages/agents`, or `packages/prompts`. This is an offline test asset. Memory Phase 2B is
> frozen and out of scope.

## Contents

| File | Purpose |
|---|---|
| `PHASE_3A_EVAL_PLAN.md` | Versioned eval plan: scope, method, go/no-go gates |
| `PHASE_3A2_RUNBOOK.md` | Step-by-step: temporary RTX 4090 + vLLM, env, commands, teardown |
| `RUBRICS.md` | Scoring rubrics for all six metrics |
| `HARNESS_DESIGN.md` | Replay-harness design (NOT wired; sanitized inputs only) |
| `fixtures/_schema.json` | JSON Schema every fixture line must satisfy |
| `fixtures/*.jsonl` | Synthetic golden fixtures, one file per task class |

## Task classes covered
`fast` (chat) · `support` · `reasoning` · `meeting` · `extraction` · `discovery` · `summarization`

## Ground rules
1. **No production prompts** enter fixtures unless sanitized + anonymized (see `HARNESS_DESIGN.md` §4).
2. Fixtures are **synthetic by default** — the shipped examples contain no real workspace data.
3. The harness is a **design**, not an implementation, in Phase 3A. Wiring happens in 3B, gated.
4. Recommended first test GPU: **on-demand RTX 4090** (see plan §6).
