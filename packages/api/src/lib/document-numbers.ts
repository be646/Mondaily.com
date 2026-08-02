import { supabase } from "@mondaily/db/client";

/**
 * Document numbering for invoices and quotes.
 *
 * Both used to read the highest existing number and add one. Two creates that overlap read the
 * same maximum and mint the same number — for an invoice that is not cosmetic, it is two different
 * documents claiming one identity in the customer's records and in ours.
 *
 * The same read had a quieter bug: it ordered by `data->>number`, a TEXT sort over a value padded
 * to four digits. That agrees with numeric order only up to 9999, so 'INV-9999' sorts above
 * 'INV-10000' and the ten-thousandth document would restart the series onto numbers already
 * issued.
 *
 * The counter (see 20260802_document_numbers.sql) increments inside a single statement, so
 * concurrency is the database's problem, and it stores an integer, so ordering is arithmetic and
 * the padding is only a display choice.
 */

const PAD = 4;

/**
 * The highest number ALREADY issued, read numerically rather than lexically.
 *
 * This seeds the counter so an existing workspace continues its series instead of restarting at 1.
 * It is passed on every call, not just the first, because documents can arrive by import after the
 * counter exists — and a counter that lags an import mints numbers that are already taken.
 *
 * Reading a page and taking the max in JS is deliberate: `order("data->>number")` is the text sort
 * that caused the second bug, and there is no numeric index on a JSON field to order by instead.
 */
async function highestIssued(workspaceId: string, objectType: "quote" | "invoice"): Promise<number> {
  let highest = 0;
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await supabase
      .from("nodes")
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("vertical", "finance")
      .eq("object_type", objectType)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read existing ${objectType} numbers: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) {
      const raw = String((row.data as Record<string, unknown> | undefined)?.number ?? "");
      const n = parseInt(raw.replace(/\D/g, ""), 10);
      if (Number.isFinite(n) && n > highest) highest = n;
    }
    if (rows.length < PAGE) break;
  }
  return highest;
}

/**
 * Claim the next number for a document type.
 *
 * Throws rather than falling back to the old read-then-add when the counter is unavailable. A
 * fallback here would be worse than an error: it would silently restore the duplicate-number race
 * at exactly the moment something is already wrong, and a duplicate invoice number is discovered
 * by a customer, not by us.
 */
export async function nextDocumentNumber(
  workspaceId: string,
  objectType: "quote" | "invoice",
  prefix: string,
): Promise<string> {
  const seed = await highestIssued(workspaceId, objectType);
  const { data, error } = await supabase.rpc("next_document_number", {
    ws: workspaceId,
    doc_type: objectType,
    seed_from: seed,
  });
  if (error) throw new Error(`Could not allocate a ${objectType} number: ${error.message}`);
  const n = Number(data);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Counter returned an unusable ${objectType} number.`);
  return `${prefix}-${String(n).padStart(PAD, "0")}`;
}

export const nextInvoiceNumber = (ws: string) => nextDocumentNumber(ws, "invoice", "INV");
export const nextQuoteNumber = (ws: string) => nextDocumentNumber(ws, "quote", "QUO");
