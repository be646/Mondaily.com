import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";
// The pure, unit-tested helpers live in lib/currency-format (no React/network deps). Re-exported
// here so every existing `from "hooks/useCurrency"` import is unchanged.
import { convertAmount, FALLBACK_CURRENCIES, type CurrencyState } from "../lib/currency-format";
export { convertAmount, formatMoney, currencyOptions, CURRENCY_SYMBOL, FALLBACK_CURRENCIES, type CurrencyState } from "../lib/currency-format";

/**
 * useCurrency — the single frontend source for the workspace base currency, the caller's
 * display-currency override, and the stored ECB reference rates. Conversion crosses via EUR
 * and returns null when a required rate is missing (never guessed) — mirrors the server's
 * lib/currency.convert so mixed-currency money can be shown honestly in one currency.
 */

export function useCurrency() {
  const qc = useQueryClient();
  const q = useQuery<CurrencyState>({
    queryKey: ["currency"],
    queryFn: () => apiClient.get<CurrencyState>("/currency"),
    staleTime: 5 * 60_000,
  });

  const base = q.data?.base ?? "USD";
  const display = q.data?.display ?? base;
  const rates = q.data?.rates ?? {};
  const currencies = q.data?.currencies?.length ? q.data.currencies : FALLBACK_CURRENCIES;
  const ratesAsOf = q.data?.rates_as_of ?? null;
  const hasRates = Object.keys(rates).length > 0;

  const setDisplay = useMutation({
    mutationFn: (currency: string) => apiClient.post("/currency/display", { currency }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["currency"] }),
  });

  // Sum a list of {amount, currency} into the display currency. Reports how many amounts
  // could NOT be converted (missing rate) so callers can stay honest instead of mislabeling.
  const sumInDisplay = useCallback(
    (items: { amount: number; currency: string }[]): { value: number; missing: number; converted: boolean } => {
      let value = 0, missing = 0, converted = false;
      for (const it of items) {
        if (it.currency === display) { value += it.amount; continue; }
        const v = convertAmount(it.amount, it.currency, display, rates);
        if (v == null) { missing += 1; value += it.amount; } // face value fallback, flagged via `missing`
        else { value += v; converted = true; }
      }
      return { value, missing, converted };
    },
    [display, rates],
  );

  return { ...q, base, display, rates, currencies, ratesAsOf, hasRates, setDisplay, sumInDisplay };
}
