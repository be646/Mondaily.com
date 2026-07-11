# Replay Harness — Design (Phase 3A)

**This is a design, not an implementation.** No harness code is added in Phase 3A. When built
(Phase 3B, gated), it lives in `packages/tools/` or a standalone script — **never** imported by the
app runtime, and it must not touch `ai-gateway.ts`, `ai-router.ts`, memory, Ask, agents, or prompts.

---

## 1. Purpose
Send each golden fixture to two backends — **hosted baseline** and **private candidate** — offline,
collect responses + telemetry, and score with `RUBRICS.md`. Never serves user traffic.

## 2. Shape (pseudocode, illustrative only)
```
for fixture in load_jsonl("fixtures/<class>.jsonl"):
    for backend in [HOSTED, PRIVATE]:           # two OpenAI-compatible base URLs
        resp, telemetry = call(backend, fixture.prompt, fixture.context, fixture.params)
        record(class, fixture.id, backend, resp, telemetry)   # telemetry: latency, usage, cached_tokens
score(records) -> per-class scorecard -> go/no-go
```
- Both backends are hit via the **same OpenAI-compatible client** → proves request-shape parity.
- The harness reads its **own** base URLs/keys from a **local, gitignored** `.env.eval` — it does
  **not** read or mutate the app's `AI_GATEWAY_*` env, and does not run inside the app process.
- Concurrency low (serial or small batch) — eval volume is tiny; no load-test intent here.

## 3. Telemetry captured per call
`latency_first_token_ms`, `latency_total_ms`, `prompt_tokens`, `completion_tokens`,
`usage.prompt_tokens_details.cached_tokens`, `finish_reason`, raw output (stored locally only).

## 4. Production-prompt handling — sanitization gate (MANDATORY)
Real `ai_usage` prompts may **only** enter fixtures after sanitization + anonymization:
1. **Opt-in extraction**: a separate offline export, run deliberately — not automatic.
2. **PII/secret scrub**: names, emails, phone numbers, tokens, workspace ids → placeholders
   (reuse the app's `redactSecrets` *pattern* by copying rules into the eval tool; do **not** import
   app modules). Emails → `person@example.com`, ids → `ws_XXXX`, etc.
3. **Cross-workspace strip**: no row retains a real `workspace_id`; content generalized so it cannot
   be traced to a tenant.
4. **Human review** of every promoted item before it lands in a `*.jsonl`.
5. Provenance: sanitized items set `"source": "sanitized-real"`; born-synthetic set `"source": "synthetic"`.

**Until an item passes all five, it stays synthetic.** The shipped fixtures are 100% synthetic.

## 5. Outputs
- `runs/<timestamp>/records.jsonl` (local, gitignored) — raw responses + telemetry.
- `runs/<timestamp>/scorecard.md` — per-class metrics vs gates.
- Scorecards are the only artifact reviewed for the Phase 3B go/no-go.

## 6. What the harness must NOT do
- Not run in-process with the app; not import app runtime modules.
- Not send real, unsanitized prompts anywhere.
- Not write to `ai_usage` or any production table.
- Not change any `AI_GATEWAY_*` / `AI_MODEL_*` env used by the live app.
