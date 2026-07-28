import { createHash } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { aiGateway, gatewayEnv } from "./ai-gateway";
import { normalizeLang, SUPPORTED_LANGUAGES } from "@mondaily/shared/i18n";

/**
 * Phase C.1 — sovereign live translation for the transcript overlay. A READ-TIME transform only: it never
 * reads or writes call_transcript_lines and never mutates the original transcript. Translation runs ONLY
 * through the approved aiGateway (Cerebras) — no browser API, no third-party translator. Every result is
 * cached in caption_translations, idempotent by (workspace_id, text_hash, source_lang, target_lang). On any
 * failure/empty output nothing is cached and the caller is told "unavailable" (the UI shows the original) —
 * never a fabricated translation.
 */

export type TranslationState = "translated" | "original" | "unavailable";
export interface TranslationResult {
  text_hash: string;
  source_lang: string;
  target_lang: string;
  state: TranslationState;
  translated?: string;   // present only when state === "translated"
}
export interface TranslateLineInput { text?: string | null; source_lang?: string | null }

/** The gateway must be configured for translation to be possible at all (else everything is "unavailable"). */
export const translationConfigured = (): boolean => {
  const { baseURL, apiKey } = gatewayEnv();
  return !!(baseURL && apiKey);
};

/** Normalize a line for hashing so trivially-different whitespace hits the same cache row. Case preserved. */
const normalizeForHash = (s: string): string => s.trim().replace(/\s+/g, " ");
export const textHash = (s: string): string => createHash("sha256").update(normalizeForHash(s)).digest("hex");

const langName = (code: string): string => SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code;
const nativeName = (code: string): string => SUPPORTED_LANGUAGES.find((l) => l.code === code)?.nativeName ?? code;

/** One gateway translation. Returns the translated string, or null on failure/empty (never fabricates). */
async function translateOne(text: string, sourceLang: string, targetLang: string, ws: string, userId: string): Promise<{ text: string; model: string } | null> {
  const tgt = `${langName(targetLang)} (${nativeName(targetLang)})`;
  const src = sourceLang && sourceLang !== "auto" ? `${langName(sourceLang)} ` : "";
  const system =
    `You are a translation engine. Translate the user's ${src}message into ${tgt}. ` +
    `Output ONLY the translation as plain text — no quotes, no notes, no preamble, no explanation. ` +
    `Preserve meaning and tone; translate short fragments as-is. If the text is already in ${tgt}, return it unchanged.`;
  try {
    const res = await aiGateway({
      system,
      prompt: text,
      maxTokens: Math.min(600, Math.max(64, Math.ceil(text.length * 1.5))),
      workspaceId: ws,
      userId,
      feature: "live_translation",
    });
    const out = (res.text ?? "").trim();
    if (!out) return null;                       // empty → unavailable, never fake
    return { text: out, model: res.model };
  } catch {
    return null;                                 // gateway error → unavailable (aiGateway also self-heals)
  }
}

/**
 * Translate a batch of lines into one target language, workspace-scoped. De-dupes identical source text within
 * the batch, serves from cache first, translates only the misses through the gateway, and back-fills the cache.
 * source_lang === target_lang (or missing target) short-circuits to "original" with NO AI call.
 */
export async function translateLines(
  ws: string,
  userId: string,
  rawTarget: string,
  lines: TranslateLineInput[],
): Promise<{ configured: boolean; results: TranslationResult[] }> {
  const target = normalizeLang(rawTarget);
  const configured = translationConfigured();

  // Build the per-line request shape up-front (hash + resolved source lang).
  const prepared = lines.map((l) => {
    const text = String(l.text ?? "");
    const source = l.source_lang ? normalizeLang(l.source_lang) : "auto";
    return { text, source, hash: textHash(text) };
  });

  // Same-language passthrough (req 13) — no AI, ever.
  const needsTranslation = (p: { text: string; source: string }) => p.text.trim().length > 0 && p.source !== target;

  const results: TranslationResult[] = prepared.map((p) => ({
    text_hash: p.hash, source_lang: p.source, target_lang: target,
    state: needsTranslation(p) ? "unavailable" : "original",
  }));
  if (!configured) return { configured, results };   // no gateway → everything stays original/unavailable, honestly

  // 1) Cache read for the distinct (hash, source) misses.
  const misses = prepared.filter((_p, i) => results[i]!.state !== "original");
  const distinct = new Map<string, { text: string; source: string; hash: string }>();
  for (const m of misses) distinct.set(`${m.hash}:${m.source}`, m);

  const cached = new Map<string, string>();      // `${hash}:${source}` -> translated
  if (distinct.size > 0) {
    try {
      const { data } = await supabase
        .from("caption_translations")
        .select("text_hash, source_lang, translated_text")
        .eq("workspace_id", ws)
        .eq("target_lang", target)
        .in("text_hash", [...new Set([...distinct.values()].map((d) => d.hash))])
        .gt("expires_at", new Date().toISOString());
      for (const row of data ?? []) cached.set(`${row.text_hash}:${row.source_lang}`, row.translated_text as string);
    } catch { /* fail-open: treat as all-miss */ }
  }

  // 2) Translate the remaining misses via the gateway (bounded concurrency), then back-fill the cache.
  const toTranslate = [...distinct.values()].filter((d) => !cached.has(`${d.hash}:${d.source}`));
  const fresh = new Map<string, string>();
  const CONCURRENCY = 6;
  for (let i = 0; i < toTranslate.length; i += CONCURRENCY) {
    const slice = toTranslate.slice(i, i + CONCURRENCY);
    const done = await Promise.all(slice.map(async (d) => {
      const r = await translateOne(d.text, d.source, target, ws, userId);
      return { key: `${d.hash}:${d.source}`, d, r };
    }));
    const rows: Array<Record<string, unknown>> = [];
    for (const { key, d, r } of done) {
      if (r) { fresh.set(key, r.text); rows.push({ workspace_id: ws, text_hash: d.hash, source_lang: d.source, target_lang: target, translated_text: r.text, model: r.model }); }
    }
    if (rows.length) {
      try { await supabase.from("caption_translations").upsert(rows, { onConflict: "workspace_id,text_hash,source_lang,target_lang", ignoreDuplicates: true }); } catch { /* fail-open */ }
    }
  }

  // 3) Stitch results back onto every input line (cache hit or fresh → translated; otherwise unavailable).
  return {
    configured,
    results: prepared.map((p, i) => {
      if (results[i]!.state === "original") return results[i]!;
      const key = `${p.hash}:${p.source}`;
      const translated = cached.get(key) ?? fresh.get(key);
      return translated
        ? { text_hash: p.hash, source_lang: p.source, target_lang: target, state: "translated", translated }
        : { text_hash: p.hash, source_lang: p.source, target_lang: target, state: "unavailable" };
    }),
  };
}
