/**
 * A minimal, dependency-free XLSX writer.
 *
 * An .xlsx file is a ZIP archive of OOXML parts. Writing one in-house keeps the report
 * pipeline fully sovereign — no spreadsheet library, no external service ever sees the
 * workspace's numbers. The subset implemented is deliberately small and standard:
 *
 *   - ZIP with STORED entries (no compression). Every reader — Excel, Numbers, LibreOffice,
 *     Google Sheets import — accepts stored entries; compression would need a DEFLATE
 *     implementation for a size win that does not matter at report scale.
 *   - Inline strings (`t="inlineStr"`), so there is no sharedStrings table to maintain.
 *   - Three cell styles: default, bold (header rows), and a 2-decimal thousands format
 *     applied to non-integer numbers so money reads as money.
 *
 * Charts are NOT written into the workbook: OOXML chart parts are an order of magnitude more
 * format surface, and the HTML report ships the charts instead. The workbook carries the data.
 */

export interface XlsxSheet {
  name: string;
  /** Row-major cells. Strings become text cells, finite numbers numeric cells, null/undefined blank. */
  rows: (string | number | null | undefined)[][];
  /** Optional explicit column widths (in characters). Defaults to measured content width. */
  widths?: number[];
}

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
   // Control chars are illegal in XML 1.0 and make Excel reject the whole file.
   .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Column index (0-based) → A1-style letters. */
export const colRef = (i: number): string => {
  let n = i + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/** Excel sheet names: ≤31 chars, none of []:*?/\ — enforced here so callers cannot produce a corrupt book. */
const sheetName = (raw: string, index: number): string => {
  const cleaned = raw.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
};

function sheetXml(sheet: XlsxSheet): string {
  const colCount = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths = Array.from({ length: colCount }, (_, c) => {
    if (sheet.widths?.[c]) return sheet.widths[c]!;
    let w = 8;
    for (const row of sheet.rows) {
      const v = row[c];
      if (v == null) continue;
      w = Math.max(w, Math.min(60, String(typeof v === "number" ? v.toFixed(2) : v).length + 2));
    }
    return w;
  });
  const cols = colCount
    ? `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rows = sheet.rows.map((row, r) => {
    const cells = row.map((v, c) => {
      if (v == null || v === "") return "";
      const ref = `${colRef(c)}${r + 1}`;
      if (typeof v === "number" && Number.isFinite(v)) {
        const style = Number.isInteger(v) ? (r === 0 ? 1 : 0) : 2;
        return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
      }
      const s = r === 0 ? ` s="1"` : "";
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
  `<cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs>` +
  `</styleSheet>`;

// ── ZIP (stored entries only) ────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries: { name: string; data: Uint8Array }[], stamp: Date): Uint8Array {
  // DOS timestamp of generation — cosmetic metadata inside the archive.
  const dosTime = ((stamp.getHours() << 11) | (stamp.getMinutes() << 5) | (stamp.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((stamp.getFullYear() - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate()) & 0xffff;

  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ]);
    chunks.push(local, e.data);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(e.data.length), ...u32(e.data.length), ...u16(nameBytes.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ...nameBytes,
    ]));
    offset += local.length + e.data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, eocd]) { out.set(c, p); p += c.length; }
  return out;
}

/** Build a complete .xlsx workbook from sheets of rows. */
export function buildXlsx(sheets: XlsxSheet[], generatedAt: Date = new Date()): Uint8Array {
  const named = sheets.map((s, i) => ({ ...s, name: sheetName(s.name, i) }));
  const enc = (s: string) => new TextEncoder().encode(s);

  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `</Types>`;

  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    named.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets></workbook>`;

  const wbRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", data: enc(contentTypes) },
    { name: "_rels/.rels", data: enc(rootRels) },
    { name: "xl/workbook.xml", data: enc(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(wbRels) },
    { name: "xl/styles.xml", data: enc(STYLES) },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s)) })),
  ], generatedAt);
}
