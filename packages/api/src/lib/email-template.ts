/**
 * THE email shell — one design for every message Mondaily sends.
 *
 * The digest built its own HTML inline, so anything added later would have drifted from it within a
 * week. Email is also the one surface where our design system cannot help: no CSS variables, no
 * classes, no flexbox worth trusting. Clients strip <style> blocks, Outlook ignores modern layout,
 * and dark mode is applied TO you rather than by you. So this is deliberately old-fashioned —
 * tables, inline styles, hex colours — and centralised, so the constraints are solved once.
 *
 * It mirrors the app's language rather than copying its tokens: hairline borders, generous space,
 * one accent, real words instead of shouting. An email that looks like the product is trusted; one
 * that looks like a mail-merge is deleted.
 */

const BRAND = "#2f9e6b";      // the app's --status-ok / section accent
const INK = "#141414";
const MUTED = "#6b6b70";
const FAINT = "#9a9aa0";
const HAIRLINE = "#e8e8e4";
const CANVAS = "#f6f6f4";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export interface EmailAction { label: string; url: string }

/**
 * Wrap body HTML in the shell.
 *
 * `preheader` is the grey line every inbox shows next to the subject. Left unset, clients grab the
 * first words of the body — usually "View in browser" or a greeting — which wastes the one piece of
 * copy that decides whether the mail is opened at all.
 */
export function renderEmail(opts: {
  title: string;
  preheader: string;
  bodyHtml: string;
  action?: EmailAction;
  /** Small print under the action — context, not legalese. */
  footnote?: string;
  /**
   * Whether replying to this message actually reaches anyone.
   *
   * Defaults to false so the promise is opt-in. The footer used to state unconditionally that
   * replies "reach the same conversation" — true only where a Reply-To routes to a mailbox we
   * receive on. Printed on a deployment without sovereign receiving configured, it invited people
   * to reply into a void and then blamed them for not answering.
   */
  replyable?: boolean;
}): string {
  const { title, preheader, bodyHtml, action, footnote, replyable = false } = opts;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};font-family:${FONT};-webkit-font-smoothing:antialiased">
<!-- Preheader: shown beside the subject, hidden in the body itself. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="max-width:560px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:10px;overflow:hidden">

      <tr><td style="padding:22px 28px 0">
        <span style="font:600 13px ${FONT};color:${INK};letter-spacing:-.01em">Mondaily</span>
      </td></tr>

      <tr><td style="padding:14px 28px 0">
        <h1 style="margin:0;font:600 19px/1.35 ${FONT};color:${INK};letter-spacing:-.01em">${esc(title)}</h1>
      </td></tr>

      <tr><td style="padding:12px 28px 0;font:15px/1.6 ${FONT};color:${MUTED}">${bodyHtml}</td></tr>

      ${action ? `<tr><td style="padding:22px 28px 0">
        <a href="${esc(action.url)}" style="display:inline-block;background:${BRAND};color:#ffffff;
          font:600 14px ${FONT};text-decoration:none;padding:11px 20px;border-radius:7px">${esc(action.label)}</a>
      </td></tr>` : ""}

      ${footnote ? `<tr><td style="padding:14px 28px 0;font:13px/1.55 ${FONT};color:${FAINT}">${footnote}</td></tr>` : ""}

      <tr><td style="padding:24px 28px 22px">
        <div style="border-top:1px solid ${HAIRLINE};padding-top:14px;font:12px/1.6 ${FONT};color:${FAINT}">
          Sent by Mondaily.${replyable ? " You can reply to this email directly — replies reach the same conversation." : ""}
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** A quoted message block — the customer's words, or ours, visually set apart. */
export function quoteBlock(author: string, body: string, at?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="margin:14px 0;border-left:2px solid ${HAIRLINE}">
    <tr><td style="padding:2px 0 2px 14px">
      <div style="font:600 13px ${FONT};color:${INK}">${esc(author)}${at ? `<span style="font-weight:400;color:${FAINT}"> · ${esc(at)}</span>` : ""}</div>
      <div style="margin-top:4px;font:14px/1.6 ${FONT};color:${MUTED};white-space:pre-wrap">${esc(body)}</div>
    </td></tr></table>`;
}

/** Label/value rows for ticket context. Kept sparse — an email is not a dashboard. */
export function factRows(rows: { label: string; value: string }[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0">
    ${rows.map(r => `<tr>
      <td style="padding:5px 0;font:13px ${FONT};color:${FAINT};width:120px">${esc(r.label)}</td>
      <td style="padding:5px 0;font:13px ${FONT};color:${INK}">${esc(r.value)}</td>
    </tr>`).join("")}
  </table>`;
}
