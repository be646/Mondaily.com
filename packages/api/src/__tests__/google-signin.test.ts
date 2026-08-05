import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeGoogleIdentity, GOOGLE_LOGIN_SCOPES, GOOGLE_SCOPES } from "../lib/google";

/**
 * Sign in with Google — the decisions that must not quietly regress.
 *
 * Each of these is a security property, not a preference. Auto-linking a Google identity onto an
 * existing password account is safe ONLY because Google asserted the mailbox was verified; drop
 * that check and anyone who can create a Google account with someone's address owns their Mondaily
 * workspace.
 */
const auth = readFileSync(join(__dirname, "../routes/auth.ts"), "utf8");

function idToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
}

describe("decodeGoogleIdentity", () => {
  it("reads email_verified as both boolean and string", () => {
    // Google sends either depending on the flow; treating "true" as falsy would reject every
    // legitimate sign-in from whichever flow uses the string form.
    expect(decodeGoogleIdentity(idToken({ sub: "1", email: "A@Example.com", email_verified: true })!)?.emailVerified).toBe(true);
    expect(decodeGoogleIdentity(idToken({ sub: "1", email: "a@example.com", email_verified: "true" })!)?.emailVerified).toBe(true);
  });

  it("treats a missing or false flag as UNVERIFIED", () => {
    expect(decodeGoogleIdentity(idToken({ sub: "1", email: "a@example.com" }))?.emailVerified).toBe(false);
    expect(decodeGoogleIdentity(idToken({ sub: "1", email: "a@example.com", email_verified: false }))?.emailVerified).toBe(false);
  });

  it("normalises the email so linking cannot be dodged by case", () => {
    // credByEmail looks up a lowercased address; returning "A@Example.com" here would miss the
    // existing account and silently create a duplicate instead of linking.
    expect(decodeGoogleIdentity(idToken({ sub: "1", email: "  Bassem@Example.COM ", email_verified: true }))?.email)
      .toBe("bassem@example.com");
  });

  it("rejects a token with no subject or no email", () => {
    expect(decodeGoogleIdentity(idToken({ email: "a@example.com" }))).toBeNull();
    expect(decodeGoogleIdentity(idToken({ sub: "1" }))).toBeNull();
    expect(decodeGoogleIdentity(undefined)).toBeNull();
    expect(decodeGoogleIdentity("not.a.token")).toBeNull();
  });
});

describe("the callback's security properties", () => {
  it("refuses an unverified Google email BEFORE touching any account", () => {
    const gate = auth.indexOf("if (!who.emailVerified) return bounce(\"unverified\")");
    const lookup = auth.indexOf("const existing = await credByEmail(who.email)");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(lookup);
  });

  it("validates the CSRF state against a cookie", () => {
    // Without this an attacker completes the flow with their own code in the victim's browser.
    expect(auth).toMatch(/if \(!expected \|\| !state \|\| state !== expected\) return bounce\("state"\)/);
    expect(auth).toMatch(/deleteCookie\(c, GOOGLE_STATE_COOKIE/);   // single use
  });

  it("REFUSES sign-in when the account is linked to a different Google account", () => {
    // The first version enforced this with a filter on the UPDATE, which protected the column and
    // nothing else — the write matched no rows and a session was issued anyway. Not theoretical: a
    // reassigned Workspace address makes Google honestly report email_verified for the NEW holder
    // of an OLD email, and that would have signed them into their predecessor's workspace.
    const check = auth.indexOf("if (linkedSub && linkedSub !== who.sub)");
    const bounce = auth.indexOf('return bounce("linked_elsewhere")');
    const session = auth.indexOf("await issueSession(c, userId, who.email");
    expect(check).toBeGreaterThan(0);
    expect(bounce).toBeGreaterThan(check);
    expect(bounce).toBeLessThan(session);          // refused BEFORE any session exists
  });

  it("treats a failed link as a failed sign-in", () => {
    // Otherwise the account silently never carries its Google identity and every retry looks the same.
    expect(auth).toMatch(/if \(linkErr\) \{[\s\S]{0,200}return bounce\("link"\)/);
  });

  it("no longer interpolates the Google sub into a PostgREST filter string", () => {
    // `sub` is provider-controlled input; splicing it into an .or() filter is an injection surface
    // for a query language, and the explicit comparison above makes it unnecessary.
    expect(auth).not.toMatch(/\.or\(`google_sub/);
  });

  it("only ever redirects inside the app", () => {
    // An open redirect on an auth callback is a phishing primitive.
    expect(auth).toMatch(/raw\.startsWith\("\/"\) && !raw\.startsWith\("\/\/"\)/);
  });

  it("writes NO password hash for a Google-only account", () => {
    // A random hash nobody knows is still a password credential, and "forgot password" would reset
    // it — converting an OAuth account into a password account behind the user's back.
    expect(auth).toMatch(/user_id: userId, email: who\.email, password_hash: null/);
  });

  it("refuses password login against a null hash explicitly", () => {
    expect(auth).toMatch(/if \(!cred\.password_hash\) \{/);
  });
});

describe("consent scope", () => {
  it("asks for identity only — never mail or calendar", () => {
    // Requesting gmail.readonly to log somebody in is alarming on the consent screen and drags the
    // whole app into Google's restricted-scope review for a feature that needs none of it.
    expect(GOOGLE_LOGIN_SCOPES).toEqual(["openid", "email", "profile"]);
    for (const s of GOOGLE_LOGIN_SCOPES) expect(s).not.toMatch(/gmail|calendar/);
    // The integration scopes are a separate, later, opt-in consent.
    expect(GOOGLE_SCOPES.some(s => s.includes("gmail"))).toBe(true);
  });
});
