/**
 * Meeting Types (Phase 1) — a classification layer on calendar meetings that will LATER drive
 * type-specific AI captions/summaries/follow-ups. For now it is purely a stored label + human copy;
 * NO AI behaviour is wired to it yet. Stored in the event node's `data.meeting_type`; default "general".
 *
 * Shared by the API (enum + validation + guest-safe labels) and the app (selector + display), so the
 * canonical list can never drift between them.
 */
export const MEETING_TYPES = [
  "general",
  "sales",
  "support",
  "hiring_interview",
  "internal_sync",
  "client_review",
  "onboarding",
  "training",
  "legal_or_compliance",
  "finance_review",
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export const DEFAULT_MEETING_TYPE: MeetingType = "general";

export function isMeetingType(v: unknown): v is MeetingType {
  return typeof v === "string" && (MEETING_TYPES as readonly string[]).includes(v);
}
/** Normalise any stored/legacy value to a valid type — absent/unknown → general (preserves old events). */
export function normalizeMeetingType(v: unknown): MeetingType {
  return isMeetingType(v) ? v : DEFAULT_MEETING_TYPE;
}

/** Member-facing label + a plain, honest description of what the type will later focus on. No AI claim. */
export const MEETING_TYPE_META: Record<MeetingType, { label: string; description: string }> = {
  general:             { label: "General",              description: "A standard meeting — notes and follow-ups stay general." },
  sales:               { label: "Sales",                description: "Sales conversation — will later surface opportunity and follow-up cues." },
  support:             { label: "Support",              description: "Support session — will later highlight the issue and its resolution." },
  hiring_interview:    { label: "Hiring interview",     description: "Interview — will later focus notes on the hiring conversation." },
  internal_sync:       { label: "Internal sync",        description: "Team sync — will later focus on decisions and action items." },
  client_review:       { label: "Client review",        description: "Client review — will later focus on status and next steps." },
  onboarding:          { label: "Onboarding",            description: "Onboarding — will later focus on setup steps and questions." },
  training:            { label: "Training",              description: "Training session — will later focus on topics covered." },
  legal_or_compliance: { label: "Legal / compliance",   description: "Legal or compliance meeting — handled with extra care later." },
  finance_review:      { label: "Finance review",        description: "Finance review — will later focus on figures and decisions." },
};

/**
 * Type-aware POST-CALL summary sections (Phase 2). These are ADDITIONAL, transcript-grounded sections
 * the meeting analyst may fill AFTER a transcript exists — never live, never fabricated. `general` has
 * none (its summary stays exactly today's overview + decisions + action items). A section is only ever
 * stored when the transcript actually supports it; empty sections are omitted, not invented.
 */
export interface MeetingSection { key: string; label: string }
export const MEETING_TYPE_SECTIONS: Record<MeetingType, MeetingSection[]> = {
  general: [],
  sales: [
    { key: "pain_points", label: "Pain points" }, { key: "objections", label: "Objections" },
    { key: "buying_signals", label: "Buying signals" }, { key: "stakeholders", label: "Stakeholders" },
    { key: "follow_ups", label: "Follow-ups" }, { key: "next_step", label: "Next step" },
  ],
  support: [
    { key: "issue", label: "Issue" }, { key: "impact", label: "Impact" },
    { key: "troubleshooting", label: "Troubleshooting" }, { key: "resolution_status", label: "Resolution / status" },
    { key: "follow_up", label: "Follow-up" },
  ],
  hiring_interview: [
    { key: "candidate_background", label: "Candidate background" }, { key: "strengths", label: "Strengths raised" },
    { key: "concerns", label: "Concerns raised" }, { key: "role_fit", label: "Role fit (as discussed)" },
    { key: "follow_up", label: "Follow-up" }, { key: "interviewer_notes", label: "Interviewer notes" },
  ],
  internal_sync: [
    { key: "decisions", label: "Decisions" }, { key: "blockers", label: "Blockers" },
    { key: "owners", label: "Owners" }, { key: "deadlines", label: "Deadlines" },
  ],
  client_review: [
    { key: "outcomes", label: "Outcomes" }, { key: "risks", label: "Risks" },
    { key: "open_questions", label: "Open questions" }, { key: "commitments", label: "Commitments" },
    { key: "renewal_expansion_signals", label: "Renewal / expansion signals" },
  ],
  onboarding: [
    { key: "setup_status", label: "Setup status" }, { key: "questions", label: "Questions" },
    { key: "blockers", label: "Blockers" }, { key: "next_steps", label: "Next steps" },
  ],
  training: [
    { key: "topics_covered", label: "Topics covered" }, { key: "comprehension_signals", label: "Comprehension signals" },
    { key: "homework_follow_up", label: "Homework / follow-up" },
  ],
  legal_or_compliance: [
    { key: "reviewed_topics", label: "Reviewed topics" }, { key: "risks", label: "Risks" },
    { key: "obligations", label: "Obligations" }, { key: "approvals_needed", label: "Approvals needed" },
    { key: "open_legal_questions", label: "Open legal questions" },
  ],
  finance_review: [
    { key: "figures_discussed", label: "Figures discussed" }, { key: "risks", label: "Risks" },
    { key: "approvals", label: "Approvals" }, { key: "follow_ups", label: "Follow-ups" },
  ],
};

/**
 * Build the type-aware guidance appended to the (unchanged) transcript-grounded extraction prompt.
 * Returns "" for types with no sections (general) so their prompt/behaviour is unchanged. Encodes the
 * hard honesty rules: transcript-grounded only, omit unsupported sections, and — for interviews — no
 * scoring/ranking and no protected-class judgments.
 */
export function summarySectionsGuidance(type: MeetingType): string {
  const sections = MEETING_TYPE_SECTIONS[type];
  if (!sections.length) return "";
  const labels = sections.map((s) => `"${s.label}" (key: ${s.key})`).join(", ");
  let g = ` This is a ${MEETING_TYPE_META[type].label} meeting. In ADDITION to the fields above, populate summary_sections with ONLY these sections, and ONLY when the transcript supports them: ${labels}. Each section holds short bullet points quoting or paraphrasing what was actually said. If a section was not discussed, OMIT it (or return an empty points array) — never invent points, owners, figures, or outcomes.`;
  if (type === "hiring_interview") {
    g += " For this interview: capture ONLY what was explicitly said. Do NOT score, rate, rank, or recommend the candidate. Do NOT infer or comment on any protected characteristic (age, race, ethnicity, gender, religion, disability, national origin, marital or family status, etc.). List strengths and concerns strictly as they were raised in the conversation.";
  }
  return g;
}

/**
 * Guest-safe label — what an EXTERNAL guest may see on the prejoin screen. Sensitive/internal types
 * (finance, legal/compliance, internal sync, sales) collapse to a neutral "Meeting" so nothing private
 * about the meeting's purpose leaks to an outsider. Only guest-appropriate types keep a real label.
 */
export function guestSafeMeetingLabel(type: MeetingType): string {
  switch (type) {
    case "support":          return "Support session";
    case "hiring_interview": return "Interview";
    case "client_review":    return "Review";
    case "onboarding":       return "Onboarding";
    case "training":         return "Training session";
    default:                 return "Meeting";   // general/sales/internal_sync/legal_or_compliance/finance_review → neutral
  }
}
