/**
 * A minimal, dependency-free PDF writer — the same sovereignty decision as lib/xlsx.
 *
 * PDF 1.4, uncompressed content streams, and the two Helvetica core fonts every reader ships
 * (nothing embedded). Text is WinAnsi/Latin-1: characters outside it are transliterated to '?',
 * which is the honest degradation for a format we refuse to pull a font-embedding library for.
 * The drawing surface is exactly what a report needs — text, lines, filled rectangles, polylines
 * (solid or dashed) — nothing else is implemented.
 *
 * Coordinates: PDF's origin is bottom-left; this writer keeps that convention and the report
 * layer converts from its own top-down cursor.
 */

export const A4 = { w: 595.28, h: 841.89 };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
/**
 * Latin-1-encodable text only; everything else becomes '?' rather than corrupting the stream.
 * The typography this product actually writes (em-dashes, arrows, ellipses, curly quotes) is
 * transliterated first — those were rendering as '?' in every heading before the map existed.
 */
const TRANSLIT: Record<string, string> = { "—": "-", "–": "-", "→": ">", "←": "<", "−": "-", "…": "...", "’": "'", "‘": "'", "“": '"', "”": '"', "✓": "v", "Δ": "d", "Σ": "S" };
const latin1 = (s: string) => Array.from(s).map(ch => TRANSLIT[ch] ?? (ch.charCodeAt(0) <= 0xff ? ch : "?")).join("");

export interface TextOpts { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center"; maxWidth?: number }

/**
 * Helvetica advance widths (thousandths of an em) for WinAnsi — the standard AFM table, needed so
 * right/center alignment and truncation measure REAL glyph widths, not a guess.
 */
const HELV: Record<string, number> = { " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, "{": 334, "|": 260, "}": 334, "~": 584 };

export function textWidth(s: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of latin1(s)) units += (HELV[ch] ?? 556) * (bold ? 1.06 : 1);
  return (units / 1000) * size;
}

/** Trim with an ellipsis to fit maxWidth — measurement-based, so it never overruns a column. */
export function fitText(s: string, size: number, maxWidth: number, bold = false): string {
  if (textWidth(s, size, bold) <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && textWidth(out + "…", size, bold) > maxWidth) out = out.slice(0, -1);
  return out + "…";
}

export class PdfDoc {
  private pages: string[] = [];
  private ops: string[] = [];

  newPage(): void {
    if (this.ops.length) this.pages.push(this.ops.join("\n"));
    this.ops = [];
  }

  text(x: number, y: number, raw: string, o: TextOpts = {}): void {
    const size = o.size ?? 10;
    const s = latin1(o.maxWidth ? fitText(raw, size, o.maxWidth, o.bold) : raw);
    let tx = x;
    if (o.align === "right") tx = x - textWidth(s, size, o.bold);
    if (o.align === "center") tx = x - textWidth(s, size, o.bold) / 2;
    const [r, g, b] = o.color ?? [0.07, 0.09, 0.15];
    this.ops.push(`BT /${o.bold ? "F2" : "F1"} ${size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm (${esc(s)}) Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, o: { width?: number; color?: [number, number, number]; dash?: [number, number] } = {}): void {
    const [r, g, b] = o.color ?? [0.9, 0.91, 0.92];
    this.ops.push(`q ${o.dash ? `[${o.dash[0]} ${o.dash[1]}] 0 d ` : ""}${(o.width ?? 0.75).toFixed(2)} w ${r} ${g} ${b} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
  }

  rect(x: number, y: number, w: number, h: number, color: [number, number, number]): void {
    const [r, g, b] = color;
    this.ops.push(`q ${r} ${g} ${b} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`);
  }

  polyline(points: [number, number][], o: { width?: number; color?: [number, number, number]; dash?: [number, number] } = {}): void {
    if (points.length < 2) return;
    const [r, g, b] = o.color ?? [0, 0, 0];
    const path = points.map(([x, y], i) => `${x.toFixed(2)} ${y.toFixed(2)} ${i ? "l" : "m"}`).join(" ");
    this.ops.push(`q ${o.dash ? `[${o.dash[0]} ${o.dash[1]}] 0 d ` : ""}${(o.width ?? 1.5).toFixed(2)} w ${r} ${g} ${b} RG 1 j 1 J ${path} S Q`);
  }

  /** Serialise: xref offsets are BYTE positions, so everything is measured in latin-1 lengths. */
  finish(): Uint8Array {
    this.newPage();
    const objects: string[] = [];   // 1-indexed body of each object
    const pageCount = this.pages.length || 1;
    const pageObjIds = Array.from({ length: pageCount }, (_, i) => 4 + i * 2);

    objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);                                     // 1
    objects.push(`<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`); // 2
    objects.push(`<< /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> >>`); // 3
    (this.pages.length ? this.pages : [""]).forEach(content => {
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font 3 0 R >> /Contents ${objects.length + 2} 0 R >>`);
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
