import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogoMark } from "@/components/logo";
import { AIMark } from "@/components/ui/ai-button";
import {
  AtSign, Calendar, CheckSquare, ChevronRight, Database, File,
  FunctionSquare, Hash, Link, List, Lock, Mail, Percent, Phone,
  Plus, Text, Trash2, X, Loader2, Check, ArrowLeft,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { apiClient, apiFetch, getAuthHeaders } from "../../../lib/api-client";
import { EmptyState, ConsoleSkeleton } from "../../../components/ui/page-state";
import { CommandPageHeader } from "../../../components/ui/controls";
import { FieldSelect } from "../../../components/ui/controls";
import { useWorkspaceSuggestions } from "../../../hooks/useWorkspaceSuggestions";
import { useEscapeClose } from "@/components/ui/modal";

type AttributeType = "text" | "long_text" | "number" | "currency" | "percentage" | "date" | "datetime" | "checkbox" | "select" | "multi_select" | "url" | "email" | "phone" | "relation" | "formula" | "file";
interface Attribute { id?: string; name: string; type: AttributeType; required?: boolean; unique?: boolean }
interface ObjectDefinition { id: string; name_singular?: string; name_plural: string; slug: string; icon?: string; color?: string; is_standard?: boolean; vertical?: string; attributes: Attribute[] }
interface GeneratedSchema { singular: string; plural: string; vertical: string; color: string; description?: string; attributes: { name: string; type: AttributeType; description?: string; options?: string[] }[]; sample_records?: Record<string, unknown>[] }

const typeOptions: { type: AttributeType; label: string; icon: typeof Text }[] = [
  { type: "text", label: "Text", icon: Text }, { type: "long_text", label: "Long text", icon: Text },
  { type: "number", label: "Number", icon: Hash }, { type: "currency", label: "Currency", icon: Hash },
  { type: "percentage", label: "Percentage", icon: Percent }, { type: "date", label: "Date", icon: Calendar },
  { type: "datetime", label: "Date + time", icon: Calendar }, { type: "checkbox", label: "Checkbox", icon: CheckSquare },
  { type: "select", label: "Select", icon: List }, { type: "multi_select", label: "Multi-select", icon: List },
  { type: "url", label: "URL", icon: Link }, { type: "email", label: "Email", icon: Mail },
  { type: "phone", label: "Phone", icon: Phone }, { type: "relation", label: "Relation", icon: AtSign },
  { type: "formula", label: "Formula", icon: FunctionSquare }, { type: "file", label: "File", icon: File }
];

const TYPE_ICON: Record<AttributeType, typeof Text> = Object.fromEntries(typeOptions.map(t => [t.type, t.icon])) as any;

const colors = ["red", "orange", "amber", "emerald", "cyan", "blue", "violet", "pink"];
// Types the object_definitions backend persists. The AI generator emits from this set, so pass
// the real type straight through (the old code flattened currency/percentage/date-time/etc. to
// "text", destroying every rich column). Only app-only types (formula/file) fall back to text.
const BACKEND_ATTR_TYPES = new Set<AttributeType>(["text","long_text","number","currency","percentage","date","datetime","checkbox","select","multi_select","url","email","phone","relation"]);
const apiType = (type: AttributeType): AttributeType => BACKEND_ATTR_TYPES.has(type) ? type : "text";

// ─── Example prompts ──────────────────────────────────────────────────────────
const EXAMPLES = [
  "Accounting sheet for business taxes and costs",
  "Autonomous Workforce records with salary and performance",
  "Quantitative Asset Systems property listings with price and status",
  "Sovereign Core Ingestion with portfolio and check size",
  "Product inventory with SKU, stock and pricing",
  "Client contracts with value, dates and status",
  "Marketing campaigns with budget and ROI tracking",
  "Lead Analytics Engines with source, score and qualification",
];

// ─── Call dedicated schema endpoint (uses Anthropic tool_use = guaranteed JSON) ─
async function generateSchema(prompt: string): Promise<GeneratedSchema> {
  const headers = await getAuthHeaders();
  const apiUrl = import.meta.env.VITE_API_URL || "";

  const res = await apiFetch(`${apiUrl}/api/v1/generate/schema`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(data.error);
  if (!data.plural || !Array.isArray(data.attributes)) throw new Error("Invalid schema returned. Please try again.");
  data.attributes = (data.attributes as GeneratedSchema["attributes"]).slice(0, 16);
  return data as GeneratedSchema;
}

// ─── AI Generate panel ────────────────────────────────────────────────────────
function AIGeneratePanel({ objects, onCreated, onClose }: {
  objects: ObjectDefinition[];
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const qc = useQueryClient();
  const [step, setStep] = useState<"prompt" | "preview" | "creating">("prompt");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [schema, setSchema] = useState<GeneratedSchema | null>(null);
  const [includeSamples, setIncludeSamples] = useState(true);
  // Prefer profile-aware object examples (from the workspace's tracked objects); fall back to generic.
  const { data: wsSuggestions } = useWorkspaceSuggestions();
  const examples = wsSuggestions?.object_examples?.length ? [...wsSuggestions.object_examples, ...EXAMPLES] : EXAMPLES;
  const [example] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);

  const generate = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await generateSchema(prompt.trim());
      setSchema(result);
      setStep("preview");
    } catch (e: any) {
      setError(e.message || "Generation failed. Try rephrasing your request.");
    } finally {
      setLoading(false);
    }
  }, [prompt]);

  async function createFromSchema() {
    if (!schema) return;
    setStep("creating");
    try {
      const slug = schema.plural.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      // Create the object
      const obj = await apiClient.post<{ id: string }>("/settings/objects", {
        name: schema.plural,
        slug,
        singular: schema.singular,
        plural: schema.plural,
        vertical: schema.vertical,
        color: schema.color,
        icon: "circle",
      });

      // Create each attribute
      for (const attr of schema.attributes) {
        try {
          await apiClient.post(`/settings/objects/${obj.id}/attributes`, {
            name: attr.name,
            type: apiType(attr.type),
            display_type: attr.type,
            ...(attr.description ? { description: attr.description } : {}),
            ...(attr.options?.length ? { options: attr.options } : {}),
            required: false,
            unique: false,
          });
        } catch {}
      }

      // Optional AI starter rows — clearly opt-in example data (user edits/deletes). Keyed to the
      // column slugs; the first (primary) column also becomes the record's display name.
      if (includeSamples && schema.sample_records?.length) {
        const colSlug = (n: string) => n.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        const primary = schema.attributes[0]?.name;
        let seedFailed = 0;
        for (const rec of schema.sample_records.slice(0, 3)) {
          const data: Record<string, unknown> = {};
          for (const attr of schema.attributes) {
            const v = (rec as Record<string, unknown>)[attr.name];
            if (v != null && v !== "") data[colSlug(attr.name)] = v;
          }
          if (primary && (rec as Record<string, unknown>)[primary] != null) data.name = (rec as Record<string, unknown>)[primary];
          if (Object.keys(data).length) {
            try { await apiClient.post("/nodes", { vertical: schema.vertical || "shared", object_type: slug, data }); }
            catch { seedFailed++; }
          }
        }
        // The object itself was created — seeds are opt-in sample rows, so a seed failure must not
        // fail the whole flow. Surface it honestly in logs rather than silently pretending success.
        if (seedFailed) console.warn(`[object-create] ${seedFailed} sample record(s) could not be seeded for "${slug}".`);
      }

      await qc.invalidateQueries({ queryKey: ["object-definitions"] });
      onCreated(obj.id);
    } catch (e: any) {
      setError(e.message || "Failed to create object");
      setStep("preview");
    }
  }

  const typeColor: Record<string, string> = {
    currency: "text-[#2f9e6b]", number: "text-[#717784]", date: "text-[#c6892e]",
    datetime: "text-[#c6892e]", checkbox: "text-[var(--text-faint)]", select: "text-[var(--section-accent)]",
    multi_select: "text-[var(--section-accent)]", email: "text-[var(--text-faint)]", phone: "text-[var(--text-faint)]",
    url: "text-[#717784]", text: "text-[var(--text-faint)]", long_text: "text-[var(--text-faint)]",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-6">
      <div className="w-full max-w-xl rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            {step === "preview" && (
              <button onClick={() => setStep("prompt")} className="mr-1 text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors">
                <ArrowLeft size={14}/>
              </button>
            )}
            <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-[var(--surface-hover)]">
              <LogoMark size={13} className="text-[var(--text-faint)]"/>
            </div>
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                {step === "prompt" ? "AI Schema Generator" : step === "preview" ? "Review generated schema" : "Creating object…"}
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {step === "prompt" ? "Describe your sheet and AI builds the fields" : step === "preview" ? `${schema?.attributes.length} attributes generated` : "Setting up your object and attributes"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-sm p-1 text-[var(--text-muted)] hover:text-[var(--text-faint)] hover:bg-[var(--surface-hover)] transition-colors">
            <X size={14}/>
          </button>
        </div>

        {/* Prompt step */}
        {step === "prompt" && (
          <div className="px-5 py-5">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
              placeholder={example}
              rows={3}
              className="w-full resize-none rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3.5 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--border-strong)] focus:bg-[var(--surface-hover)] transition-colors"
            />

            {error && <p className="mt-2 text-[11px] text-[var(--text-faint)]">{error}</p>}

            {/* Examples */}
            <p className="mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Examples</p>
            <div className="flex flex-wrap gap-1.5">
              {examples.slice(0, 6).map(ex => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-all"
                >
                  {ex}
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-sm border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors">
                Cancel
              </button>
              <button
                onClick={generate}
                disabled={!prompt.trim() || loading}
                className="flex items-center gap-2 rounded-sm bg-[var(--section-accent-soft)] px-4 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-40 transition-colors"
              >
                {loading ? <><Loader2 size={12} className="animate-spin"/> Generating…</> : <><LogoMark size={12}/> Generate schema</>}
              </button>
            </div>
          </div>
        )}

        {/* Preview step */}
        {step === "preview" && schema && (
          <div className="px-5 py-5">
            {/* Object summary */}
            <div className="mb-4 flex items-center gap-3 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5">
              <div className={`h-8 w-8 shrink-0 rounded-sm bg-${schema.color}-500/15 flex items-center justify-center`}>
                <Database size={14} className={`text-${schema.color}-400`}/>
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">{schema.plural}</div>
                <div className="text-[11px] text-[var(--text-muted)]">{schema.singular} · {schema.vertical}{schema.description ? ` · ${schema.description}` : ""}</div>
              </div>
            </div>

            {/* Attributes list */}
            <div className="max-h-[280px] overflow-y-auto rounded-sm border border-[var(--border-soft)] divide-y divide-[var(--border-soft)]">
              {schema.attributes.map((attr, i) => {
                const Icon = TYPE_ICON[attr.type] ?? Text;
                return (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon size={11} className={typeColor[attr.type] ?? "text-[var(--text-muted)]"}/>
                      <span className="text-[12px] text-[var(--text-primary)]">{attr.name}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] capitalize">{attr.type.replace("_", " ")}</span>
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-2 text-[11px] text-[var(--text-faint)]">{error}</p>}

            {schema.sample_records && schema.sample_records.length > 0 && (
              <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={includeSamples} onChange={e => setIncludeSamples(e.target.checked)} className="accent-[var(--section-accent)]"/>
                Start with {schema.sample_records.length} example row{schema.sample_records.length === 1 ? "" : "s"} <span className="text-[var(--text-faint)]">— edit or delete them anytime</span>
              </label>
            )}

            <div className="mt-4 flex justify-between gap-2">
              <button
                onClick={() => { setStep("prompt"); setSchema(null); }}
                className="rounded-sm border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-faint)] transition-colors"
              >
                Regenerate
              </button>
              <button
                onClick={createFromSchema}
                className="flex items-center gap-2 rounded-sm bg-[var(--section-accent-soft)] px-4 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors"
              >
                <Check size={12}/> Create this object
              </button>
            </div>
          </div>
        )}

        {/* Creating step */}
        {step === "creating" && (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-12">
            <Loader2 size={24} className="animate-spin text-[var(--text-faint)]"/>
            <div className="text-[13px] text-[var(--text-faint)]">Creating <span className="text-[var(--text-primary)] font-medium">{schema?.plural}</span> with {schema?.attributes.length} attributes…</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main settings page ───────────────────────────────────────────────────────
export function ObjectsSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["object-definitions"], queryFn: () => apiClient.get<ObjectDefinition[]>("/settings/objects") });
  const [selectedId, setSelectedId] = useState<string>();
  const [attributeOpen, setAttributeOpen] = useState(false);
  const [objectOpen, setObjectOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [attribute, setAttribute] = useState<Attribute>({ name: "", type: "text", required: false, unique: false });
  const [selectOptions, setSelectOptions] = useState(["New option"]);
  const [relationObject, setRelationObject] = useState("");
  const [customObject, setCustomObject] = useState({ singular: "", plural: "", icon: "circle", color: "red", vertical: "sales" });
  // Columns the user defines up front — so a manually-created sheet has real structure immediately
  // (was created empty → the record form/table had nothing to show). "name" is always implied.
  const [customCols, setCustomCols] = useState<{ name: string; type: AttributeType }[]>([]);
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<AttributeType>("text");
  const objects = query.data ?? [];
  const selected = objects.find((item) => item.id === selectedId) ?? objects[0];

  useEffect(() => {
    if (!selectedId && objects[0]) setSelectedId(objects[0].id);
  }, [objects, selectedId]);

  const createObject = useMutation({
    // Send singular/plural separately — the backend used to only accept one "name" field and store
    // it as BOTH name_singular and name_plural (e.g. "Investments"/"Investments" in prod), silently
    // dropping icon/color/vertical entirely.
    mutationFn: () => apiClient.post("/settings/objects", {
      name: customObject.singular,
      singular: customObject.singular,
      plural: customObject.plural || undefined,
      slug: customObject.singular.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      icon: customObject.icon,
      color: customObject.color,
      vertical: customObject.vertical,
      // Send the user-defined columns so the new sheet is structured from the first record.
      attributes: customCols.filter(c => c.name.trim()).map(c => ({ name: c.name.trim(), type: apiType(c.type) })),
    }),
    onSuccess: () => { setObjectOpen(false); setCustomObject({ singular: "", plural: "", icon: "circle", color: "red", vertical: "sales" }); setCustomCols([]); setNewColName(""); qc.invalidateQueries({ queryKey: ["object-definitions"] }); }
  });

  const createAttribute = useMutation({
    mutationFn: () => apiClient.post(`/settings/objects/${selected?.id}/attributes`, {
      name: attribute.name,
      type: apiType(attribute.type),
      display_type: attribute.type,
      required: attribute.required,
      unique: attribute.unique,
      options: selectOptions,
      relation_object: relationObject
    }),
    onSuccess: () => { setAttributeOpen(false); setAttribute({ name: "", type: "text", required: false, unique: false }); qc.invalidateQueries({ queryKey: ["object-definitions"] }); }
  });

  return (
    <div>
      <CommandPageHeader
        variant="bar" icon={Database} callsign="OBJECTS" title="Objects & attributes" subtitle="Define the record schemas Mondaily agents can read and update." />

      {/* AI Generate CTA */}
      <div className="mb-4 flex items-center gap-3 rounded-sm border border-[var(--border-strong)] bg-[var(--surface-hover)] px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-hover)]">
          <LogoMark size={16} className="text-[var(--text-faint)]"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-[var(--text-primary)]">Generate any sheet with AI</div>
          <div className="text-[11px] text-[var(--text-muted)]">Describe your list (e.g. "accounting sheet for taxes") and AI creates the full schema with all fields</div>
        </div>
        <button
          onClick={() => setAiOpen(true)}
          className="shrink-0 flex items-center gap-1.5 rounded-sm bg-[var(--section-accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] transition-colors"
        >
          <LogoMark size={11}/> Generate
        </button>
      </div>

      {query.isLoading ? <ConsoleSkeleton rows={8} /> : objects.length === 0 ? (
        <EmptyState icon={Database} title="No object definitions" description="Create your first custom object or generate one with AI."
          action={
            <div className="flex gap-2">
              <button onClick={() => setAiOpen(true)} className="flex items-center gap-1.5 rounded-sm bg-[var(--section-accent-soft)] px-3 py-2 text-sm"><AIMark size={13}/> Generate</button>
              <button onClick={() => setObjectOpen(true)} className="rounded-sm border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-faint)]">Manual</button>
            </div>
          }
        />
      ) : (
        <div className="grid min-h-[560px] grid-cols-[220px_1fr] overflow-hidden border-y border-[var(--border-soft)]">
          <aside className="border-r border-[var(--border-soft)] p-3">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-xs font-medium uppercase text-[var(--text-muted)]">Objects</span>
              <button onClick={() => setObjectOpen(true)} className="text-[var(--text-faint)]" aria-label="Create custom object"><Plus size={14}/></button>
            </div>
            <div className="space-y-1">
              {objects.map((object) => (
                <button key={object.id} onClick={() => setSelectedId(object.id)}
                  className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm ${selected?.id === object.id ? "bg-[var(--surface-hover)]" : "text-[var(--text-faint)] hover:bg-[var(--surface-hover)]"}`}>
                  <span className={`h-2.5 w-2.5 rounded-full bg-${object.color ?? "slate"}-500`}/>
                  <span className="min-w-0 flex-1 truncate">{object.name_plural}</span>
                  {object.is_standard ? <Lock size={11} className="text-[var(--text-muted)]"/> : <ChevronRight size={12}/>}
                </button>
              ))}
            </div>
            <button onClick={() => setObjectOpen(true)} className="mt-3 flex w-full items-center gap-2 rounded-sm border border-dashed border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-faint)] hover:border-[var(--border-soft)] transition-colors">
              <Plus size={13}/> Custom object
            </button>
            <button onClick={() => setAiOpen(true)} className="mt-1.5 flex w-full items-center gap-2 rounded-sm border border-dashed border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--text-faint)] hover:text-[var(--text-faint)] hover:border-[var(--border-strong)] transition-colors">
              <AIMark size={13}/> Generate
            </button>
          </aside>

          {selected && (
            <section className="p-5">
              <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-sm bg-[var(--surface-hover)] text-[var(--text-faint)]"><Database size={16}/></div>
                  <div>
                    <h2 className="font-medium">{selected.name_plural}</h2>
                    <p className="text-xs text-[var(--text-muted)]">{selected.slug} · {selected.vertical ?? "shared"}</p>
                  </div>
                  {selected.is_standard && <span className="rounded-full bg-[var(--surface-hover)] px-2 py-1 text-[10px] text-[var(--text-muted)]">Standard</span>}
                </div>
                <button onClick={() => setAttributeOpen(true)} className="flex items-center gap-2 rounded-sm bg-[var(--section-accent-soft)] px-3 py-2 text-sm">
                  <Plus size={13}/> Add attribute
                </button>
              </div>

              {(selected.attributes ?? []).length ? (
                <div className="minimal-sheet overflow-hidden">
                  <table className="minimal-table text-left text-sm">
                    <thead>
                      <tr><th>Attribute name</th><th>Type</th><th>Required</th><th>Unique</th><th /></tr>
                    </thead>
                    <tbody>
                      {(selected.attributes ?? []).map((item) => (
                        <tr key={item.id || item.name}>
                          <td className="font-medium">{item.name}</td>
                          <td className="capitalize text-[var(--text-muted)]">{item.type.replace("_", " ")}</td>
                          <td className="text-[var(--text-faint)]">{item.required ? "Yes" : "No"}</td>
                          <td className="text-[var(--text-faint)]">{item.unique ? "Yes" : "No"}</td>
                          <td className="text-right"><button className="text-[var(--text-muted)] hover:text-[var(--text-faint)]" aria-label={`Delete ${item.name}`}><Trash2 size={13}/></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={Database} title="No attributes" description="Add fields that describe this object."/>
              )}
            </section>
          )}
        </div>
      )}

      {/* AI Generator modal */}
      {aiOpen && (
        <AIGeneratePanel
          objects={objects}
          onCreated={id => { setAiOpen(false); setSelectedId(id); }}
          onClose={() => setAiOpen(false)}
        />
      )}

      {/* Add attribute panel */}
      {attributeOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
          <form onSubmit={e => { e.preventDefault(); if (attribute.name.trim()) createAttribute.mutate(); }}
            className="h-full w-full max-w-lg overflow-y-auto border-l border-[var(--border-soft)] bg-[var(--surface-card)] p-6">
            <div className="mb-6 flex items-center justify-between">
              <div><h2 className="font-medium">Add attribute</h2><p className="text-xs text-[var(--text-muted)]">Add a field to {selected?.name_plural}.</p></div>
              <button type="button" onClick={() => setAttributeOpen(false)}><X size={17}/></button>
            </div>
            <label className="text-sm">Attribute name
              <input value={attribute.name} onChange={e => setAttribute({ ...attribute, name: e.target.value })} className="key-input mt-2 h-10 w-full"/>
            </label>
            <p className="mb-2 mt-5 text-sm">Type</p>
            <div className="grid grid-cols-2 gap-2">
              {typeOptions.map(({ type, label, icon: Icon }) => (
                <button type="button" key={type} onClick={() => setAttribute({ ...attribute, type })}
                  className={`flex items-center gap-2 rounded-sm border p-3 text-left text-sm ${attribute.type === type ? "border-[var(--section-accent)] bg-[var(--surface-hover)]" : "border-[var(--border-soft)]"}`}>
                  <Icon size={14}/><span>{label}</span>
                </button>
              ))}
            </div>
            {(attribute.type === "select" || attribute.type === "multi_select") && (
              <div className="mt-5">
                <p className="mb-2 text-sm">Options</p>
                {selectOptions.map((opt, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <input value={opt} onChange={e => setSelectOptions(selectOptions.map((o, j) => j === i ? e.target.value : o))} className="h-9 flex-1 rounded-sm border border-[var(--border-soft)] bg-transparent px-3 text-sm"/>
                    <button type="button" onClick={() => setSelectOptions(selectOptions.filter((_, j) => j !== i))}><X size={13}/></button>
                  </div>
                ))}
                <button type="button" onClick={() => setSelectOptions([...selectOptions, ""])} className="text-xs text-[var(--text-faint)]">+ Add option</button>
              </div>
            )}
            {attribute.type === "relation" && (
              <label className="mt-5 block text-sm">Related object
                <FieldSelect value={relationObject} onChange={v => setRelationObject(v)} ariaLabel="Related object" className="mt-2" options={[{ value: "", label: "Select object" }, ...objects.map(o => ({ value: o.slug, label: o.name_plural }))]} />
              </label>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Toggle label="Required" checked={attribute.required ?? false} change={v => setAttribute({ ...attribute, required: v })}/>
              <Toggle label="Unique" checked={attribute.unique ?? false} change={v => setAttribute({ ...attribute, unique: v })}/>
            </div>
            <button disabled={!attribute.name.trim()} className="mt-6 h-10 w-full rounded-sm bg-[var(--section-accent-soft)] text-sm disabled:opacity-40">Save attribute</button>
          </form>
        </div>
      )}

      {/* Create object modal */}
      {objectOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-[2px] p-6">
          <form onSubmit={e => { e.preventDefault(); if (customObject.singular.trim()) createObject.mutate(); }}
            className="w-full max-w-lg rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-medium">Create custom object</h2>
              <button type="button" onClick={() => setObjectOpen(false)}><X size={16}/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Singular name" value={customObject.singular} onChange={v => setCustomObject({ ...customObject, singular: v, plural: customObject.plural || `${v}s` })} placeholder="Investor"/>
              <Field label="Plural name" value={customObject.plural} onChange={v => setCustomObject({ ...customObject, plural: v })} placeholder="Investors"/>
              <Field label="Icon" value={customObject.icon} onChange={v => setCustomObject({ ...customObject, icon: v })} placeholder="circle"/>
              <label className="text-sm">Vertical
                <FieldSelect value={customObject.vertical} onChange={v => setCustomObject({ ...customObject, vertical: v })} ariaLabel="Vertical" className="mt-2" options={["sales", "realestate", "hr", "finance", "investments", "shared"].map(v => ({ value: v, label: v }))} />
              </label>
            </div>
            <p className="mb-2 mt-4 text-sm">Color</p>
            <div className="flex gap-2">
              {colors.map(color => (
                <button type="button" key={color} onClick={() => setCustomObject({ ...customObject, color })}
                  className={`h-7 w-7 rounded-full bg-${color}-500 ${customObject.color === color ? "ring-2 ring-white ring-offset-2 ring-offset-[#111419]" : ""}`} aria-label={color}/>
              ))}
            </div>

            {/* Columns — define the sheet's real structure up front so a new record form/table isn't
                empty. "Name" is always the first column; add as many more as you want. */}
            <div className="mt-5">
              <p className="mb-2 text-sm">Columns</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }} title="Every sheet has a Name column"><Text size={11}/> Name</span>
                {customCols.map((col, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11.5px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                    {(() => { const Ic = TYPE_ICON[col.type] ?? Text; return <Ic size={11} style={{ color: "var(--text-faint)" }}/>; })()}
                    {col.name}
                    <button type="button" onClick={() => setCustomCols(cols => cols.filter((_, j) => j !== i))} className="ml-0.5" style={{ color: "var(--text-faint)" }}><X size={10}/></button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <input value={newColName} onChange={e => setNewColName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newColName.trim()) { e.preventDefault(); setCustomCols(c => [...c, { name: newColName.trim(), type: newColType }]); setNewColName(""); } }}
                  placeholder="Add a column…" className="h-8 flex-1 rounded-sm border bg-transparent px-2.5 text-[12.5px] outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}/>
                <div className="w-32"><FieldSelect value={newColType} onChange={v => setNewColType(v as AttributeType)} ariaLabel="Column type" options={typeOptions.map(t => ({ value: t.type, label: t.label }))}/></div>
                <button type="button" disabled={!newColName.trim()} onClick={() => { setCustomCols(c => [...c, { name: newColName.trim(), type: newColType }]); setNewColName(""); }}
                  className="inline-flex h-8 items-center gap-1 rounded-sm border px-2.5 text-[12px] font-medium disabled:opacity-40" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}><Plus size={12}/> Add</button>
              </div>
            </div>

            <button className="mt-6 h-10 w-full rounded-sm bg-[var(--section-accent-soft)] text-sm">Create object</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, change }: { label: string; checked: boolean; change: (v: boolean) => void }) {
  return <label className="flex items-center justify-between rounded-sm border border-[var(--border-soft)] p-3 text-sm"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => change(e.target.checked)}/></label>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="text-sm">{label}<input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="key-input mt-2 h-10 w-full"/></label>;
}
