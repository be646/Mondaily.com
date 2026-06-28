import { useState } from "react";
import { Plus, X, Sparkles, List, Loader2, Check, Filter } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { useQueryClient } from "@tanstack/react-query";

interface NodeRecord { id: string; data: Record<string, unknown> }

type Operator =
  | "contains" | "not_contains" | "equals" | "not_equals"
  | "is_empty" | "is_not_empty" | "greater_than" | "less_than";

interface Rule {
  id: string;
  field: string;
  operator: Operator;
  value: string;
}

const OPERATORS: { value: Operator; label: string; noValue?: boolean }[] = [
  { value: "contains",     label: "contains" },
  { value: "not_contains", label: "doesn't contain" },
  { value: "equals",       label: "is exactly" },
  { value: "not_equals",   label: "is not" },
  { value: "is_empty",     label: "is empty",     noValue: true },
  { value: "is_not_empty", label: "has any value", noValue: true },
  { value: "greater_than", label: "greater than" },
  { value: "less_than",    label: "less than" },
];

function matchRecord(record: NodeRecord, rules: Rule[], logic: "AND" | "OR"): boolean {
  if (rules.length === 0) return true;
  const results = rules.map(rule => {
    const raw = record.data[rule.field];
    const val = String(raw ?? "").toLowerCase();
    const ruleVal = rule.value.toLowerCase();
    switch (rule.operator) {
      case "contains":      return val.includes(ruleVal);
      case "not_contains":  return !val.includes(ruleVal);
      case "equals":        return val === ruleVal;
      case "not_equals":    return val !== ruleVal;
      case "is_empty":      return !val.trim();
      case "is_not_empty":  return !!val.trim();
      case "greater_than":  return parseFloat(val) > parseFloat(ruleVal);
      case "less_than":     return parseFloat(val) < parseFloat(ruleVal);
      default:              return true;
    }
  });
  return logic === "AND" ? results.every(Boolean) : results.some(Boolean);
}

let _ruleId = 0;
const newRule = (field = ""): Rule => ({
  id: `r${++_ruleId}`,
  field,
  operator: "is_not_empty",
  value: "",
});

export function SegmentBuilder({
  objectType,
  records,
  columns,
  onClose,
}: {
  objectType: string;
  records: NodeRecord[];
  columns: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [logic, setLogic] = useState<"AND" | "OR">("AND");
  const [rules, setRules] = useState<Rule[]>([newRule(columns[0] ?? "email")]);
  const [listName, setListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedListName, setSavedListName] = useState("");

  const matched = records.filter(r => matchRecord(r, rules, logic));

  function addRule() {
    setRules(prev => [...prev, newRule(columns[0] ?? "")]);
  }

  function removeRule(id: string) {
    setRules(prev => prev.filter(r => r.id !== id));
  }

  function updateRule(id: string, patch: Partial<Rule>) {
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  async function saveSegment() {
    const name = listName.trim() ||
      `${objectType.charAt(0).toUpperCase() + objectType.slice(1)} segment — ${new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
    setSaving(true);
    try {
      const list = await apiClient.post<{ id: string }>("/lists", {
        name,
        object_type: objectType,
        visibility: "workspace",
        access_level: "marketing",
      });
      await Promise.all(
        matched.map(r => apiClient.post(`/lists/${list.id}/entries`, { node_id: r.id }).catch((e) => console.error("[bg-task] swallowed error:", e)))
      );
      qc.invalidateQueries({ queryKey: ["lists"] });
      setSavedListName(name);
      setSaved(true);
    } catch {
      // continue
    } finally {
      setSaving(false);
    }
  }

  const cleanName = objectType.charAt(0).toUpperCase() + objectType.slice(1).replace(/[-_]/g, " ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--border-soft)] bg-[#0f1117] shadow-2xl flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-stone-500/10 border border-stone-500/20">
              <Filter size={13} className="text-stone-400" />
            </div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">Segment Builder</span>
            <span className="text-xs text-[var(--text-secondary)]">{cleanName}</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {saved ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Check size={22} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Segment saved as list</p>
                <p className="text-xs text-[var(--text-secondary)]">"{savedListName}"</p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">{matched.length} records · visible under Lists in sidebar</p>
              </div>
            </div>
          ) : (
            <>
              {/* Logic toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)]">Match</span>
                <div className="flex rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] p-0.5">
                  {(["AND", "OR"] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setLogic(l)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${logic === l ? "bg-stone-600 text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-[var(--text-secondary)]">of the following rules</span>
              </div>

              {/* Rules */}
              <div className="space-y-2">
                {rules.map((rule, i) => {
                  const op = OPERATORS.find(o => o.value === rule.operator);
                  return (
                    <div key={rule.id} className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--text-secondary)] w-6 text-right flex-shrink-0">
                        {i === 0 ? "IF" : logic}
                      </span>
                      {/* Field */}
                      <select
                        value={rule.field}
                        onChange={e => updateRule(rule.id, { field: e.target.value })}
                        className="flex-1 h-8 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-secondary)] outline-none focus:border-stone-500/40"
                      >
                        {columns.map(c => (
                          <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                      {/* Operator */}
                      <select
                        value={rule.operator}
                        onChange={e => updateRule(rule.id, { operator: e.target.value as Operator })}
                        className="h-8 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-secondary)] outline-none focus:border-stone-500/40"
                      >
                        {OPERATORS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      {/* Value */}
                      {!op?.noValue && (
                        <input
                          value={rule.value}
                          onChange={e => updateRule(rule.id, { value: e.target.value })}
                          placeholder="value"
                          className="w-28 h-8 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-secondary)] placeholder-white/20 outline-none focus:border-stone-500/40"
                        />
                      )}
                      <button
                        onClick={() => removeRule(rule.id)}
                        disabled={rules.length === 1}
                        className="text-[var(--text-secondary)] hover:text-stone-400 transition-colors disabled:pointer-events-none"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={addRule}
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-stone-400 transition-colors"
              >
                <Plus size={12} /> Add rule
              </button>

              {/* Preview */}
              <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Matching records</span>
                <span className={`text-sm font-semibold ${matched.length > 0 ? "text-stone-400" : "text-[var(--text-secondary)]"}`}>
                  {matched.length} / {records.length}
                </span>
              </div>

              {/* List name */}
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--text-secondary)]">Save as list (optional name)</label>
                <input
                  value={listName}
                  onChange={e => setListName(e.target.value)}
                  placeholder={`${cleanName} segment — ${new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" })}`}
                  className="w-full h-9 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-secondary)] placeholder-white/20 outline-none focus:border-stone-500/40 transition-colors"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-soft)]">
          <button onClick={onClose} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors">
            {saved ? "Close" : "Cancel"}
          </button>
          {!saved && (
            <button
              onClick={saveSegment}
              disabled={matched.length === 0 || saving}
              className="flex items-center gap-1.5 rounded-xl bg-stone-600 px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-stone-500 transition-colors disabled:opacity-40"
            >
              {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><List size={12} /> Save {matched.length} records as list</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
