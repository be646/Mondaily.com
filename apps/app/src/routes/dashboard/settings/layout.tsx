import { Building2, CreditCard, Database, Mail, Plug, Shield, Sparkles, User, Users } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const items = [
  ["account", User, "Account"], ["workspace", Building2, "Workspace"], ["members", Users, "Members & teams"],
  ["billing", CreditCard, "Billing"], ["objects", Database, "Objects & attributes"],
  ["integrations", Plug, "Integrations & API"], ["email", Mail, "Email & calendar"], ["security", Shield, "Security"], ["ask-mondaily", Sparkles, "Ask Mondaily"]
] as const;

export function SettingsLayout() {
  return <div className="flex h-full"><aside className="w-56 shrink-0 border-r border-white/10 px-3 py-6"><p className="mb-3 px-3 text-xs font-semibold uppercase text-slate-600">Settings</p>{items.map(([to, Icon, label]) => <NavLink key={to} to={to} className={({ isActive }) => `mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? "bg-white/[.06] text-white" : "text-slate-500 hover:text-slate-200"}`}><Icon size={14} />{label}</NavLink>)}</aside><main className="min-w-0 flex-1 overflow-auto"><div className="mx-auto max-w-3xl px-8 py-8"><Outlet /></div></main></div>;
}
