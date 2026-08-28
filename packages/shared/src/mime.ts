/**
 * RFC 2047 encoded-word decoding for mail headers.
 *
 * The sovereign receiver hands the API a subject exactly as the sending client wrote the header,
 * and clients encode anything non-ASCII (and often plain ASCII replies too) as encoded-words —
 * which is how "=?UTF-8?Q?Re=3A_Sovereign_outbound…?=" ended up rendered verbatim as a subject in
 * the Emails list. Decoding belongs at BOTH ends: at ingest so new rows store clean text, and at
 * display so the rows stored before this existed also read correctly.
 *
 * Unknown charsets and malformed tokens decode as best-effort and NEVER throw — a subject line is
 * not worth failing mail ingestion over.
 */

const ENCODED_WORD = /=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g;

function decodeOne(charset: string, encoding: string, text: string): string {
  let bytes: Uint8Array;
  if (encoding.toUpperCase() === "B") {
    bytes = Uint8Array.from(atob(text.replace(/\s+/g, "")), (ch) => ch.charCodeAt(0));
  } else {
    // Q-encoding: underscore is space; =XX is a byte.
    const chars = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    bytes = Uint8Array.from(chars, (ch) => ch.charCodeAt(0) & 0xff);
  }
  return new TextDecoder(charset.toLowerCase()).decode(bytes);
}

/** Decode every RFC 2047 encoded-word in a header value; plain text passes through untouched. */
export function decodeMimeWords(value: string | null | undefined): string {
  const s = value ?? "";
  if (!s.includes("=?")) return s;
  // Whitespace BETWEEN two encoded-words is transport framing, not content (RFC 2047 §6.2).
  const joined = s.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(ENCODED_WORD, (whole, charset: string, enc: string, text: string) => {
    try { return decodeOne(charset, enc, text); } catch { return whole; }
  });
}
