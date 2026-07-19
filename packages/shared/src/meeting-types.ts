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
