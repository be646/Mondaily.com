# AI Eval Harness (offline, Phase 3A.1)

Self-contained offline harness that replays `docs/ai-eval` fixtures against two
OpenAI-compatible endpoints (hosted baseline + private candidate) and writes a report.

**Isolation guarantees (enforced by tests):**
- Zero dependencies beyond the Node standard library (uses global `fetch`).
- Imports **nothing** from `@mondaily/*` / app runtime packages.
- Is imported by **nothing** in `apps/` or `packages/`.
- **Fails closed**: offline mode refuses to run without all required env vars.
- **Never runs in production**: refuses if `VERCEL` or `NODE_ENV=production` is set.
- Only accepts `source: "synthetic"` fixtures for now.

## Usage

Dry-run (validate fixtures only, no network, no env needed):
```
pnpm eval:ai:dry-run
```

Offline replay (requires local env; makes network calls to YOUR endpoints):
```
EVAL_HOSTED_BASE_URL=... EVAL_HOSTED_API_KEY=... EVAL_HOSTED_MODEL=... \
EVAL_PRIVATE_BASE_URL=... EVAL_PRIVATE_API_KEY=... EVAL_PRIVATE_MODEL=... \
pnpm eval:ai:offline
```

Flags: `--dry-run`, `--offline`, `--class=extraction` (filter), `--out=<dir>`.

Reports are written to `scripts/ai-eval/runs/<timestamp>/` (gitignored) as `report.json` + `report.md`.

See `docs/ai-eval/HARNESS_DESIGN.md` for the design and the sanitization gate that governs when
real (non-synthetic) prompts may ever be added.
