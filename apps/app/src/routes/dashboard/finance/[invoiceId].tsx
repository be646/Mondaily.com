import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { useCurrency, currencyOptions } from "../../../hooks/useCurrency";
import { convertAmount } from "../../../lib/currency-format";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { FinanceAgentStrip } from "../../../components/ai/finance-agent-strip";
import { AIInspector } from "../../../components/ai/ai-inspector";
import { GraphContextButton } from "../../../components/graph/graph-context-drawer";
import { ArrowLeft, Plus, Trash2, Send, CheckCircle, Download, Save, AlertTriangle, ChevronDown } from "lucide-react";
import { FieldSelect } from "../../../components/ui/controls";

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
    <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] overflow-hidden">
      <div className="border-b border-[var(--border-soft)] px-4 py-3 flex items-center justify-between">
        <span className="text-[12px] font-medium text-[var(--text-primary)]">Payments</span>
        <button
          onClick={() => setExpanded(o => !o)}
          className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors"
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
                <span className="text-[var(--text-secondary)]">·</span>
                <span className="text-[var(--text-muted)] capitalize">{p.method.replace(/_/g, " ")}</span>
                {p.reference && <><span className="text-[var(--text-secondary)]">·</span><span className="text-[var(--text-secondary)]">{p.reference}</span></>}
              </div>
              <span className="text-[var(--text-secondary)]">{new Date(p.paid_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary row */}
      <div className="px-4 py-2.5 flex justify-end">
        <div className="w-56 space-y-1.5">
          <div className="flex justify-between text-[12px] text-[var(--text-muted)]">
            <span>Total paid</span>
            <span className="text-[#2f9e6b]">{formatCurrency(totalPaid, invoice.currency)}</span>
          </div>
          {remaining > 0 && (
            <div className="flex justify-between text-[12px] text-[var(--text-muted)] border-t border-[var(--border-soft)] pt-1.5">
              <span>Remaining</span>
              <span className="text-[var(--text-faint)] font-medium">{formatCurrency(remaining, invoice.currency)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Inline form */}
      {expanded && (
        <div className="border-t border-[var(--border-soft)] px-4 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-[var(--text-secondary)]">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                step="0.01"
                className="key-input mt-1 w-full text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[var(--text-secondary)]">Method</label>
              <FieldSelect
                value={method}
                onChange={v => setMethod(v)}
                ariaLabel="Method"
                className="mt-1"
                options={[
                  { value: "bank_transfer", label: "Bank Transfer" },
                  { value: "card", label: "Card" },
                  { value: "cash", label: "Cash" },
                  { value: "cheque", label: "Cheque" },
                  { value: "other", label: "Other" },
                ]}
              />
            </div>
            <div>
              <label className="text-[11px] text-[var(--text-secondary)]">Reference</label>
              <input
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="e.g. TXN-12345"
                className="key-input mt-1 w-full text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-[var(--text-secondary)]">Date</label>
              <input
                type="date"
                value={paidAt}
                onChange={e => setPaidAt(e.target.value)}
                className="key-input mt-1 w-full text-[13px]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setExpanded(false)} className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors">Cancel</button>
            <button
              onClick={() => recordPayment.mutate()}
              disabled={recordPayment.isPending || !amount || parseFloat(amount) <= 0}
              className="flex items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] hover:border-[var(--section-accent)] transition-colors disabled:opacity-50"
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
  sent:      "text-[#717784] bg-[#717784]/10",
  viewed:    "text-stone-400 bg-stone-400/10",
  paid:      "text-[#2f9e6b] bg-[#2f9e6b]/10",
  overdue:   "text-stone-400 bg-stone-400/10",
  cancelled: "text-stone-600 bg-stone-600/10",
};

function formatCurrency(amount: number, currency: string) {
  // A blank/invalid code makes Intl throw RangeError and takes down the whole table render.
  // currency lives in free-form JSONB and the create modals default it to "", so this is
  // reachable. Degrade to "12.34 XXX" like lib/currency-format.formatMoney does.
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)}${currency ? ` ${currency}` : ""}`;
  }
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
  const { currencies, rates } = useCurrency();
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

  // Server-side rejections (money lock, invalid status transition, unpaid balance) must be visible.
  // Without this the mutation failed silently and the button simply did nothing.
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (body: Partial<Invoice>) =>
      apiClient.patch<Invoice>(`/invoices/${invoiceId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setSaveError(null);
      setDirty(false);
    },
    onError: (e: unknown) => {
      const msg = (e as { message?: string })?.message;
      setSaveError(msg && msg.trim() ? msg : "Could not save this invoice. Please try again.");
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
    // Money is frozen server-side once the invoice leaves draft. Sending `currency`/`line_items`
    // unchanged still counts as "editing money" there, so including them unconditionally made every
    // save on a sent/viewed/overdue invoice — including "Mark as Paid" — fail with a 422.
    const moneyEditable = !invoice || invoice.status === "draft";
    updateMutation.mutate({
      client_name: clientName,
      client_email: clientEmail || undefined,
      client_address: clientAddress || undefined,
      due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
      notes: notes || undefined,
      ...(moneyEditable ? { currency, line_items: items } : {}),
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
  // Narrower than isEditable ON PURPOSE: the server freezes line items + currency once the invoice
  // leaves draft (MONEY_LOCKED_AFTER), while client details and notes stay editable on a sent one.
  // Mirroring that split here means the inputs match what the API will actually accept.
  const moneyEditable = !invoice || invoice.status === "draft";
  // Same idea for the payment-coverage rule: don't offer an action the API is going to reject.
  const paymentsCoverTotal =
    !!invoice && invoice.total > 0 &&
    (invoice.payments ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0) >= invoice.total;

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-body text-[var(--text-secondary)]">Loading…</div>;
  }

  if (!invoice) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-row text-[var(--text-muted)]">Invoice not found</div>
        <Link to="/finance/invoices" className="text-body text-[var(--text-faint)] hover:text-[var(--text-faint)]">← Back to invoices</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-6 py-3">
        <div className="flex items-center gap-3">
          <Link to="/finance/invoices" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <ArrowLeft size={15}/>
          </Link>
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">{invoice.number}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[invoice.status]}`}>
            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
          </span>
          {dirty && <span className="text-[11px] text-[var(--text-secondary)] italic">Unsaved changes</span>}
          {saveError && (
            <span role="alert" className="flex items-center gap-1 text-[11px] text-[var(--status-danger-fg)]">
              <AlertTriangle size={11}/> {saveError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isEditable && (
            <button
              onClick={() => save()}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] px-3 py-1.5 text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
            >
              <Save size={12}/> Save
            </button>
          )}
          {invoice.status === "draft" && (
            <button
              onClick={() => save({ status: "sent" })}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] hover:border-[var(--section-accent)] disabled:opacity-50"
            >
              <Send size={12}/> Send Invoice
            </button>
          )}
          {["sent", "viewed", "overdue"].includes(invoice.status) && (
            <button
              onClick={() => save({ status: "paid" })}
              // The server refuses to mark an invoice paid until recorded payments cover the total
              // ("Cannot mark paid: 0 of 50 recorded"), so without this the button was a dead end:
              // always enabled, always rejected. Disabled with the reason instead of failing on click.
              disabled={updateMutation.isPending || !paymentsCoverTotal}
              title={paymentsCoverTotal ? undefined : "Record a payment covering the invoice total first"}
              className="flex items-center gap-1.5 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] hover:border-[var(--section-accent)] transition-colors disabled:opacity-50"
            >
              <CheckCircle size={12}/> Mark as Paid
            </button>
          )}
          <button
            onClick={() => printInvoice(invoice)}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--border-soft)] px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-faint)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <Download size={12}/> PDF
          </button>
        </div>
      </div>

      {/* Body — two columns on wide, single on narrow */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">

          {/* AI Inspector (interpretation) + Graph Context Drawer trigger (connected context). */}
          {(() => {
            const invoiceCtx = {
              kind: "invoice" as const,
              id: invoice.id,
              title: invoice.number,
              objectType: "invoice",
              data: {
                client: invoice.client_name,
                total: invoice.total,
                status: invoice.status,
                due_date: invoice.due_date,
              },
              updatedAt: invoice.due_date ?? null,
              scopeLabel: `invoice ${invoice.number}${invoice.client_name ? ` for ${invoice.client_name}` : ""}`,
            };
            return (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <GraphContextButton ctx={invoiceCtx} />
                </div>
                <AIInspector ctx={invoiceCtx} defaultOpen={false} />
              </div>
            );
          })()}

          <FinanceAgentStrip invoiceId={invoiceId}/>

          {invoice.status === "overdue" && (
            <div className="flex items-center gap-2 rounded-sm border border-stone-500/30 bg-stone-600/5 px-4 py-3 text-body text-[var(--text-faint)]">
              <AlertTriangle size={13}/>
              This invoice is overdue. Consider sending a payment reminder.
            </div>
          )}

          {/* Client + meta */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 space-y-3">
              <div className="text-label font-medium text-[var(--text-muted)] uppercase tracking-wider">Bill To</div>
              <div>
                <label className="text-label text-[var(--text-secondary)]">Client name *</label>
                <input
                  value={clientName}
                  onChange={e => { setClientName(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  className="key-input mt-1 w-full text-[13px]"
                  placeholder="Client name"
                />
              </div>
              <div>
                <label className="text-label text-[var(--text-secondary)]">Email</label>
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
                <label className="text-label text-[var(--text-secondary)]">Address</label>
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

            <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-4 space-y-3">
              <div className="text-label font-medium text-[var(--text-muted)] uppercase tracking-wider">Details</div>
              <div>
                <label className="text-label text-[var(--text-secondary)]">Invoice number</label>
                <input value={invoice.number} disabled className="key-input mt-1 w-full text-[13px] opacity-50"/>
              </div>
              <div>
                <label className="text-label text-[var(--text-secondary)]">Due date</label>
                <input
                  value={dueDate}
                  onChange={e => { setDueDate(e.target.value); setDirty(true); }}
                  disabled={!isEditable}
                  type="date"
                  className="key-input mt-1 w-full text-[13px]"
                />
              </div>
              <div>
                <label className="text-label text-[var(--text-secondary)]">Currency</label>
                <FieldSelect
                  value={currency}
                  onChange={v => { setCurrency(v); setDirty(true); }}
                  disabled={!moneyEditable}
                  ariaLabel="Currency"
                  className="mt-1"
                  options={currencyOptions(currencies)}
                />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] overflow-hidden">
            <div className="border-b border-[var(--border-soft)] px-4 py-3 flex items-center justify-between">
              <span className="text-body font-medium text-[var(--text-primary)]">Line Items</span>
              {moneyEditable && (
                <button onClick={addItem} className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors">
                  <Plus size={11}/> Add item
                </button>
              )}
            </div>

            <table className="minimal-table">
              <thead>
                <tr className="border-b border-[var(--border-soft)]">
                  <th className="px-4 py-2 text-left text-label font-medium text-[var(--text-secondary)]">Description</th>
                  <th className="px-4 py-2 text-right text-label font-medium text-[var(--text-secondary)] w-16">Qty</th>
                  <th className="px-4 py-2 text-right text-label font-medium text-[var(--text-secondary)] w-28">Unit Price</th>
                  <th className="px-4 py-2 text-right text-label font-medium text-[var(--text-secondary)] w-20">Tax %</th>
                  <th className="px-4 py-2 text-right text-label font-medium text-[var(--text-secondary)] w-28">Total</th>
                  {moneyEditable && <th className="w-10"/>}
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
                          disabled={!moneyEditable}
                          placeholder="Description"
                          className="key-input w-full text-[12px]"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={item.quantity}
                          onChange={e => updateItem(i, "quantity", parseFloat(e.target.value) || 0)}
                          disabled={!moneyEditable}
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
                          disabled={!moneyEditable}
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
                          disabled={!moneyEditable}
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
                      {moneyEditable && (
                        <td className="px-2 py-2 text-center">
                          <button
                            onClick={() => removeItem(i)}
                            disabled={items.length === 1}
                            className="rounded p-1 text-[var(--text-secondary)] hover:text-[var(--text-faint)] disabled:opacity-20 transition-colors"
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
                <div className="flex justify-between text-body text-[var(--text-muted)]">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal, currency)}</span>
                </div>
                <div className="flex justify-between text-body text-[var(--text-muted)]">
                  <span>Tax</span>
                  <span>{formatCurrency(tax_total, currency)}</span>
                </div>
                <div className="flex justify-between border-t border-[var(--border-soft)] pt-1.5 text-[14px] font-semibold text-[var(--text-primary)]">
                  <span>Invoice total</span>
                  <span>{formatCurrency(total, currency)}</span>
                </div>
                {(() => {
                  // Credit notes carry their OWN currency; this used to add a EUR credit
                  // straight onto a GBP invoice and label the result with the invoice symbol.
                  // Convert into the invoice currency and flag anything we couldn't convert
                  // instead of quietly producing a wrong "Net owed".
                  let unconverted = 0;
                  const creditsAmt = creditNotes
                    .filter(cn => cn.status === "executed")
                    .reduce((s, cn) => {
                      const v = convertAmount(cn.amount_cents / 100, cn.currency || currency, currency, rates);
                      if (v == null) { unconverted += 1; return s; }
                      return s + v;
                    }, 0);
                  const paymentsAmt = (invoice?.payments ?? []).reduce((s, p) => s + p.amount, 0);
                  const netOwed = total - creditsAmt - paymentsAmt;
                  if (creditsAmt === 0 && paymentsAmt === 0) return null;
                  return (
                    <>
                      {creditsAmt > 0 && (
                        <div className="flex justify-between text-body text-[var(--text-faint)]">
                          <span>Credits applied{unconverted > 0 ? ` · ${unconverted} in another currency not included` : ""}</span>
                          <span>−{formatCurrency(creditsAmt, currency)}</span>
                        </div>
                      )}
                      {paymentsAmt > 0 && (
                        <div className="flex justify-between text-body text-[#2f9e6b]">
                          <span>Payments</span>
                          <span>−{formatCurrency(paymentsAmt, currency)}</span>
                        </div>
                      )}
                      <div className={`flex justify-between border-t border-[var(--border-soft)] pt-1.5 text-[14px] font-bold ${netOwed > 0 ? "text-[var(--text-faint)]" : "text-[#2f9e6b]"}`}>
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
            <label className="text-label text-[var(--text-secondary)]">Notes / Payment instructions</label>
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
                className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors"
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
