import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiClient } from "../lib/api-client";
import {
  normalizeLang, dir as dirFor, isRtl as isRtlFor, t as translate,
  formatNumber, formatDate, formatCredits, type LanguageCode,
} from "@mondaily/shared/i18n";

/**
 * Effective UI/AI language for the current user: their per-user override
 * (settings.account.language) if set, else the workspace profile language, else English.
 *
 * Side effect: keeps <html lang> and <html dir> in sync so Arabic renders RTL (the safe RTL
 * foundation — we flip the document direction and let the browser mirror flow; we do NOT force a
 * full RTL restyle of every component in this pass).
 */
export function useLanguage() {
  const account = useQuery<{ language?: string | null }>({
    queryKey: ["account-settings"],
    queryFn: () => apiClient.get("/settings/account"),
    staleTime: 300_000,
    retry: false,
  });
  const workspace = useQuery<{ profile?: { language?: string } }>({
    queryKey: ["workspace-settings"],
    queryFn: () => apiClient.get("/settings/workspace"),
    staleTime: 300_000,
    retry: false,
  });

  const lang: LanguageCode = normalizeLang(account.data?.language || workspace.data?.profile?.language);

  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = dirFor(lang);
    return () => { /* leave last language applied; next mount re-sets it */ };
  }, [lang]);

  return {
    lang,
    dir: dirFor(lang),
    isRtl: isRtlFor(lang),
    t: (key: string) => translate(lang, key),
    formatNumber: (n: number) => formatNumber(n, lang),
    formatCredits: (n: number) => formatCredits(n, lang),
    formatDate: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => formatDate(d, lang, opts),
  };
}
