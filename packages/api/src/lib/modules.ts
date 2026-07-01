/**
 * Zoho-style per-module access control. On TOP of the workspace role, each member can be granted a
 * level per feature-module: "none" | "view" | "edit". Role sets a sensible default; an explicit
 * per-member override in workspace_members.module_access (jsonb) wins over the default.
 *
 * This replaces the one-off finance_role with a general matrix, while staying back-compatible:
 * the legacy finance_role still feeds the "finance" module default when no explicit override exists.
 */
export type AccessLevel = "none" | "view" | "edit";
export const ACCESS_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export interface ModuleDef { key: string; label: string; hint: string }
export const MODULES: ModuleDef[] = [
  { key: "crm", label: "CRM", hint: "Contacts, companies, deals, pipeline" },
  { key: "discovery", label: "Discovery", hint: "Lead & review discovery" },
  { key: "automations", label: "Automations", hint: "Workflows & agents" },
  { key: "campaigns", label: "Campaigns", hint: "Email & outreach sends" },
  { key: "finance", label: "Finance", hint: "Invoices, quotes, credit notes" },
  { key: "analytics", label: "Analytics", hint: "Dashboards & reports" },
];
export const MODULE_KEYS = MODULES.map((m) => m.key);

// Per-role defaults when a member has no explicit override for a module.
function roleDefault(role: string, moduleKey: string): AccessLevel {
  if (role === "owner" || role === "admin") return "edit";
  if (role === "viewer") return moduleKey === "finance" ? "none" : "view";
  // member: operate everything except finance (finance is opt-in via override / finance_role).
  return moduleKey === "finance" ? "none" : "edit";
}

// Legacy finance_role → finance-module level, used only when there's no explicit finance override.
function financeRoleLevel(financeRole: string | undefined): AccessLevel | null {
  switch (financeRole) {
    case "approver": return "edit";
    case "reviewer": return "view";
    case "member": return "edit";
    case "viewer": return "view";
    case "none": return "none";
    default: return null;
  }
}

/** Resolve one member's effective level for one module. */
export function resolveModuleLevel(
  role: string,
  moduleKey: string,
  moduleAccess: Record<string, string> | null | undefined,
  financeRole?: string,
): AccessLevel {
  const explicit = moduleAccess?.[moduleKey];
  if (explicit === "none" || explicit === "view" || explicit === "edit") return explicit;
  if (moduleKey === "finance") {
    const legacy = financeRoleLevel(financeRole);
    if (legacy) return legacy;
  }
  return roleDefault(role, moduleKey);
}

/** Full effective matrix for a member (every module → level). */
export function resolveModuleMatrix(
  role: string,
  moduleAccess: Record<string, string> | null | undefined,
  financeRole?: string,
): Record<string, AccessLevel> {
  const out: Record<string, AccessLevel> = {};
  for (const k of MODULE_KEYS) out[k] = resolveModuleLevel(role, k, moduleAccess, financeRole);
  return out;
}

/** True when the effective level meets or exceeds the required level. */
export function moduleAllows(
  role: string,
  moduleKey: string,
  need: AccessLevel,
  moduleAccess: Record<string, string> | null | undefined,
  financeRole?: string,
): boolean {
  return ACCESS_RANK[resolveModuleLevel(role, moduleKey, moduleAccess, financeRole)] >= ACCESS_RANK[need];
}
