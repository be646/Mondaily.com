# Rollback Checklist — Private Inference

**Version:** 1.0.0 · preparation only. Rollback is **env-based** and takes seconds; no deploy needed.

## Principle
Every migration step is a single `AI_MODEL_<CLASS>` (or base-URL) env change on the Vercel API
project. Rollback = restore the previous value. No app code, no gateway change, no DB change.

## Per-stage rollback

### Canary: extraction only
- **Symptom:** JSON validity drop, latency regression, or errors on extraction after cutover.
- **Action:**
  1. In Vercel (API project), set `AI_MODEL_EXTRACTION` back to the **hosted** spec (or delete the
     var so it falls back through the default chain).
  2. Redeploy is not required if env is read at runtime; otherwise trigger a redeploy of the API.
  3. Confirm `ai_usage.provider` for extraction returns to the hosted label and latency normalizes.
  4. Leave `AI_BACKEND_LABEL` as-is (harmless) or revert if desired.

### support / fast (chat)
- Same as above with `AI_MODEL_SUPPORT` / `AI_MODEL_FAST`.

### summarization / meeting / reasoning
- Same with the corresponding `AI_MODEL_*`. These are last to migrate and first to roll back on any doubt.

### Full base-URL cutover (only if ever done)
- **Action:** restore `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY` to the hosted gateway values.
- The **fail-closed guard** guarantees a misconfigured/missing value refuses to route rather than
  silently hitting a wrong endpoint — so a bad rollback fails safe, not silently.

## Verification after any rollback
- [ ] `ai_usage.provider` for the affected class shows the hosted label again.
- [ ] `ai_usage.latency_ms` back to the hosted baseline range.
- [ ] No 5xx/timeout spike at the proxy for that class.
- [ ] A live Ask/extraction request returns a correct result.
- [ ] `source_count` / `cache_status` behaving as before (memory Phase 2B unaffected — it never
      changed).

## Pre-req: rollback must be REHEARSED before promoting any class to full (acceptance criterion §7).
Do a deliberate revert during the canary window and confirm the checklist above passes.
