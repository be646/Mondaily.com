import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogoMark } from "@/components/logo";
import {
  AtSign, Calendar, CheckSquare, ChevronRight, Database, File,
  FunctionSquare, Hash, Link, List, Lock, Mail, Percent, Phone,
  Plus, Text, Trash2, X, Loader2, Check, ArrowLeft,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { apiClient, getAuthHeaders } from "../../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../../components/ui/page-state";

type AttributeType = "text" | "long_text" | "number" | "currency" | "percentage" | "date" | "datetime" | "checkbox" | "select" | "multi_select" | "url" | "email" | "phone" | "relation" | "formula" | "file";
interface Attribute { id?: string; name: string; type: AttributeType; required?: boolean; unique?: boolean }
interface ObjectDefinition { id: string; name_singular?: string; name_plural: string; slug: string; icon?: string; color?: string; is_standard?: boolean; vertical?: string; attributes: Attribute[] }
interface GeneratedSchema { singular: string; plural: string; vertical: string; color: string; description?: string; attributes: { name: string; type: AttributeType }[] }

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
const apiType = (type: AttributeType) => type === "number" || type === "date" || type === "select" || type === "relation" ? type : type === "multi_select" ? "select" : "text";

// ─── Example prompts ──────────────────────────────────────────────────────────
const EXAMPLES = [
  "Accounting sheet for business taxes and costs",
  "Employee HR records with salary and performance",
  "Real estate property listings with price and status",
  "Investor CRM with portfolio and check size",
  "Product inventory with SKU, stock and pricing",
  "Client contracts with value, dates and status",
  "Marketing campaigns with budget and ROI tracking",
  "Sales leads with source, score and qualification",
];

// ─── Call dedicated schema endpoint (uses Anthropic tool_use = guaranteed JSON) ─
async function generateSchema(prompt: string): Promise<GeneratedSchema> {
  const headers = await getAuthHeaders();
  const apiUrl = import.meta.env.VITE_API_URL || "";

  const res = await fetch(`${apiUrl}/api/v1/generate/schema`, {
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
  const qc = useQueryClient();
  const [step, setStep] = useState<"prompt" | "preview" | "creating">("prompt");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [schema, setSchema] = useState<GeneratedSchema | null>(null);
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
      // Create the object
      const obj = await apiClient.post<{ id: string }>("/settings/objects", {
        name: schema.plural,
        slug: schema.plural.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
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
            required: false,
            unique: false,
          });
        } catch {}
      }

      await qc.invalidateQueries({ queryKey: ["object-definitions"] });
      onCreated(obj.id);
    } catch (e: any) {
      setError(e.message || "Failed to create object");
      setStep("preview");
    }
  }

  const typeColor: Record<string, string> = {
    currency: "text-emerald-400", number: "text-blue-400", date: "text-amber-400",
    datetime: "text-amber-400", checkbox: "text-stone-400", select: "text-cyan-400",
    multi_select: "text-cyan-400", email: "text-stone-400", phone: "text-stone-400",
    url: "text-blue-400", text: "text-stone-400", long_text: "text-stone-400",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-6">
      <div className="w-full max-w-xl rounded-2xl border border-white/[.09] bg-[#141414] shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[.06] px-5 py-4">
          <div className="flex items-center gap-2.5">
            {step === "preview" && (
              <button onClick={() => setStep("prompt")} className="mr-1 text-stone-500 hover:text-stone-300 transition-colors">
                <ArrowLeft size={14}/>
              </button>
            )}
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-stone-500/15">
              <LogoMark size={13} className="text-stone-400"/>
            </div>
            <div>
              <div className="text-[13px] font-semibold text-white">
                {step === "prompt" ? "AI Schema Generator" : step === "preview" ? "Review generated schema" : "Creating object…"}
              </div>
              <div className="text-[11px] text-stone-600">
                {step === "prompt" ? "Describe your sheet and AI builds the fields" : step === "preview" ? `${schema?.attributes.length} attributes generated` : "Setting up your object and attributes"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-stone-500 hover:text-stone-300 hover:bg-white/[.05] transition-colors">
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
              className="w-full resize-none rounded-lg border border-white/[.08] bg-white/[.03] px-3.5 py-3 text-sm text-white placeholder-stone-600 outline-none focus:border-stone-500/30 focus:bg-white/[.04] transition-colors"
            />

            {error && <p className="mt-2 text-[11px] text-stone-400">{error}</p>}

            {/* Examples */}
            <p className="mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-600">Examples</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.slice(0, 6).map(ex => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="rounded-md border border-stone-800/60 bg-stone-900/30 px-2.5 py-1 text-[11px] text-stone-500 hover:text-stone-200 hover:border-stone-700/60 transition-all"
                >
                  {ex}
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border border-white/[.08] px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors">
                Cancel
              </button>
              <button
                onClick={generate}
                disabled={!prompt.trim() || loading}
                className="flex items-center gap-2 rounded-lg bg-stone-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-stone-400 disabled:opacity-40 transition-colors"
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
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2.5">
              <div className={`h-8 w-8 shrink-0 rounded-md bg-${schema.color}-500/15 flex items-center justify-center`}>
                <Database size={14} className={`text-${schema.color}-400`}/>
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-white">{schema.plural}</div>
                <div className="text-[11px] text-stone-500">{schema.singular} · {schema.vertical}{schema.description ? ` · ${schema.description}` : ""}</div>
              </div>
            </div>

            {/* Attributes list */}
            <div className="max-h-[280px] overflow-y-auto rounded-lg border border-stone-800/50 divide-y divide-stone-800/40">
              {schema.attributes.map((attr, i) => {
                const Icon = TYPE_ICON[attr.type] ?? Text;
                return (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon size={11} className={typeColor[attr.type] ?? "text-stone-500"}/>
                      <span className="text-[12px] text-stone-200">{attr.name}</span>
                    </div>
                    <span className="text-[10px] text-stone-600 capitalize">{attr.type.replace("_", " ")}</span>
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-2 text-[11px] text-stone-400">{error}</p>}

            <div className="mt-4 flex justify-between gap-2">
              <button
                onClick={() => { setStep("prompt"); setSchema(null); }}
                className="rounded-lg border border-stone-800/60 px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors"
              >
                Regenerate
              </button>
              <button
                onClick={createFromSchema}
                className="flex items-center gap-2 rounded-lg bg-stone-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-stone-400 transition-colors"
              >
                <Check size={12}/> Create this object
              </button>
            </div>
          </div>
        )}

        {/* Creating step */}
        {step === "creating" && (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-12">
            <Loader2 size={24} className="animate-spin text-stone-400"/>
            <div className="text-[13px] text-stone-400">Creating <span className="text-white font-medium">{schema?.plural}</span> with {schema?.attributes.length} attributes…</div>
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
  const objects = query.data ?? [];
  const selected = objects.find((item) => item.id === selectedId) ?? objects[0];

  useEffect(() => {
    if (!selectedId && objects[0]) setSelectedId(objects[0].id);
  }, [objects, selectedId]);

  const createObject = useMutation({
    mutationFn: () => apiClient.post("/settings/objects", {
      name: customObject.plural || `${customObject.singular}s`,
      slug: (customObject.plural || customObject.singular).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      ...customObject
    }),
    onSuccess: () => { setObjectOpen(false); setCustomObject({ singular: "", plural: "", icon: "circle", color: "red", vertical: "sales" }); qc.invalidateQueries({ queryKey: ["object-definitions"] }); }
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
      <PageHeader title="Objects & attributes" description="Define the record schemas Mondaily agents can read and update." />

      {/* AI Generate CTA */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-stone-500/20 bg-stone-500/5 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-500/15">
          <LogoMark size={16} className="text-stone-400"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">Generate any sheet with AI</div>
          <div className="text-[11px] text-stone-500">Describe your list (e.g. "accounting sheet for taxes") and AI creates the full schema with all fields</div>
        </div>
        <button
          onClick={() => setAiOpen(true)}
          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-stone-500 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-400 transition-colors"
        >
          <LogoMark size={11}/> Generate
        </button>
      </div>

      {query.isLoading ? <PageSkeleton rows={8} /> : objects.length === 0 ? (
        <EmptyState icon={Database} title="No object definitions" description="Create your first custom object or generate one with AI."
          action={
            <div className="flex gap-2">
              <button onClick={() => setAiOpen(true)} className="flex items-center gap-1.5 rounded-md bg-stone-600 px-3 py-2 text-sm"><LogoMark size={13}/> Generate with AI</button>
              <button onClick={() => setObjectOpen(true)} className="rounded-md border border-white/[.06] px-3 py-2 text-sm text-stone-400">Manual</button>
            </div>
          }
        />
      ) : (
        <div className="grid min-h-[560px] grid-cols-[220px_1fr] overflow-hidden border-y border-stone-200 dark:border-stone-800">
          <aside className="border-r border-stone-200 p-3 dark:border-stone-800">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-xs font-medium uppercase text-stone-500">Objects</span>
              <button onClick={() => setObjectOpen(true)} className="text-stone-400" aria-label="Create custom object"><Plus size={14}/></button>
            </div>
            <div className="space-y-1">
              {objects.map((object) => (
                <button key={object.id} onClick={() => setSelectedId(object.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${selected?.id === object.id ? "bg-white/10" : "text-stone-400 hover:bg-white/[.04]"}`}>
                  <span className={`h-2.5 w-2.5 rounded-full bg-${object.color ?? "slate"}-500`}/>
                  <span className="min-w-0 flex-1 truncate">{object.name_plural}</span>
                  {object.is_standard ? <Lock size={11} className="text-stone-600"/> : <ChevronRight size={12}/>}
                </button>
              ))}
            </div>
            <button onClick={() => setObjectOpen(true)} className="mt-3 flex w-full items-center gap-2 rounded-md border border-dashed border-white/[.06] px-3 py-2 text-sm text-stone-500 hover:text-stone-300 hover:border-white/20 transition-colors">
              <Plus size={13}/> Custom object
            </button>
            <button onClick={() => setAiOpen(true)} className="mt-1.5 flex w-full items-center gap-2 rounded-md border border-dashed border-stone-500/30 px-3 py-2 text-sm text-stone-400/70 hover:text-stone-300 hover:border-stone-500/50 transition-colors">
              <LogoMark size={13}/> Generate with AI
            </button>
          </aside>

          {selected && (
            <section className="p-5">
              <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-stone-500/10 text-stone-300"><Database size={16}/></div>
                  <div>
                    <h2 className="font-medium">{selected.name_plural}</h2>
                    <p className="text-xs text-stone-500">{selected.slug} · {selected.vertical ?? "shared"}</p>
                  </div>
                  {selected.is_standard && <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-stone-500">Standard</span>}
                </div>
                <button onClick={() => setAttributeOpen(true)} className="flex items-center gap-2 rounded-md bg-stone-600 px-3 py-2 text-sm">
                  <Plus size={13}/> Add attribute
                </button>
              </div>

              {selected.attributes.length ? (
                <div className="minimal-sheet overflow-hidden">
                  <table className="minimal-table text-left text-sm">
                    <thead>
                      <tr><th>Attribute name</th><th>Type</th><th>Required</th><th>Unique</th><th /></tr>
                    </thead>
                    <tbody>
                      {selected.attributes.map((item) => (
                        <tr key={item.id || item.name}>
                          <td className="font-medium">{item.name}</td>
                          <td className="capitalize text-stone-500 dark:text-stone-400">{item.type.replace("_", " ")}</td>
                          <td className="text-stone-400 dark:text-stone-600">{item.required ? "Yes" : "No"}</td>
                          <td className="text-stone-400 dark:text-stone-600">{item.unique ? "Yes" : "No"}</td>
                          <td className="text-right"><button className="text-stone-600 hover:text-stone-400" aria-label={`Delete ${item.name}`}><Trash2 size={13}/></button></td>
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
            className="h-full w-full max-w-lg overflow-y-auto border-l border-white/[.07] bg-[#141414] p-6">
            <div className="mb-6 flex items-center justify-between">
              <div><h2 className="font-medium">Add attribute</h2><p className="text-xs text-stone-500">Add a field to {selected?.name_plural}.</p></div>
              <button type="button" onClick={() => setAttributeOpen(false)}><X size={17}/></button>
            </div>
            <label className="text-sm">Attribute name
              <input value={attribute.name} onChange={e => setAttribute({ ...attribute, name: e.target.value })} className="key-input mt-2 h-10 w-full"/>
            </label>
            <p className="mb-2 mt-5 text-sm">Type</p>
            <div className="grid grid-cols-2 gap-2">
              {typeOptions.map(({ type, label, icon: Icon }) => (
                <button type="button" key={type} onClick={() => setAttribute({ ...attribute, type })}
                  className={`flex items-center gap-2 rounded-md border p-3 text-left text-sm ${attribute.type === type ? "border-stone-500 bg-stone-500/5" : "border-white/[.06]"}`}>
                  <Icon size={14}/><span>{label}</span>
                </button>
              ))}
            </div>
            {(attribute.type === "select" || attribute.type === "multi_select") && (
              <div className="mt-5">
                <p className="mb-2 text-sm">Options</p>
                {selectOptions.map((opt, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <input value={opt} onChange={e => setSelectOptions(selectOptions.map((o, j) => j === i ? e.target.value : o))} className="h-9 flex-1 rounded-md border border-white/[.06] bg-transparent px-3 text-sm"/>
                    <button type="button" onClick={() => setSelectOptions(selectOptions.filter((_, j) => j !== i))}><X size={13}/></button>
                  </div>
                ))}
                <button type="button" onClick={() => setSelectOptions([...selectOptions, ""])} className="text-xs text-stone-400">+ Add option</button>
              </div>
            )}
            {attribute.type === "relation" && (
              <label className="mt-5 block text-sm">Related object
                <select value={relationObject} onChange={e => setRelationObject(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-white/[.06] bg-[#141414] px-3">
                  <option value="">Select object</option>
                  {objects.map(o => <option key={o.id} value={o.slug}>{o.name_plural}</option>)}
                </select>
              </label>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Toggle label="Required" checked={attribute.required ?? false} change={v => setAttribute({ ...attribute, required: v })}/>
              <Toggle label="Unique" checked={attribute.unique ?? false} change={v => setAttribute({ ...attribute, unique: v })}/>
            </div>
            <button disabled={!attribute.name.trim()} className="mt-6 h-10 w-full rounded-md bg-stone-600 text-sm disabled:opacity-40">Save attribute</button>
          </form>
        </div>
      )}

      {/* Create object modal */}
      {objectOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-[2px] p-6">
          <form onSubmit={e => { e.preventDefault(); if (customObject.singular.trim()) createObject.mutate(); }}
            className="w-full max-w-lg rounded-2xl border border-white/[.09] bg-[#141414] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-medium">Create custom object</h2>
              <button type="button" onClick={() => setObjectOpen(false)}><X size={16}/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Singular name" value={customObject.singular} onChange={v => setCustomObject({ ...customObject, singular: v, plural: customObject.plural || `${v}s` })} placeholder="Investor"/>
              <Field label="Plural name" value={customObject.plural} onChange={v => setCustomObject({ ...customObject, plural: v })} placeholder="Investors"/>
              <Field label="Icon" value={customObject.icon} onChange={v => setCustomObject({ ...customObject, icon: v })} placeholder="circle"/>
              <label className="text-sm">Vertical
                <select value={customObject.vertical} onChange={e => setCustomObject({ ...customObject, vertical: e.target.value })} className="mt-2 h-10 w-full rounded-md border border-white/[.06] bg-[#141414] px-3">
                  {["sales", "realestate", "hr", "finance", "investments", "shared"].map(v => <option key={v}>{v}</option>)}
                </select>
              </label>
            </div>
            <p className="mb-2 mt-4 text-sm">Color</p>
            <div className="flex gap-2">
              {colors.map(color => (
                <button type="button" key={color} onClick={() => setCustomObject({ ...customObject, color })}
                  className={`h-7 w-7 rounded-full bg-${color}-500 ${customObject.color === color ? "ring-2 ring-white ring-offset-2 ring-offset-[#111419]" : ""}`} aria-label={color}/>
              ))}
            </div>
            <button className="mt-6 h-10 w-full rounded-md bg-stone-600 text-sm">Create object</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, change }: { label: string; checked: boolean; change: (v: boolean) => void }) {
  return <label className="flex items-center justify-between rounded-md border border-white/[.06] p-3 text-sm"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => change(e.target.checked)}/></label>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="text-sm">{label}<input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="key-input mt-2 h-10 w-full"/></label>;
}
