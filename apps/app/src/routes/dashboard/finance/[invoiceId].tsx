import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { FinanceAgentStrip } from "../../../components/ai/finance-agent-strip";
import { ArrowLeft, Plus, Trash2, Send, CheckCircle, Download, Save, AlertTriangle, ChevronDown } from "lucide-react";

type InvoiceStatus = "draft" | "sent" | "viewed" | "paid" | "overdue" | "cancelled";

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
}

interface Payment {
  id: string;
  amount: number;
  method: string;
  reference?: string | null;
  paid_at: string;
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
  payments?: Payment[];
}

interface CreditNote {
  id: string;
  amount_cents: number;
  currency: string;
  credit_reason: string;
  status: string;
}

// ─── Payments section ─────────────────────────────────────────────────────────
function PaymentsSection({ invoice }: { invoice: Invoice }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));

  const payments = invoice.payments ?? [];
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, invoice.total - totalPaid);

  useEffect(() => {
    if (expanded) setAmount(String(remaining.toFixed(2)));
  }, [expanded, remaining]);

  const recordPayment = useMutation({
    mutationFn: () => apiClient.post<Invoice>(`/invoices/${invoice.id}/payments`, {
      amount: parseFloat(amount) || 0,
      method,
      reference: reference || undefined,
      paid_at: new Date(paidAt).toISOString(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", invoice.id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setExpanded(false);
      setAmount("");
      setReference("");
    },
  });

  if (["draft", "cancelled"].includes(invoice.status)) return null;

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)] overflow-hidden">
      <div className="border-b border-[var(--border-soft)] px-4 py-3 flex items-center justify-between">
        <span className="text-[12px] font-medium text-[var(--text-primary)]">Payments</span>
        <button
          onClick={() => setExpanded(o => !o)}
          className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300 transition-colors"
        >
          <Plus size={11}/> Record payment
          <ChevronDown size={11} className={`ml-0.5 transition-transform ${expanded ? "rotate-180" : ""}`}/>
        </button>
      </div>

      {/* Payment list */}
      {payments.length > 0 && (
        <div className="px-4 py-2 space-y-1.5">
          {payments.map(p => (
            <div key={p.id} className="flex items-center justify-between py-1.5 text-[12px] border-b border-[var(--border-soft)] last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-primary)] font-medium">{formatCurrency(p.amount, invoice.currency)}</span>
                <span className="text-stone-600">·</span>
                <span className="text-stone-500 capitalize">{p.method.replace(/_/g, " ")}</span>
                {p.reference && <><span className="text-stone-700">·</span><span className="text-stone-600">{p.reference}</span></>}
              </div>
              <span className="text-stone-600">{new Date(p.paid_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary row */}
      <div className="px-4 py-2.5 flex justify-end">
        <div className="w-56 space-y-1.5">
          <div className="flex justify-between text-[12px] text-stone-500">
            <span>Total paid</span>
            <span className="text-emerald-400">{formatCurrency(totalPaid, invoice.currency)}</span>
          </div>
          {remaining > 0 && (
            <div className="flex justify-between text-[12px] text-stone-500 border-t border-[var(--border-soft)] pt-1.5">
              <span>Remaining</span>
              <span className="text-stone-400 font-medium">{formatCurrency(remaining, invoice.currency)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Inline form */}
      {expanded && (
        <div className="border-t border-[var(--border-soft)] px-4 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-stone-600">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                step="0.01"
                className="key-input mt-1 w-full text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-stone-600">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value)} className="key-input mt-1 w-full text-[13px]">
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] text-stone-600">Reference</label>
              <input
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="e.g. TXN-12345"
                className="key-input mt-1 w-full text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-stone-600">Date</label>
              <input
                type="date"
                value={paidAt}
                onChange={e => setPaidAt(e.target.value)}
                className="key-input mt-1 w-full text-[13px]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setExpanded(false)} className="rounded-lg px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors">Cancel</button>
            <button
              onClick={() => recordPayment.mutate()}
              disabled={recordPayment.isPending || !amount || parseFloat(amount) <= 0}
              className="flex items-center gap-1.5 rounded-sm border border-stone-500/30 bg-stone-700 px-4 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-stone-600 hover:border-[var(--accent)] transition-colors disabled:opacity-50"
            >
              <CheckCircle size={11}/> {recordPayment.isPending ? "Recording…" : "Record Payment"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft:     "text-stone-400 bg-stone-400/10",
  sent:      "text-blue-400 bg-blue-400/10",
  viewed:    "text-stone-400 bg-stone-400/10",
  paid:      "text-emerald-400 bg-emerald-400/10",
  overdue:   "text-stone-400 bg-stone-400/10",
  cancelled: "text-stone-600 bg-stone-600/10",
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function calcTotals(items: LineItem[]) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const tax_total = items.reduce((s, i) => s + i.quantity * i.unit_price * (i.tax_rate / 100), 0);
  return { subtotal, tax_total, total: subtotal + tax_total };
}

function printInvoice(invoice: Invoice) {
  const formatCurrency = (n: number) => n.toLocaleString("en-GB", { style: "currency", currency: invoice.currency });
  const html = `<!DOCTYPE html><html><head><title>${invoice.number}</title><style>
    body { font-family: -apple-system, sans-serif; color: #111; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
    .label { font-size: 11px; text-transform: uppercase; color: #999; margin-bottom: 4px; letter-spacing: 0.05em; }
    .value { font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #eee; font-size: 11px; text-transform: uppercase; color: #999; }
    td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
    .totals { float: right; width: 240px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .totals-row.total { border-top: 2px solid #111; font-weight: 700; font-size: 15px; padding-top: 10px; margin-top: 4px; }
    .status { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; background: #f0f0f0; }
    @media print { body { padding: 20px; } }
  </style></head><body>
    <h1>${invoice.number}</h1>
    <p class="meta">
      <span class="status">${invoice.status.toUpperCase()}</span>
      ${invoice.due_date ? ` &nbsp;·&nbsp; Due: ${new Date(invoice.due_date).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}` : ""}
    </p>
    <div class="grid">
      <div><div class="label">Bill To</div><div class="value"><strong>${invoice.client_name}</strong>${invoice.client_email ? `<br>${invoice.client_email}` : ""}${invoice.client_address ? `<br>${invoice.client_address.replace(/\n/g, "<br>")}` : ""}</div></div>
      <div><div class="label">Invoice Date</div><div class="value">${new Date(invoice.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</div></div>
    </div>
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Tax</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>
        ${(invoice.line_items ?? []).map(item => `<tr><td>${item.description}</td><td>${item.quantity}</td><td>${formatCurrency(item.unit_price)}</td><td>${item.tax_rate}%</td><td style="text-align:right">${formatCurrency(item.quantity * item.unit_price * (1 + item.tax_rate / 100))}</td></tr>`).join("")}
      </tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>Subtotal</span><span>${formatCurrency(invoice.subtotal)}</span></div>
      <div class="totals-row"><span>Tax</span><span>${formatCurrency(invoice.tax_total)}</span></div>
      <div class="totals-row total"><span>Total</span><span>${formatCurrency(invoice.total)}</span></div>
    </div>
    ${invoice.notes ? `<div style="margin-top:64px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#666;">${invoice.notes}</div>` : ""}
    <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
  </body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
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

  const { data: creditNotes = [] } = useQuery<CreditNote[]>({
    queryKey: ["invoice-credit-notes", invoiceId],
    queryFn: () => apiClient.get<CreditNote[]>(`/invoices/${invoiceId}/credit-notes`),
    enabled: !!invoiceId,
  });

  // While this invoice is open, the right-side Ask AI drawer should know
  // which invoice is in scope — same mechanism record/task pages use.
  useEffect(() => {
    if (!invoiceId) return;
    useAskContextStore.getState().setContext({
      invoice_id: invoiceId,
      route: `/finance/invoices/${invoiceId}`,
      scope_label: invoice ? `invoice ${invoice.number} (${invoice.client_name})` : `invoice ${invoiceId}`,
    });
    return () => useAskContextStore.getState().setContext(null);
  }, [invoiceId, invoice?.number, invoice?.client_name]);

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
    return <div className="flex h-full items-center justify-center text-[12px] text-stone-600">Loading…</div>;
  }

  if (!invoice) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-[13px] text-stone-500">Invoice not found</div>
        <Link to="/finance/invoices" className="text-[12px] text-stone-400 hover:text-stone-300">← Back to invoices</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/finance/invoices" className="text-stone-500 hover:text-[var(--text-primary)] transition-colors">
            <ArrowLeft size={15}/>
          </Link>
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">{invoice.number}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[invoice.status]}`}>
            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
          </span>
          {dirty && <span className="text-[11px] text-stone-600 italic">Unsaved changes</span>}
        </div>

        <div className="flex items-center gap-2">
          {isEditable && (
            <button
              onClick={() => save()}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-[12px] text-stone-300 hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
            >
              <Save size={12}/> Save
            </button>
          )}
          {invoice.status === "draft" && (
            <button
              onClick={() => save({ status: "sent" })}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-xl border-x border-t border-blue-500/40 border-b-[3px] border-b-blue-700 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              <Send size={12}/> Send Invoice
            </button>
          )}
          {["sent", "viewed", "overdue"].includes(invoice.status) && (
            <button
              onClick={() => save({ status: "paid" })}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-sm border border-stone-500/30 bg-stone-700 px-3 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-stone-600 hover:border-[var(--accent)] transition-colors disabled:opacity-50"
            >
              <CheckCircle size={12}/> Mark as Paid
            </button>
          )}
          <button
            onClick={() => printInvoice(invoice)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-1.5 text-[12px] text-stone-500 hover:text-stone-300 hover:bg-[var(--surface-hover)] transition-colors"
          >
            <Download size={12}/> PDF
          </button>
        </div>
      </div>

      {/* Body — two columns on wide, single on narrow */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">

          <FinanceAgentStrip invoiceId={invoiceId}/>

          {invoice.status === "overdue" && (
            <div className="flex items-center gap-2 rounded-xl border border-stone-500/30 bg-stone-600/5 px-4 py-3 text-[12px] text-stone-400">
              <AlertTriangle size={13}/>
              This invoice is overdue. Consider sending a payment reminder.
            </div>
          )}

          {/* Client + meta */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 space-y-3">
              <div className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">Bill To</div>
              <div>
                <label className="text-[11px] text-stone-600">Client name *</label>
                <input
                  value={clientName}
                  onChange={e => { setClientName(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  className="key-input mt-1 w-full text-[13px]"
                  placeholder="Client name"
                />
              </div>
              <div>
                <label className="text-[11px] text-stone-600">Email</label>
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
                <label className="text-[11px] text-stone-600">Address</label>
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

            <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 space-y-3">
              <div className="text-[11px] font-medium text-stone-500 uppercase tracking-wider">Details</div>
              <div>
                <label className="text-[11px] text-stone-600">Invoice number</label>
                <input value={invoice.number} disabled className="key-input mt-1 w-full text-[13px] opacity-50"/>
              </div>
              <div>
                <label className="text-[11px] text-stone-600">Due date</label>
                <input
                  value={dueDate}
                  onChange={e => { setDueDate(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  type="date"
                  className="key-input mt-1 w-full text-[13px]"
                />
              </div>
              <div>
                <label className="text-[11px] text-stone-600">Currency</label>
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
          <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)] overflow-hidden">
            <div className="border-b border-[var(--border-soft)] px-4 py-3 flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--text-primary)]">Line Items</span>
              {isEditable && (
                <button onClick={addItem} className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300 transition-colors">
                  <Plus size={11}/> Add item
                </button>
              )}
            </div>

            <table className="minimal-table">
              <thead>
                <tr className="border-b border-[var(--border-soft)]">
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-stone-600">Description</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-stone-600 w-16">Qty</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-stone-600 w-28">Unit Price</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-stone-600 w-20">Tax %</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-stone-600 w-28">Total</th>
                  {isEditable && <th className="w-10"/>}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const lineTotal = item.quantity * item.unit_price * (1 + item.tax_rate / 100);
                  return (
                    <tr key={i} className="border-b border-[var(--border-soft)]">
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
                      <td className="px-4 py-2 text-right text-[12px] font-medium text-[var(--text-primary)]">
                        {formatCurrency(lineTotal, currency)}
                      </td>
                      {isEditable && (
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => removeItem(i)}
                            disabled={items.length === 1}
                            className="rounded p-1 text-stone-700 hover:text-stone-400 disabled:opacity-20 transition-colors"
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
            <div className="flex justify-end border-t border-[var(--border-soft)] px-4 py-3">
              <div className="w-64 space-y-1.5">
                <div className="flex justify-between text-[12px] text-stone-500">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal, currency)}</span>
                </div>
                <div className="flex justify-between text-[12px] text-stone-500">
                  <span>Tax</span>
                  <span>{formatCurrency(tax_total, currency)}</span>
                </div>
                <div className="flex justify-between border-t border-[var(--border-soft)] pt-1.5 text-[14px] font-semibold text-[var(--text-primary)]">
                  <span>Invoice total</span>
                  <span>{formatCurrency(total, currency)}</span>
                </div>
                {(() => {
                  const creditsAmt = creditNotes
                    .filter(cn => cn.status === "executed")
                    .reduce((s, cn) => s + cn.amount_cents / 100, 0);
                  const paymentsAmt = (invoice?.payments ?? []).reduce((s, p) => s + p.amount, 0);
                  const netOwed = total - creditsAmt - paymentsAmt;
                  if (creditsAmt === 0 && paymentsAmt === 0) return null;
                  return (
                    <>
                      {creditsAmt > 0 && (
                        <div className="flex justify-between text-[12px] text-stone-400">
                          <span>Credits applied</span>
                          <span>−{formatCurrency(creditsAmt, currency)}</span>
                        </div>
                      )}
                      {paymentsAmt > 0 && (
                        <div className="flex justify-between text-[12px] text-emerald-400">
                          <span>Payments</span>
                          <span>−{formatCurrency(paymentsAmt, currency)}</span>
                        </div>
                      )}
                      <div className={`flex justify-between border-t border-[var(--border-soft)] pt-1.5 text-[14px] font-bold ${netOwed > 0 ? "text-stone-400" : "text-emerald-400"}`}>
                        <span>Net owed</span>
                        <span>{formatCurrency(Math.max(0, netOwed), currency)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Payments section */}
          {invoice && <PaymentsSection invoice={invoice}/>}

          {/* Notes */}
          <div>
            <label className="text-[11px] text-stone-600">Notes / Payment instructions</label>
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
                className="text-[11px] text-stone-700 hover:text-stone-400 transition-colors"
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
