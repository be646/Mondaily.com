import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Nothing in the product advertises a feature it does not have.
 *
 * "Coming soon" is a promise with no delivery date attached to it, sitting in a surface the user
 * opened in order to DO something. Either the thing works, or it should not be on the screen —
 * a roadmap page is where intentions belong.
 *
 * The integrations catalogue carried five of these (Slack, Zapier, Typeform, Segment, Mailchimp),
 * and rendered the badge unconditionally so that Gmail, Outlook and Google Calendar — all fully
 * built — were labelled "Coming soon" as well. The page simultaneously promised what did not exist
 * and denied what did.
 */
const APP = join(__dirname, "../../../../apps/app/src");
const WEB_APP = join(__dirname, "../../../../apps/web/app");
const WEB_COMPONENTS = join(__dirname, "../../../../apps/web/components");

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Comments explain WHY something was removed and will legitimately quote the banned phrase. */
const rendered = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The roadmap page's entire purpose is stating what is planned. */
const EXEMPT = /apps[/\\]web[/\\]app[/\\](roadmap|changelog)[/\\]/;

describe("no feature is advertised before it exists", () => {
  it('nothing renders "coming soon"', () => {
    const offenders: string[] = [];
    for (const f of [...walk(APP), ...walk(WEB_APP), ...walk(WEB_COMPONENTS)]) {
      if (EXEMPT.test(f)) continue;
      if (/coming\s*soon/i.test(rendered(readFileSync(f, "utf8")))) {
        offenders.push(f.split(/[/\\]/).slice(-3).join("/"));
      }
    }
    expect(offenders,
      `"Coming soon" promises a feature the user cannot use, in a surface they opened to use ` +
      `something. Ship it or remove it:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
