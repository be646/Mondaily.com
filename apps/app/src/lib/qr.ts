// @ts-expect-error — vendored UMD module (MIT, Kazuhiko Arase), no types
import * as qrMod from "./vendor/qrcode-generator.js";
// UMD interop: Vite gives the factory as default, Node/tsx as the namespace itself.
const qrcodeFactory = ((qrMod as { default?: unknown }).default ?? qrMod) as (type: number, ecc: string) => { addData(t: string, m: string): void; make(): void; getModuleCount(): number; isDark(r: number, c: number): boolean };

/**
 * QR rendering for 2FA enrollment — the proven MIT `qrcode-generator` VENDORED as a local file
 * (offline asset: no npm resolution, no CDN at runtime; the otpauth secret never leaves the page).
 * Verified against a real decoder (jsQR harness) before shipping.
 */
export function qrSvg(text: string, sizePx = 176): string {
  const qr = qrcodeFactory(0, "M");   // type 0 = auto version, ECC M
  qr.addData(text, "Byte");
  qr.make();
  const n: number = qr.getModuleCount();
  const q = 4, total = n + q * 2;
  let rects = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rects += `<rect x="${c + q}" y="${r + q}" width="1" height="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><g fill="#000000">${rects}</g></svg>`;
}

export function qrMatrix(text: string): boolean[][] {
  const qr = qrcodeFactory(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n: number = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c) as boolean));
}
