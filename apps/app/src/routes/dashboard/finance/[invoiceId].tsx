import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { ArrowLeft, Plus, Trash2, Send, CheckCircle, Download, Save, AlertTriangle } from "lucide-react";

type InvoiceStatus = "draft" | "sent" | "viewed" | "paid" | "overdue" | "cancelled";

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
}

interface Invoice {
  id: string;
  number: string;
  client_name: string;
  client_email?: string;
  client_address?: string;
  line_items: LineItem[];
  currency: string;
  subtotal: number;
  tax_total: number;
  total: number;
  status: InvoiceStatus;
  due_date?: string;
  notes?: string;
  sent_at?: string;
  paid_at?: string;
  created_at: string;
}

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft:     "text-zinc-400 bg-zinc-400/10",
  sent:      "text-blue-400 bg-blue-400/10",
  viewed:    "text-purple-400 bg-purple-400/10",
  paid:      "text-emerald-400 bg-emerald-400/10",
  overdue:   "text-red-400 bg-red-400/10",
  cancelled: "text-zinc-600 bg-zinc-600/10",
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function calcTotals(items: LineItem[]) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const tax_total = items.reduce((s, i) => s + i.quantity * i.unit_price * (i.tax_rate / 100), 0);
  return { subtotal, tax_total, total: subtotal + tax_total };
}

export function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: invoice, isLoading } = useQuery<Invoice>({
    queryKey: ["invoice", invoiceId],
    queryFn: () => apiClient.get<Invoice>(`/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  });

  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [items, setItems] = useState<LineItem[]>([{ description: "", quantity: 1, unit_price: 0, tax_rate: 20 }]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setClientName(invoice.client_name);
    setClientEmail(invoice.client_email ?? "");
    setClientAddress(invoice.client_address ?? "");
    setDueDate(invoice.due_date ? invoice.due_date.slice(0, 10) : "");
    setNotes(invoice.notes ?? "");
    setCurrency(invoice.currency);
    setItems(invoice.line_items?.length ? invoice.line_items : [{ description: "", quantity: 1, unit_price: 0, tax_rate: 20 }]);
    setDirty(false);
  }, [invoice]);

  const updateMutation = useMutation({
    mutationFn: (body: Partial<Invoice>) =>
      apiClient.patch<Invoice>(`/invoices/${invoiceId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setDirty(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/invoices/${invoiceId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      navigate("/finance/invoices");
    },
  });

  function save(extra?: Partial<Invoice>) {
    updateMutation.mutate({
      client_name: clientName,
      client_email: clientEmail || undefined,
      client_address: clientAddress || undefined,
      due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
      notes: notes || undefined,
      currency,
      line_items: items,
      ...extra,
    });
  }

  function updateItem(i: number, field: keyof LineItem, value: string | number) {
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
    setDirty(true);
  }

  function addItem() {
    setItems(prev => [...prev, { description: "", quantity: 1, unit_price: 0, tax_rate: 20 }]);
    setDirty(true);
  }

  function removeItem(i: number) {
    setItems(prev => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  const { subtotal, tax_total, total } = calcTotals(items);
  const isEditable = !invoice || ["draft", "sent"].includes(invoice.status);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">Loading…</div>;
  }

  if (!invoice) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-[13px] text-zinc-500">Invoice not found</div>
        <Link to="/finance/invoices" className="text-[12px] text-red-400 hover:text-red-300">← Back to invoices</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-white/[.06] px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/finance/invoices" className="text-zinc-500 hover:text-white transition-colors">
            <ArrowLeft size={15}/>
          </Link>
          <span className="text-[14px] font-semibold text-white">{invoice.number}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[invoice.status]}`}>
            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
          </span>
          {dirty && <span className="text-[11px] text-zinc-600 italic">Unsaved changes</span>}
        </div>

        <div className="flex items-center gap-2">
          {isEditable && (
            <button
              onClick={() => save()}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-white/[.08] px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-white/[.04] transition-colors disabled:opacity-50"
            >
              <Save size={12}/> Save
            </button>
          )}
          {invoice.status === "draft" && (
            <button
              onClick={() => save({ status: "sent" })}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-xl border-x border-t border-blue-500/40 border-b-[3px] border-b-blue-700 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              <Send size={12}/> Send Invoice
            </button>
          )}
          {["sent", "viewed", "overdue"].includes(invoice.status) && (
            <button
              onClick={() => save({ status: "paid" })}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-xl border-x border-t border-emerald-500/40 border-b-[3px] border-b-emerald-700 bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              <CheckCircle size={12}/> Mark as Paid
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-white/[.08] px-3 py-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 hover:bg-white/[.03] transition-colors"
          >
            <Download size={12}/> PDF
          </button>
        </div>
      </div>

      {/* Body — two columns on wide, single on narrow */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">

          {invoice.status === "overdue" && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12px] text-red-400">
              <AlertTriangle size={13}/>
              This invoice is overdue. Consider sending a payment reminder.
            </div>
          )}

          {/* Client + meta */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-4 space-y-3">
              <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Bill To</div>
              <div>
                <label className="text-[11px] text-zinc-600">Client name *</label>
                <input
                  value={clientName}
                  onChange={e => { setClientName(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  className="key-input mt-1 w-full text-[13px]"
                  placeholder="Client name"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-600">Email</label>
                <input
                  value={clientEmail}
                  onChange={e => { setClientEmail(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  type="email"
                  className="key-input mt-1 w-full text-[13px]"
                  placeholder="client@company.com"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-600">Address</label>
                <textarea
                  value={clientAddress}
                  onChange={e => { setClientAddress(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  rows={2}
                  className="key-input mt-1 w-full resize-none text-[13px]"
                  placeholder="Billing address"
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-4 space-y-3">
              <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Details</div>
              <div>
                <label className="text-[11px] text-zinc-600">Invoice number</label>
                <input value={invoice.number} disabled className="key-input mt-1 w-full text-[13px] opacity-50"/>
              </div>
              <div>
                <label className="text-[11px] text-zinc-600">Due date</label>
                <input
                  value={dueDate}
                  onChange={e => { setDueDate(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  type="date"
                  className="key-input mt-1 w-full text-[13px]"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-600">Currency</label>
                <select
                  value={currency}
                  onChange={e => { setCurrency(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  className="key-input mt-1 w-full text-[13px]"
                >
                  <option value="GBP">GBP — £</option>
                  <option value="USD">USD — $</option>
                  <option value="EUR">EUR — €</option>
                  <option value="AED">AED — د.إ</option>
                </select>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] overflow-hidden">
            <div className="border-b border-white/[.04] px-4 py-3 flex items-center justify-between">
              <span className="text-[12px] font-medium text-white">Line Items</span>
              {isEditable && (
                <button onClick={addItem} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  <Plus size={11}/> Add item
                </button>
              )}
            </div>

            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[.04]">
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-zinc-600">Description</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-zinc-600 w-16">Qty</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-zinc-600 w-28">Unit Price</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-zinc-600 w-20">Tax %</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-zinc-600 w-28">Total</th>
                  {isEditable && <th className="w-10"/>}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const lineTotal = item.quantity * item.unit_price * (1 + item.tax_rate / 100);
                  return (
                    <tr key={i} className="border-b border-white/[.03]">
                      <td className="px-4 py-2">
                        <input
                          value={item.description}
                          onChange={e => updateItem(i, "description", e.target.value)}
                          disabled={!isEditable}
                          placeholder="Description"
                          className="key-input w-full text-[12px]"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={item.quantity}
                          onChange={e => updateItem(i, "quantity", parseFloat(e.target.value) || 0)}
                          disabled={!isEditable}
                          type="number"
                          min="0"
                          step="1"
                          className="key-input w-full text-right text-[12px]"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={item.unit_price}
                          onChange={e => updateItem(i, "unit_price", parseFloat(e.target.value) || 0)}
                          disabled={!isEditable}
                          type="number"
                          min="0"
                          step="0.01"
                          className="key-input w-full text-right text-[12px]"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={item.tax_rate}
                          onChange={e => updateItem(i, "tax_rate", parseFloat(e.target.value) || 0)}
                          disabled={!isEditable}
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          className="key-input w-full text-right text-[12px]"
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-[12px] font-medium text-white">
                        {formatCurrency(lineTotal, currency)}
                      </td>
                      {isEditable && (
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => removeItem(i)}
                            disabled={items.length === 1}
                            className="rounded p-1 text-zinc-700 hover:text-red-400 disabled:opacity-20 transition-colors"
                          >
                            <Trash2 size={11}/>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Totals */}
            <div className="flex justify-end border-t border-white/[.04] px-4 py-3">
              <div className="w-56 space-y-1.5">
                <div className="flex justify-between text-[12px] text-zinc-500">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal, currency)}</span>
                </div>
                <div className="flex justify-between text-[12px] text-zinc-500">
                  <span>Tax</span>
                  <span>{formatCurrency(tax_total, currency)}</span>
                </div>
                <div className="flex justify-between border-t border-white/[.06] pt-1.5 text-[14px] font-semibold text-white">
                  <span>Total</span>
                  <span>{formatCurrency(total, currency)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] text-zinc-600">Notes / Payment instructions</label>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setDirty(true); }}
              disabled={!isEditable}
              rows={3}
              className="key-input mt-1 w-full resize-none text-[12px]"
              placeholder="Bank details, payment terms, thank you message…"
            />
          </div>

          {/* Danger zone */}
          {["draft", "cancelled"].includes(invoice.status) && (
            <div className="flex justify-end pt-2">
              <button
                onClick={() => { if (confirm("Delete this invoice?")) deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
                className="text-[11px] text-zinc-700 hover:text-red-400 transition-colors"
              >
                Delete invoice
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
