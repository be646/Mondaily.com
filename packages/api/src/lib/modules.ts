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

export interface ModuleDef { key: string; label: string; hint: string; optional?: boolean }
// THE single module registry (business-model vocabulary — never "CRM"). Core modules are always
// present; optional modules only appear once enabled in Settings → Workspace → Modules. The
// optional keys (finance/investments/hr) MATCH the workspace-settings toggle ids so the two
// surfaces share one taxonomy instead of duplicating it.
export const MODULES: ModuleDef[] = [
  { key: "graph", label: "Graph", hint: "Contacts, companies, deals, pipeline" },
  { key: "discovery", label: "Discovery", hint: "Lead & review discovery" },
  { key: "automations", label: "Automations", hint: "Workflows & agents" },
  { key: "communications", label: "Communications", hint: "Emails, calls, notes" },
  { key: "reports", label: "Reports", hint: "Dashboards & reports" },
  { key: "finance", label: "Finance & Billing", hint: "Invoices, quotes, credit notes, approvals", optional: true },
  { key: "investments", label: "Quantitative Asset Systems", hint: "Asset portfolios, rounds, returns", optional: true },
  { key: "hr", label: "Autonomous Workforce", hint: "Headcount, contracts, operational intelligence", optional: true },
];
export const MODULE_KEYS = MODULES.map((m) => m.key);
export const OPTIONAL_MODULE_KEYS = MODULES.filter((m) => m.optional).map((m) => m.key);

/** The modules a workspace actually exposes: all core + the optional ones it has enabled. */
export function enabledModules(settingsModules: string[] | null | undefined): ModuleDef[] {
  const enabled = new Set(settingsModules ?? []);
  return MODULES.filter((m) => !m.optional || enabled.has(m.key));
}

const OPTIONAL = new Set(OPTIONAL_MODULE_KEYS);
// Per-role defaults when a member has no explicit override for a module.
function roleDefault(role: string, moduleKey: string): AccessLevel {
  if (role === "owner" || role === "admin") return "edit";
  // Optional modules (Finance & Billing, Quantitative Asset Systems, Autonomous Workforce) are
  // opt-in: no access until explicitly granted, regardless of role.
  if (OPTIONAL.has(moduleKey)) return "none";
  if (role === "viewer") return "view";
  return "edit"; // member: edit on the core modules
}

// Legacy finance_role → finance-module level, used only when there's no explicit finance override.
// "none"/unset returns null (NO signal → fall through to the role default) — it must NOT force
// access to "none", or every member (incl. owners, whose finance_role defaults to "none") would
// lose finance even when the module is enabled. Only POSITIVE grants map to a level.
function financeRoleLevel(financeRole: string | undefined): AccessLevel | null {
  switch (financeRole) {
    case "approver": return "edit";
    case "reviewer": return "view";
    case "member": return "edit";
    case "viewer": return "view";
    default: return null; // "none" / unset → no signal
  }
}

/** Resolve one member's effective level for one module. */
export function resolveModuleLevel(
  role: string,
  moduleKey: string,
  moduleAccess: Record<string, string> | null | undefined,
  financeRole?: string,
): AccessLevel {
  // Owners & admins always have full access — never gated by an override or a legacy finance_role.
  if (role === "owner" || role === "admin") return "edit";
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
