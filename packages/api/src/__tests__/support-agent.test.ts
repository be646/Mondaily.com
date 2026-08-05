import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pricingFacts } from "@mondaily/shared/pricing";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const support = read("routes/support.ts");

/**
 * The support agent talks to paying customers who are stuck.
 */
describe("it knows plans and payments", () => {
  it("quotes the SAME pricing as the marketing chat", () => {
    // PRICING_FACTS lived privately in the marketing route, so the public bot could answer
    // "what does Command cost?" while the in-app agent talking to a paying customer could not.
    expect(support).toMatch(/pricingFacts\(\)/);
    expect(read("routes/public-ask.ts")).toMatch(/pricingFacts\(\)/);
  });

  it("the facts carry real numbers, not placeholders", () => {
    const f = pricingFacts();
    expect(f).toMatch(/Scout: free/);
    expect(f).toMatch(/Operator: \$\d+\/mo/);
    expect(f).toMatch(/Command: \$\d+\/mo/);
    expect(f).toMatch(/credit-pack bonus/);
  });

  it("says 'custom' for Sovereign rather than printing a confident zero", () => {
    // monthlyCredits is nullable; a bot quoting "0 credits" is worse than one saying "custom".
    expect(pricingFacts()).not.toMatch(/Sovereign[^\n]*\b0 AI credits/);
  });

  it("refuses to improvise commercial terms", () => {
    expect(support).toMatch(/never improvise a price/);
  });
});

describe("it knows what is happening in THIS workspace", () => {
  it("reads the work, not just the plan", () => {
    // Without these it knew the tier and the balance but nothing about the deals, tasks, decisions
    // or agents — which is most of what a support chat is actually about.
    expect(support).toMatch(/ilike\("object_type", "deal%"\)/);
    expect(support).toMatch(/decision_queue/);
    expect(support).toMatch(/agent_runs/);
  });

  it("puts those facts in the prompt, not merely in the response", () => {
    expect(support).toMatch(/Workspace contents: \$\{r\.deals\} deal/);
    expect(support).toMatch(/Recent agent runs/);
  });

  it("says 'none recorded' rather than implying agents are working", () => {
    // The failure mode for a support bot is comforting fiction.
    expect(support).toMatch(/none recorded — say exactly that if asked, do not imply agents are working/);
  });
});

describe("it behaves like a person", () => {
  it("asks ONE clarifying question when the request is ambiguous", () => {
    expect(support).toMatch(/ASK WHEN YOU DON'T KNOW ENOUGH/);
    expect(support).toMatch(/One question, not a checklist/);
  });

  it("leads with the answer and gives one next step", () => {
    expect(support).toMatch(/LEAD WITH THE ANSWER/);
    expect(support).toMatch(/GIVE ONE NEXT STEP, not five/);
  });

  it("bans performed sympathy and padding", () => {
    // "I completely understand your frustration" helps nobody who is stuck.
    expect(support).toMatch(/no performed sympathy/);
    expect(support).toMatch(/No "Great question!"/);
  });

  it("still cannot claim actions it did not take", () => {
    // The pre-existing guarantee must survive the tone change.
    expect(support).toMatch(/NEVER say "I upgraded you"/);
    expect(support).toMatch(/READ-ONLY/);
  });
});

describe("it can see what actually broke", () => {
  it("reads this workspace's unresolved errors from the last 48h", () => {
    // "It's broken" could previously only be answered with a question. Now the agent can name the
    // failure the user already hit.
    expect(support).toMatch(/from\("client_errors"\)/);
    expect(support).toMatch(/gte\("last_seen_at"/);
    expect(support).toMatch(/CHECK THESE FIRST and name the one that matches/);
  });

  it("tolerates the table being absent rather than breaking the answer", () => {
    expect(support).toMatch(/errorsRes\.data \?\? \[\]/);
  });
});

describe("escalation carries the investigation", () => {
  it("a ticket ships the diagnostics the agent already ran", () => {
    // The agent investigated and then threw the results away at the exact moment they became
    // useful — the human reopened the same questions the user had already answered.
    expect(support).toMatch(/diagnostics: \{[\s\S]{0,400}sovereign_search: ctx\.diagnostics\.sovereign_search/);
    expect(support).toMatch(/recent_errors: ctx\.readiness\.recent_errors/);
  });
});

describe("the queue is ordered by who is waiting", () => {
  const plat = read("routes/platform-support.ts");

  it("'answered' means SUPPORT replied, not that the thread has messages", () => {
    // A requester posting three follow-ups because nobody answered is the opposite of answered,
    // yet sorting by last activity floated exactly those to the top as if handled.
    //
    // Asserted as "not the requester" rather than a specific reply role. The original test pinned
    // `=== "admin"`, which was the BUG rather than the behaviour: this dashboard writes replies as
    // "mondaily", so tickets answered from it counted as unanswered forever and the SLA number got
    // worse the more replies we sent. Naming every non-customer role is what the rule actually is.
    expect(plat).toMatch(/comments\.some\(\(cm\) => cm\.author_role !== "requester"\)/);
  });

  it("unanswered and oldest sort FIRST", () => {
    expect(plat).toMatch(/if \(a\.waiting_hours != null && b\.waiting_hours != null\) return b\.waiting_hours - a\.waiting_hours/);
  });

  it("waiting_on_user is excluded — the ball is with the customer", () => {
    // Counting it would inflate the number and hide the tickets we actually owe.
    expect(plat).toMatch(/status === "open" \|\| n\.data\.status === "in_review"/);
    expect(plat).toMatch(/ball is with the customer/);
  });

  it("reports the LONGEST wait, not an average", () => {
    expect(plat).toMatch(/longest_wait_hours/);
  });
});
