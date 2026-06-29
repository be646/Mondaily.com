// Per-workspace MCP access keys. A key is a stateless, HMAC-signed opaque token
// (`msk_<base64url(payload)>.<hmac>`) so external AI clients can read a single
// workspace's graph without us storing a key table. Namespaced with an "mcp:"
// payload prefix so it can never be confused with an email tracking token.
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.EMAIL_TRACKING_SECRET || process.env.CRON_SECRET || "mondaily-dev-tracking-secret";
}
const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function sign(payload: string): string {
  return b64url(createHmac("sha256", secret()).update(payload).digest());
}

export function mintMcpToken(workspaceId: string): string {
  const p = b64url(`mcp:${workspaceId}`);
  return `msk_${p}.${sign(p)}`;
}

export function verifyMcpToken(token: string): string | null {
  if (!token || !token.startsWith("msk_")) return null;
  const raw = token.slice(4);
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const p = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(p);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const decoded = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return decoded.startsWith("mcp:") ? (decoded.slice(4) || null) : null;
  } catch {
    return null;
  }
}
