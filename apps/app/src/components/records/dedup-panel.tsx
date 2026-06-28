import { useState } from "react";
import { X, Merge, List, Phone, Mail, AlertTriangle, Check, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { apiClient } from "../../lib/api-client";
import { useQueryClient } from "@tanstack/react-query";

interface NodeRecord { id: string; data: Record<string, unknown> }

interface DupGroup {
  reason: "email" | "phone" | "name";
  value: string;
  records: NodeRecord[];
  keepIndex: number;
}

interface MissingInfo {
  noEmail: NodeRecord[];
  noPhone: NodeRecord[];
  noBoth: NodeRecord[];
}

function normalize(s: unknown): string {
  return String(s ?? "").trim().toLowerCase().replace(/[\s\-().+]/g, "");
}

function findDuplicates(records: NodeRecord[]): DupGroup[] {
  const groups: DupGroup[] = [];
  const emailMap = new Map<string, NodeRecord[]>();
  const phoneMap = new Map<string, NodeRecord[]>();
  const nameMap = new Map<string, NodeRecord[]>();

  for (const r of records) {
    const email = normalize(r.data.email ?? r.data.Email ?? r.data.email_address ?? "");
    const phone = normalize(r.data.phone ?? r.data.Phone ?? r.data.phone_number ?? r.data.mobile ?? "");
    const name = normalize(r.data.name ?? r.data.Name ?? r.data.company_name ?? "");

    if (email.length > 4) {
      const list = emailMap.get(email) ?? [];
      list.push(r);
      emailMap.set(email, list);
    }
    if (phone.length > 6) {
      const list = phoneMap.get(phone) ?? [];
      list.push(r);
      phoneMap.set(phone, list);
    }
    if (name.length > 2) {
      const list = nameMap.get(name) ?? [];
      list.push(r);
      nameMap.set(name, list);
    }
  }

  const seen = new Set<string>();
  for (const [val, recs] of emailMap) {
    if (recs.length < 2) continue;
    const key = recs.map(r => r.id).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ reason: "email", value: val, records: recs, keepIndex: 0 });
  }
  for (const [val, recs] of phoneMap) {
    if (recs.length < 2) continue;
    const key = recs.map(r => r.id).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ reason: "phone", value: val, records: recs, keepIndex: 0 });
  }
  for (const [val, recs] of nameMap) {
    if (recs.length < 2) continue;
    const key = recs.map(r => r.id).sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ reason: "name", value: val, records: recs, keepIndex: 0 });
  }
  return groups;
}

function getMissingInfo(records: NodeRecord[]): MissingInfo {
  const noBoth: NodeRecord[] = [];
  const noEmail: NodeRecord[] = [];
  const noPhone: NodeRecord[] = [];
  for (const r of records) {
    const hasEmail = !!String(r.data.email ?? r.data.Email ?? "").trim();
    const hasPhone = !!String(r.data.phone ?? r.data.Phone ?? r.data.phone_number ?? r.data.mobile ?? "").trim();
    if (!hasEmail && !hasPhone) noBoth.push(r);
    else if (!hasEmail) noEmail.push(r);
    else if (!hasPhone) noPhone.push(r);
  }
  return { noBoth, noEmail, noPhone };
}

export function DedupPanel({
  objectType,
  records,
  onClose,
}: {
  objectType: string;
  records: NodeRecord[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"scan" | "review" | "lists">("scan");
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [missing, setMissing] = useState<MissingInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [merging, setMerging] = useState(false);
  const [creatingLists, setCreatingLists] = useState(false);
  const [done, setDone] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
  const [keepMap, setKeepMap] = useState<Record<number, number>>({});
  const [listResults, setListResults] = useState<{ name: string; count: number }[]>([]);

  async function scan() {
    setScanning(true);
    await new Promise(r => setTimeout(r, 600)); // brief pause for UX
    const found = findDuplicates(records);
    const miss = getMissingInfo(records);
    setGroups(found);
    setMissing(miss);
    setScanning(false);
    setStep("review");
  }

  async function mergeAll() {
    setMerging(true);
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const keepIdx = keepMap[i] ?? group.keepIndex;
      const keeper = group.records[keepIdx]!;
      const dupes = group.records.filter((_, j) => j !== keepIdx);

      // Merge all fields from dupes into keeper (non-destructively)
      const mergedData = { ...keeper.data };
      for (const dupe of dupes) {
        for (const [k, v] of Object.entries(dupe.data)) {
          if (!mergedData[k] && v) mergedData[k] = v;
        }
      }

      await apiClient.patch(`/nodes/${keeper.id}`, { data: mergedData }).catch((e) => console.error("[bg-task] swallowed error:", e));
      for (const dupe of dupes) {
        await apiClient.delete(`/nodes/${dupe.id}`).catch((e) => console.error("[bg-task] swallowed error:", e));
      }
    }
    qc.invalidateQueries({ queryKey: ["records", objectType] });
    setMerging(false);
    setStep("lists");
  }

  async function createSmartLists() {
    setCreatingLists(true);
    const now = new Date().toLocaleString("en-US", { month: "short", year: "numeric" });
    const created: { name: string; count: number }[] = [];

    // Get fresh records after merge
    const fresh = (qc.getQueryData<NodeRecord[]>(["records", objectType]) ?? records);

    const withEmail = fresh.filter(r => String(r.data.email ?? r.data.Email ?? "").includes("@"));
    const withPhone = fresh.filter(r => normalize(r.data.phone ?? r.data.Phone ?? r.data.phone_number ?? r.data.mobile ?? "").length > 6);
    const withBoth  = fresh.filter(r => {
      const e = String(r.data.email ?? r.data.Email ?? "").includes("@");
      const p = normalize(r.data.phone ?? r.data.Phone ?? r.data.phone_number ?? r.data.mobile ?? "").length > 6;
      return e && p;
    });

    const cleanName = objectType.charAt(0).toUpperCase() + objectType.slice(1).replace(/[-_]/g, " ");

    const listsToCreate = [
      { name: `${cleanName} with email — ${now}`, records: withEmail, tag: "email" },
      { name: `${cleanName} with phone — ${now}`, records: withPhone, tag: "phone" },
      ...(withBoth.length > 0 ? [{ name: `${cleanName} with email & phone — ${now}`, records: withBoth, tag: "both" }] : []),
    ].filter(l => l.records.length > 0);

    for (const l of listsToCreate) {
      try {
        const list = await apiClient.post<{ id: string }>("/lists", {
          name: l.name,
          object_type: objectType,
          visibility: "workspace",
          access_level: "marketing",
        });

        // Add entries to the list
        await Promise.all(
          l.records.map(r =>
            apiClient.post(`/lists/${list.id}/entries`, { node_id: r.id }).catch((e) => console.error("[bg-task] swallowed error:", e))
          )
        );

        created.push({ name: l.name, count: l.records.length });
      } catch {
        // continue
      }
    }

    setListResults(created);
    setCreatingLists(false);
    setDone(true);
    qc.invalidateQueries({ queryKey: ["lists"] });
  }

  const reasonLabel = (r: DupGroup["reason"]) =>
    r === "email" ? "Same email" : r === "phone" ? "Same phone" : "Same name";
  const reasonColor = (r: DupGroup["reason"]) =>
    r === "email" ? "text-blue-400 bg-blue-400/10 border-blue-400/20"
    : r === "phone" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
    : "text-orange-400 bg-orange-400/10 border-orange-400/20";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--border-soft)] bg-[#0f1117] shadow-2xl flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-stone-500/10 border border-stone-500/20">
              <LogoMark size={14} className="text-stone-400" />
            </div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">AI Data Cleaner</span>
            {step === "review" && groups.length > 0 && (
              <span className="text-xs text-stone-400 bg-stone-400/10 border border-stone-400/20 rounded-full px-2 py-0.5">
                {groups.length} duplicate{groups.length > 1 ? "s" : ""} found
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* STEP: SCAN */}
          {step === "scan" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="h-14 w-14 rounded-2xl bg-stone-500/10 border border-stone-500/15 flex items-center justify-center">
                <LogoMark size={24} className="text-stone-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Scan {records.length} records for duplicates</p>
                <p className="text-xs text-[var(--text-secondary)]">AI will check for matching emails, phone numbers, and names</p>
              </div>
              <button
                onClick={scan}
                disabled={scanning}
                className="flex items-center gap-2 rounded-xl bg-stone-600 px-5 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-stone-500 transition-colors disabled:opacity-60"
              >
                {scanning ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : <><LogoMark size={14} /> Scan now</>}
              </button>
            </div>
          )}

          {/* STEP: REVIEW */}
          {step === "review" && (
            <>
              {groups.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <Check size={28} className="text-emerald-400" />
                  <p className="text-sm font-semibold text-[var(--text-primary)]">No duplicates found</p>
                  <p className="text-xs text-[var(--text-secondary)]">Your data looks clean</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-secondary)] mb-3">Select which record to keep for each group. All other fields will be merged in.</p>
                  {groups.map((g, gi) => (
                    <div key={gi} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-hover)] overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-4 py-3 text-left"
                        onClick={() => setExpandedGroup(expandedGroup === gi ? null : gi)}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 ${reasonColor(g.reason)}`}>
                            {reasonLabel(g.reason)}
                          </span>
                          <span className="text-xs text-[var(--text-secondary)] font-mono">{g.value}</span>
                          <span className="text-xs text-[var(--text-secondary)]">{g.records.length} records</span>
                        </div>
                        {expandedGroup === gi ? <ChevronUp size={12} className="text-[var(--text-secondary)]" /> : <ChevronDown size={12} className="text-[var(--text-secondary)]" />}
                      </button>
                      {expandedGroup === gi && (
                        <div className="border-t border-[var(--border-soft)] divide-y divide-white/[.04]">
                          {g.records.map((r, ri) => {
                            const isKeep = (keepMap[gi] ?? 0) === ri;
                            const name = String(r.data.name ?? r.data.Name ?? r.data.company_name ?? "Unknown");
                            return (
                              <div
                                key={r.id}
                                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${isKeep ? "bg-emerald-500/5" : "hover:bg-[var(--surface-hover)]"}`}
                                onClick={() => setKeepMap(prev => ({ ...prev, [gi]: ri }))}
                              >
                                <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isKeep ? "border-emerald-400 bg-emerald-400" : "border-[var(--border-soft)]"}`}>
                                  {isKeep && <Check size={8} className="text-black" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-[var(--text-secondary)] truncate">{name}</p>
                                  <p className="text-[10px] text-[var(--text-secondary)] truncate">
                                    {[r.data.email, r.data.phone, r.data.job_title].filter(Boolean).join(" · ")}
                                  </p>
                                </div>
                                {isKeep && <span className="text-[10px] text-emerald-400 font-medium flex-shrink-0">Keep</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Missing info summary */}
              {missing && (missing.noEmail.length > 0 || missing.noPhone.length > 0 || missing.noBoth.length > 0) && (
                <div className="rounded-xl border border-orange-400/15 bg-orange-400/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={13} className="text-orange-400" />
                    <span className="text-xs font-semibold text-orange-400">Missing contact info</span>
                  </div>
                  {missing.noBoth.length > 0 && <p className="text-xs text-[var(--text-secondary)]">{missing.noBoth.length} records missing both email and phone</p>}
                  {missing.noEmail.length > 0 && <p className="text-xs text-[var(--text-secondary)]">{missing.noEmail.length} records missing email only</p>}
                  {missing.noPhone.length > 0 && <p className="text-xs text-[var(--text-secondary)]">{missing.noPhone.length} records missing phone only</p>}
                </div>
              )}
            </>
          )}

          {/* STEP: LISTS */}
          {step === "lists" && !done && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="h-12 w-12 rounded-2xl bg-blue-500/10 border border-blue-500/15 flex items-center justify-center">
                <List size={20} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Create smart lists</p>
                <p className="text-xs text-[var(--text-secondary)]">AI will auto-create lists filtered by email and phone, ready for campaigns</p>
              </div>
              <div className="w-full space-y-2 text-left">
                {[
                  { icon: <Mail size={12} />, label: "Contacts with email", color: "text-blue-400" },
                  { icon: <Phone size={12} />, label: "Contacts with phone", color: "text-emerald-400" },
                  { icon: <LogoMark size={12} />, label: "Contacts with both", color: "text-stone-400" },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center gap-2.5 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 ${item.color}`}>
                    {item.icon}
                    <span className="text-xs text-[var(--text-secondary)]">{item.label} — <span className="italic text-[var(--text-secondary)]">will be created under Lists</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* DONE */}
          {done && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Check size={22} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">All done!</p>
                <p className="text-xs text-[var(--text-secondary)]">Lists created and available under Lists in the sidebar</p>
              </div>
              <div className="w-full space-y-2">
                {listResults.map((l, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5">
                    <span className="text-xs text-[var(--text-secondary)]">{l.name}</span>
                    <span className="text-[10px] text-emerald-400 font-medium">{l.count} records</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--border-soft)]">
          <button onClick={onClose} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors">
            {done ? "Close" : "Cancel"}
          </button>

          <div className="flex items-center gap-2">
            {step === "review" && !done && (
              <>
                <button
                  onClick={() => setStep("lists")}
                  className="flex items-center gap-1.5 rounded-xl border border-[var(--border-soft)] px-4 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-soft)] transition-colors"
                >
                  Skip merge
                </button>
                {groups.length > 0 && (
                  <button
                    onClick={mergeAll}
                    disabled={merging}
                    className="flex items-center gap-1.5 rounded-xl bg-stone-600 px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-stone-500 transition-colors disabled:opacity-60"
                  >
                    {merging ? <><Loader2 size={12} className="animate-spin" /> Merging…</> : <><Merge size={12} /> Merge {groups.reduce((a, g) => a + g.records.length - 1, 0)} duplicates</>}
                  </button>
                )}
              </>
            )}
            {step === "lists" && !done && (
              <button
                onClick={createSmartLists}
                disabled={creatingLists}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-blue-500 transition-colors disabled:opacity-60"
              >
                {creatingLists ? <><Loader2 size={12} className="animate-spin" /> Creating lists…</> : <><List size={12} /> Create smart lists</>}
              </button>
            )}
            {done && (
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-emerald-500 transition-colors"
              >
                <Check size={12} /> Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
