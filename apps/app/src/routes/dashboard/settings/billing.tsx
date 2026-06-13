import { useQuery } from "@tanstack/react-query";
import { CreditCard, Download, Users } from "lucide-react";
import { apiClient } from "../../../lib/api-client";
import { PageHeader, PageSkeleton } from "../../../components/ui/page-state";

interface Billing { plan: string; seats_used: number; seats_limit: number; next_billing_date?: string; card_last4?: string; invoices: { id: string; date: string; amount: number; pdf_url: string }[] }

export function BillingSettings() {
  const query = useQuery({ queryKey: ["billing"], queryFn: () => apiClient.get<Billing>("/billing") });
  if (query.isLoading) return <PageSkeleton />;
  const billing = query.data ?? { plan: "free", seats_used: 1, seats_limit: 3, invoices: [] };
  return <div><PageHeader title="Billing" description="Manage your plan and payment details." /><section className="mb-5 rounded-xl border border-white/[.07] p-5"><div className="flex justify-between"><div><p className="text-sm font-semibold capitalize">{billing.plan} plan</p><p className="mt-1 text-sm text-slate-500">{billing.next_billing_date ? `Next billing ${new Date(billing.next_billing_date).toLocaleDateString()}` : "No upcoming charge"}</p></div><button onClick={() => { window.location.href = "/api/v1/billing/portal"; }} className="rounded-lg border-x border-t border-red-500/40 border-b-[3px] border-b-red-700 bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 active:translate-y-[1px] transition-all">{billing.plan === "free" ? "Upgrade" : "Manage plan"}</button></div><div className="mt-5 flex items-center gap-3 rounded-md bg-white/[.03] p-3"><Users size={15} className="text-slate-500" /><span className="text-sm">Seats</span><span className="ml-auto text-sm">{billing.seats_used} / {billing.seats_limit}</span></div></section>{billing.card_last4 ? <section className="mb-5 rounded-xl border border-white/[.07] p-5"><h2 className="mb-3 flex items-center gap-2 text-sm font-medium"><CreditCard size={15} /> Payment method</h2><p className="text-sm text-slate-500">Card ending {billing.card_last4}</p></section> : null}<section className="rounded-xl border border-white/[.07] p-5"><h2 className="mb-3 text-sm font-medium">Invoice history</h2>{billing.invoices.length ? billing.invoices.map((invoice) => <a key={invoice.id} href={invoice.pdf_url} className="flex justify-between border-t border-white/[.06] py-3 text-sm"><span>{new Date(invoice.date).toLocaleDateString()} · ${(invoice.amount / 100).toFixed(2)}</span><Download size={14} /></a>) : <p className="text-sm text-slate-500">No invoices yet.</p>}</section></div>;
}
